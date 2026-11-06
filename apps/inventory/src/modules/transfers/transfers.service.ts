import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { RequestContext, runInTenantTransaction } from '@pbl/common';
import {
  INVENTORY_STOCK_CHANGED,
  INVENTORY_TRANSFER_DISPATCHED,
  INVENTORY_TRANSFER_RECEIVED,
  StockChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { lockStockBalance } from '../../common/balance-lock';
import {
  assertCanCancelStockTransfer,
  assertCanDispatchStockTransfer,
  assertTransferKindsAllowed,
  assertValidStockTransferWarehouses,
  computeValuationAfterDeduction,
  computeWeightedAverageCostOnReceipt,
  formatMilliToQty,
  InventoryDomainError,
  InventoryDomainErrorCode,
  isTransferOverdue,
  normalizeAndSortWarehouseLines,
  normalizeInventoryCode,
  parseMoneyToVnd,
  parseQtyToMilli,
  transferDaysOpen,
  vndToNumber,
} from '../../domain/inventory-domain';
import { WarehouseScope } from '../../scope/warehouse-scope';
import {
  assertActiveWarehouse,
  schemaPrefix,
} from '../warehouses/warehouses.service';
import {
  CreateStockTransferDto,
  ReceiveStockTransferDto,
} from './transfers.dto';

@Injectable()
export class TransfersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly outbox?: EventOutbox,
  ) {}

  /**
   * D18: both warehouses must exist and be ACTIVE; quarantine stock may only
   * go to a BRANCH warehouse, and moving into or out of quarantine needs
   * `inventory.approve` (`canApprove`). Branch scope on both ends is checked
   * by the controller (404).
   */
  async createTransfer(
    dto: CreateStockTransferDto,
    opts: { canApprove?: boolean } = {},
  ) {
    assertValidStockTransferWarehouses(dto.fromWarehouseId, dto.toWarehouseId);

    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const from = await assertActiveWarehouse(
        em,
        prefix,
        tenantId,
        dto.fromWarehouseId,
      );
      const to = await assertActiveWarehouse(
        em,
        prefix,
        tenantId,
        dto.toWarehouseId,
      );
      assertTransferKindsAllowed(from.kind, to.kind, opts.canApprove === true);

      const normalized = normalizeAndSortWarehouseLines(
        dto.items.map((i) => ({
          warehouseId: dto.fromWarehouseId,
          skuId: i.skuId,
          qty: i.qty,
        })),
      );

      const transferId = randomUUID();
      const code = dto.code
        ? normalizeInventoryCode(dto.code, 'transfer code')
        : `TRF-${transferId.slice(0, 8).toUpperCase()}`;

      await em.query(
        `
        INSERT INTO ${prefix}"stock_transfer" (
          id, tenant_id, code, from_warehouse_id, to_warehouse_id,
          status, note, created_by
        ) VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $7)
        `,
        [
          transferId,
          tenantId,
          code,
          dto.fromWarehouseId,
          dto.toWarehouseId,
          dto.note ?? null,
          RequestContext.get()?.actor?.id ?? null,
        ],
      );

      for (let i = 0; i < normalized.length; i += 1) {
        const line = normalized[i];
        await em.query(
          `
          INSERT INTO ${prefix}"stock_transfer_item" (
            id, tenant_id, transfer_id, line_no, sku_id,
            transfer_qty, dispatched_qty, received_qty, discrepancy_qty, unit_cost
          ) VALUES ($1, $2, $3, $4, $5, $6::numeric(18,3), 0, 0, 0, 0)
          `,
          [randomUUID(), tenantId, transferId, i + 1, line.skuId, line.qty],
        );
      }

      return this.loadTransferResponse(em, prefix, tenantId, transferId);
    });
  }

  async dispatchTransfer(transferId: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);

      const headerRows = await em.query(
        `
        SELECT *
        FROM ${prefix}"stock_transfer"
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE
        `,
        [tenantId, transferId],
      );
      if (headerRows.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.TRANSFER_NOT_FOUND,
          `Stock transfer ${transferId} not found`,
          404,
        );
      }
      const header = headerRows[0];
      assertCanDispatchStockTransfer(header.status);

      await assertActiveWarehouse(
        em,
        prefix,
        tenantId,
        header.from_warehouse_id,
      );
      await assertActiveWarehouse(em, prefix, tenantId, header.to_warehouse_id);

      const items = await em.query(
        `
        SELECT
          id,
          line_no AS "lineNo",
          sku_id AS "skuId",
          transfer_qty AS "transferQty"
        FROM ${prefix}"stock_transfer_item"
        WHERE tenant_id = $1 AND transfer_id = $2
        ORDER BY sku_id ASC
        `,
        [tenantId, transferId],
      );

      // Lock source balances in deterministic sku_id order and check available stock
      const sourceBalances = new Map<
        string,
        { onHandQty: string; reservedQty: string; avgUnitCost: number }
      >();
      const shortages: {
        warehouseId: string;
        skuId: string;
        requestedQty: string;
        availableQty: string;
      }[] = [];

      for (const item of items) {
        const reqMilli = parseQtyToMilli(
          String(item.transferQty),
          false,
          false,
        );
        const balRows = await em.query(
          `
          SELECT
            on_hand_qty AS "onHandQty",
            reserved_qty AS "reservedQty",
            COALESCE(avg_unit_cost, 0) AS "avgUnitCost"
          FROM ${prefix}"stock_balance"
          WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
          FOR UPDATE
          `,
          [tenantId, header.from_warehouse_id, item.skuId],
        );

        const onHandMilli =
          balRows.length > 0
            ? parseQtyToMilli(String(balRows[0].onHandQty), true, false)
            : 0n;
        const reservedMilli =
          balRows.length > 0
            ? parseQtyToMilli(String(balRows[0].reservedQty), true, false)
            : 0n;
        const availableMilli = onHandMilli - reservedMilli;

        if (availableMilli < reqMilli) {
          shortages.push({
            warehouseId: header.from_warehouse_id,
            skuId: item.skuId,
            requestedQty: formatMilliToQty(reqMilli),
            availableQty: formatMilliToQty(
              availableMilli > 0n ? availableMilli : 0n,
            ),
          });
        } else {
          sourceBalances.set(String(item.skuId), {
            onHandQty: formatMilliToQty(onHandMilli),
            reservedQty: formatMilliToQty(reservedMilli),
            avgUnitCost: vndToNumber(
              parseMoneyToVnd(String(balRows[0].avgUnitCost)),
            ),
          });
        }
      }

      if (shortages.length > 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.INSUFFICIENT_STOCK,
          'Insufficient available stock at source warehouse to dispatch transfer',
          409,
          shortages,
        );
      }

      const occurredAt = new Date().toISOString();
      const actorId = RequestContext.get()?.actor?.id ?? 'system';
      const correlationId = RequestContext.get()?.requestId ?? null;

      for (const item of items) {
        const srcBal = sourceBalances.get(String(item.skuId))!;
        const qtyStr = formatMilliToQty(
          parseQtyToMilli(String(item.transferQty), false, false),
        );
        const qtyDelta = `-${qtyStr}`;

        const valuation = computeValuationAfterDeduction({
          currentOnHandQty: srcBal.onHandQty,
          currentAvgUnitCost: srcBal.avgUnitCost,
          deductedBaseQty: qtyStr,
        });

        // 1. Deduct from source warehouse on_hand_qty
        await em.query(
          `
          UPDATE ${prefix}"stock_balance"
          SET
            on_hand_qty = $4::numeric(18,3),
            valuation_amount = $5::bigint,
            version = version + 1,
            updated_at = now()
          WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
            AND (on_hand_qty - reserved_qty) >= $6::numeric(18,3)
          `,
          [
            tenantId,
            header.from_warehouse_id,
            item.skuId,
            valuation.newOnHandQty,
            valuation.newValuationAmount,
            qtyStr,
          ],
        );

        // 2. Increment destination warehouse in_transit_qty
        await em.query(
          `
          INSERT INTO ${prefix}"stock_balance" (
            id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty, in_transit_qty,
            avg_unit_cost, valuation_amount, version, updated_at
          ) VALUES ($1, $2, $3, $4, 0, 0, $5::numeric(18,3), 0, 0, 1, now())
          ON CONFLICT (tenant_id, warehouse_id, sku_id) DO UPDATE
          SET
            in_transit_qty = ${prefix}"stock_balance".in_transit_qty + EXCLUDED.in_transit_qty,
            version = ${prefix}"stock_balance".version + 1,
            updated_at = now()
          `,
          [randomUUID(), tenantId, header.to_warehouse_id, item.skuId, qtyStr],
        );

        // 3. Record dispatched_qty and source avg_unit_cost on transfer line
        await em.query(
          `
          UPDATE ${prefix}"stock_transfer_item"
          SET
            dispatched_qty = $3::numeric(18,3),
            unit_cost = $4::bigint
          WHERE tenant_id = $1 AND id = $2
          `,
          [tenantId, item.id, qtyStr, srcBal.avgUnitCost],
        );

        // 4. Write TRANSFER_DISPATCH ledger entry on source warehouse
        await em.query(
          `
          INSERT INTO ${prefix}"stock_balance_ledger" (
            id, tenant_id, warehouse_id, sku_id, movement_type,
            qty_before, qty_delta, on_hand_after, reserved_after,
            unit_cost, avg_cost_after, reference_type, reference_id,
            actor_id, correlation_id, reason, occurred_at
          ) VALUES (
            $1, $2, $3, $4, 'TRANSFER_DISPATCH',
            $5::numeric(18,3), $6::numeric(18,3), $7::numeric(18,3), $8::numeric(18,3),
            $9::bigint, $10::bigint, 'STOCK_TRANSFER', $11,
            $12, $13, $14, $15
          )
          `,
          [
            randomUUID(),
            tenantId,
            header.from_warehouse_id,
            item.skuId,
            srcBal.onHandQty,
            qtyDelta,
            valuation.newOnHandQty,
            srcBal.reservedQty,
            srcBal.avgUnitCost,
            valuation.newAvgUnitCost,
            transferId,
            actorId,
            correlationId,
            header.note ?? null,
            occurredAt,
          ],
        );

        if (this.outbox) {
          await this.outbox.add(em, INVENTORY_STOCK_CHANGED, {
            warehouseId: header.from_warehouse_id,
            skuId: item.skuId,
            movementType: 'TRANSFER_DISPATCH',
            qtyDelta,
            onHandAfter: valuation.newOnHandQty,
            reservedAfter: srcBal.reservedQty,
            unitCost: srcBal.avgUnitCost,
            avgCostAfter: valuation.newAvgUnitCost,
            referenceType: 'STOCK_TRANSFER',
            referenceId: transferId,
            occurredAt,
          } satisfies StockChangedPayload);
        }
      }

      await em.query(
        `
        UPDATE ${prefix}"stock_transfer"
        SET
          status = 'DISPATCHED',
          dispatched_by = $3,
          dispatched_at = $4::timestamptz,
          updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        `,
        [tenantId, transferId, actorId, occurredAt],
      );

      if (this.outbox) {
        await this.outbox.add(em, INVENTORY_TRANSFER_DISPATCHED, {
          transferId,
          code: header.code,
          fromWarehouseId: header.from_warehouse_id,
          toWarehouseId: header.to_warehouse_id,
          dispatchedAt: occurredAt,
        });
      }

      return this.loadTransferResponse(em, prefix, tenantId, transferId);
    });
  }

  async receiveTransfer(transferId: string, dto?: ReceiveStockTransferDto) {
    // One line per SKU: two lines for the same SKU would be validated against
    // the same stale snapshot of the transfer line and could put twice the
    // quantity on hand while the line shows it once.
    const seen = new Set<string>();
    for (const line of dto?.items ?? []) {
      if (seen.has(line.skuId)) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.TRANSFER_DUPLICATE_SKU,
          `SKU ${line.skuId} appears more than once in the receive request`,
          422,
        );
      }
      seen.add(line.skuId);
    }

    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);

      const headerRows = await em.query(
        `
        SELECT *
        FROM ${prefix}"stock_transfer"
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE
        `,
        [tenantId, transferId],
      );
      if (headerRows.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.TRANSFER_NOT_FOUND,
          `Stock transfer ${transferId} not found`,
          404,
        );
      }
      const header = headerRows[0];

      if (
        !['DISPATCHED', 'PARTIALLY_RECEIVED', 'DISCREPANCY'].includes(
          header.status,
        )
      ) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.TRANSFER_INVALID_STATE,
          `Cannot receive stock transfer in state ${header.status}`,
          409,
        );
      }

      await assertActiveWarehouse(em, prefix, tenantId, header.to_warehouse_id);

      const dbItems = await em.query(
        `
        SELECT
          id,
          line_no AS "lineNo",
          sku_id AS "skuId",
          transfer_qty AS "transferQty",
          dispatched_qty AS "dispatchedQty",
          received_qty AS "receivedQty",
          discrepancy_qty AS "discrepancyQty",
          unit_cost AS "unitCost"
        FROM ${prefix}"stock_transfer_item"
        WHERE tenant_id = $1 AND transfer_id = $2
        ORDER BY sku_id ASC
        FOR UPDATE
        `,
        [tenantId, transferId],
      );

      const incomingLines =
        dto?.items && dto.items.length > 0
          ? dto.items
          : dbItems.map((row: Record<string, unknown>) => {
              const dispatchedMilli = parseQtyToMilli(
                String(row.dispatchedQty),
                true,
                false,
              );
              const receivedMilli = parseQtyToMilli(
                String(row.receivedQty),
                true,
                false,
              );
              const discrepancyMilli = parseQtyToMilli(
                String(row.discrepancyQty),
                true,
                false,
              );
              const remMilli =
                dispatchedMilli - receivedMilli - discrepancyMilli;
              return {
                skuId: String(row.skuId),
                receivedQty: formatMilliToQty(remMilli > 0n ? remMilli : 0n),
                discrepancyQty: '0.000',
                discrepancyReason: undefined,
              };
            });

      const occurredAt = new Date().toISOString();
      const actorId = RequestContext.get()?.actor?.id ?? 'system';
      const correlationId = RequestContext.get()?.requestId ?? null;

      for (const reqLine of incomingLines) {
        // Re-read (and lock) the line for every request line: validation is
        // always against the quantities as they are now, cumulatively.
        const [dbItem] = await em.query(
          `
          SELECT
            id,
            dispatched_qty AS "dispatchedQty",
            received_qty AS "receivedQty",
            discrepancy_qty AS "discrepancyQty",
            unit_cost AS "unitCost"
          FROM ${prefix}"stock_transfer_item"
          WHERE tenant_id = $1 AND transfer_id = $2 AND sku_id = $3
          FOR UPDATE
          `,
          [tenantId, transferId, reqLine.skuId],
        );
        if (!dbItem) {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.TRANSFER_QUANTITY_MISMATCH,
            `SKU ${reqLine.skuId} is not part of transfer ${header.code}`,
            409,
          );
        }

        const dispatchedMilli = parseQtyToMilli(
          String(dbItem.dispatchedQty),
          true,
          false,
        );
        const prevReceivedMilli = parseQtyToMilli(
          String(dbItem.receivedQty),
          true,
          false,
        );
        const prevDiscrepancyMilli = parseQtyToMilli(
          String(dbItem.discrepancyQty),
          true,
          false,
        );
        const remainingInTransitMilli =
          dispatchedMilli - prevReceivedMilli - prevDiscrepancyMilli;

        const receiveNowMilli = parseQtyToMilli(
          reqLine.receivedQty,
          true,
          false,
        );
        const discrepancyNowMilli = parseQtyToMilli(
          reqLine.discrepancyQty ?? '0.000',
          true,
          false,
        );
        const totalClearedNowMilli = receiveNowMilli + discrepancyNowMilli;

        if (totalClearedNowMilli <= 0n && !dto?.resolveDiscrepancy) {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.TRANSFER_QUANTITY_MISMATCH,
            `Must receive or record discrepancy for a positive quantity on SKU ${reqLine.skuId}`,
            409,
          );
        }

        if (totalClearedNowMilli > remainingInTransitMilli) {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.TRANSFER_QUANTITY_MISMATCH,
            `Cannot receive/resolve ${formatMilliToQty(totalClearedNowMilli)} for SKU ${reqLine.skuId}; only ${formatMilliToQty(remainingInTransitMilli)} remains in transit`,
            409,
          );
        }

        // Lock destination stock_balance row
        await lockStockBalance(
          em,
          tenantId,
          header.to_warehouse_id,
          reqLine.skuId,
        );
        const destBalRows = await em.query(
          `
          SELECT
            on_hand_qty AS "onHandQty",
            reserved_qty AS "reservedQty",
            in_transit_qty AS "inTransitQty",
            COALESCE(avg_unit_cost, 0) AS "avgUnitCost",
            COALESCE(valuation_amount, 0) AS "valuationAmount"
          FROM ${prefix}"stock_balance"
          WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
          FOR UPDATE
          `,
          [tenantId, header.to_warehouse_id, reqLine.skuId],
        );

        // on hand may rise only by what leaves in-transit: refuse when the
        // counter holds less than we are about to clear (never clamp)
        const inTransitMilli =
          destBalRows.length > 0
            ? parseQtyToMilli(String(destBalRows[0].inTransitQty), true, false)
            : 0n;
        if (inTransitMilli < totalClearedNowMilli) {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.TRANSFER_QUANTITY_MISMATCH,
            `Destination in-transit quantity (${formatMilliToQty(inTransitMilli)}) for SKU ${reqLine.skuId} is lower than ${formatMilliToQty(totalClearedNowMilli)}`,
            409,
          );
        }

        const oldOnHandQty =
          destBalRows.length > 0
            ? formatMilliToQty(
                parseQtyToMilli(String(destBalRows[0].onHandQty), true, false),
              )
            : '0.000';
        const oldReservedQty =
          destBalRows.length > 0
            ? formatMilliToQty(
                parseQtyToMilli(
                  String(destBalRows[0].reservedQty),
                  true,
                  false,
                ),
              )
            : '0.000';
        const oldAvgCost =
          destBalRows.length > 0
            ? vndToNumber(parseMoneyToVnd(String(destBalRows[0].avgUnitCost)))
            : 0;
        const oldValuation =
          destBalRows.length > 0
            ? vndToNumber(
                parseMoneyToVnd(String(destBalRows[0].valuationAmount)),
              )
            : 0;

        const unitCostStr = vndToNumber(
          parseMoneyToVnd(String(dbItem.unitCost ?? '0')),
        );
        const clearedStr = formatMilliToQty(totalClearedNowMilli);

        let newOnHandQty = oldOnHandQty;
        let newAvgCost = oldAvgCost;
        let newValuation = oldValuation;

        if (receiveNowMilli > 0n) {
          const receiveNowStr = formatMilliToQty(receiveNowMilli);
          const valuation = computeWeightedAverageCostOnReceipt({
            currentOnHandQty: oldOnHandQty,
            currentAvgUnitCost: oldAvgCost,
            receivedBaseQty: receiveNowStr,
            receivedUnitCost: unitCostStr,
          });
          newOnHandQty = valuation.newOnHandQty;
          newAvgCost = valuation.newAvgUnitCost;
          newValuation = valuation.newValuationAmount;

          await em.query(
            `
            INSERT INTO ${prefix}"stock_balance_ledger" (
              id, tenant_id, warehouse_id, sku_id, movement_type,
              qty_before, qty_delta, on_hand_after, reserved_after,
              unit_cost, avg_cost_after, reference_type, reference_id,
              actor_id, correlation_id, reason, occurred_at
            ) VALUES (
              $1, $2, $3, $4, 'TRANSFER_RECEIPT',
              $5::numeric(18,3), $6::numeric(18,3), $7::numeric(18,3), $8::numeric(18,3),
              $9::bigint, $10::bigint, 'STOCK_TRANSFER', $11,
              $12, $13, $14, $15
            )
            `,
            [
              randomUUID(),
              tenantId,
              header.to_warehouse_id,
              reqLine.skuId,
              oldOnHandQty,
              receiveNowStr,
              newOnHandQty,
              oldReservedQty,
              unitCostStr,
              newAvgCost,
              transferId,
              actorId,
              correlationId,
              reqLine.discrepancyReason ?? header.note ?? null,
              occurredAt,
            ],
          );

          if (this.outbox) {
            await this.outbox.add(em, INVENTORY_STOCK_CHANGED, {
              warehouseId: header.to_warehouse_id,
              skuId: reqLine.skuId,
              movementType: 'TRANSFER_RECEIPT',
              qtyDelta: receiveNowStr,
              onHandAfter: newOnHandQty,
              reservedAfter: oldReservedQty,
              unitCost: unitCostStr,
              avgCostAfter: newAvgCost,
              referenceType: 'STOCK_TRANSFER',
              referenceId: transferId,
              occurredAt,
            } satisfies StockChangedPayload);
          }
        }

        if (totalClearedNowMilli > 0n) {
          await em.query(
            `
            UPDATE ${prefix}"stock_balance"
            SET
              on_hand_qty = on_hand_qty + $4::numeric(18,3),
              in_transit_qty = in_transit_qty - $5::numeric(18,3),
              avg_unit_cost = $6::bigint,
              valuation_amount = $7::bigint,
              version = version + 1,
              updated_at = now()
            WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
            `,
            [
              tenantId,
              header.to_warehouse_id,
              reqLine.skuId,
              formatMilliToQty(receiveNowMilli),
              clearedStr,
              newAvgCost,
              newValuation,
            ],
          );
        }

        const nextReceivedStr = formatMilliToQty(
          prevReceivedMilli + receiveNowMilli,
        );
        const nextDiscrepancyStr = formatMilliToQty(
          prevDiscrepancyMilli + discrepancyNowMilli,
        );

        await em.query(
          `
          UPDATE ${prefix}"stock_transfer_item"
          SET
            received_qty = $3::numeric(18,3),
            discrepancy_qty = $4::numeric(18,3),
            discrepancy_reason = COALESCE($5, discrepancy_reason)
          WHERE tenant_id = $1 AND id = $2
          `,
          [
            tenantId,
            dbItem.id,
            nextReceivedStr,
            nextDiscrepancyStr,
            reqLine.discrepancyReason ?? null,
          ],
        );
      }

      // Re-evaluate all transfer lines to determine next transfer status
      const updatedItems = await em.query(
        `
        SELECT
          dispatched_qty AS "dispatchedQty",
          received_qty AS "receivedQty",
          discrepancy_qty AS "discrepancyQty"
        FROM ${prefix}"stock_transfer_item"
        WHERE tenant_id = $1 AND transfer_id = $2
        `,
        [tenantId, transferId],
      );

      let anyRemainingInTransit = false;
      let anyDiscrepancy = false;

      for (const row of updatedItems) {
        const disp = parseQtyToMilli(String(row.dispatchedQty), true, false);
        const rec = parseQtyToMilli(String(row.receivedQty), true, false);
        const disc = parseQtyToMilli(String(row.discrepancyQty), true, false);
        if (rec + disc < disp) {
          anyRemainingInTransit = true;
        }
        if (disc > 0n) {
          anyDiscrepancy = true;
        }
      }

      let nextStatus: string;
      if (anyRemainingInTransit) {
        nextStatus = 'PARTIALLY_RECEIVED';
      } else if (anyDiscrepancy && !dto?.resolveDiscrepancy) {
        nextStatus = 'DISCREPANCY';
      } else {
        nextStatus = 'RECEIVED';
      }

      // D17: closing a transfer that has lost units books the loss
      if (nextStatus === 'RECEIVED' && dto?.resolveDiscrepancy) {
        await this.writeTransferLosses(em, prefix, tenantId, header, {
          transferId,
          actorId,
          correlationId,
          occurredAt,
        });
      }

      await em.query(
        `
        UPDATE ${prefix}"stock_transfer"
        SET
          status = $3,
          received_by = $4,
          received_at = $5::timestamptz,
          updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        `,
        [tenantId, transferId, nextStatus, actorId, occurredAt],
      );

      if (this.outbox) {
        await this.outbox.add(em, INVENTORY_TRANSFER_RECEIVED, {
          transferId,
          code: header.code,
          fromWarehouseId: header.from_warehouse_id,
          toWarehouseId: header.to_warehouse_id,
          status: nextStatus,
          receivedAt: occurredAt,
        });
      }

      return this.loadTransferResponse(em, prefix, tenantId, transferId);
    });
  }

  /**
   * D17: the units recorded as lost in transit are written off at the
   * dispatch cost when the discrepancy is closed. They never reached on
   * hand, so the loss is booked as an in/out pair at the destination: the
   * ledger still nets to the on-hand quantity (reconciliation stays clean)
   * and the `TRANSFER_LOSS` row carries the quantity and the dispatch cost.
   * The balance row is not touched. One `inventory.stock.changed` per line,
   * movement `TRANSFER_LOSS`.
   */
  private async writeTransferLosses(
    em: EntityManager,
    prefix: string,
    tenantId: string,
    header: Record<string, unknown>,
    ctx: {
      transferId: string;
      actorId: string;
      correlationId: string | null;
      occurredAt: string;
    },
  ) {
    const lines = await em.query(
      `
      SELECT sku_id AS "skuId", discrepancy_qty AS "discrepancyQty",
             unit_cost AS "unitCost", discrepancy_reason AS "reason"
      FROM ${prefix}"stock_transfer_item"
      WHERE tenant_id = $1 AND transfer_id = $2 AND discrepancy_qty > 0
      ORDER BY sku_id ASC
      `,
      [tenantId, ctx.transferId],
    );
    for (const line of lines) {
      const lostMilli = parseQtyToMilli(
        String(line.discrepancyQty),
        false,
        false,
      );
      const lostStr = formatMilliToQty(lostMilli);
      const costStr = vndToNumber(
        parseMoneyToVnd(String(line.unitCost ?? '0')),
      );
      await lockStockBalance(
        em,
        tenantId,
        String(header.to_warehouse_id),
        line.skuId,
      );
      const [bal] = await em.query(
        `
        SELECT on_hand_qty AS "onHandQty", reserved_qty AS "reservedQty",
               COALESCE(avg_unit_cost, 0) AS "avgUnitCost"
        FROM ${prefix}"stock_balance"
        WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
        FOR UPDATE
        `,
        [tenantId, header.to_warehouse_id, line.skuId],
      );
      const onHand = formatMilliToQty(
        parseQtyToMilli(String(bal?.onHandQty ?? '0'), true, false),
      );
      const reserved = formatMilliToQty(
        parseQtyToMilli(String(bal?.reservedQty ?? '0'), true, false),
      );
      const avg = vndToNumber(parseMoneyToVnd(String(bal?.avgUnitCost ?? '0')));
      const onHandPlusLost = formatMilliToQty(
        parseQtyToMilli(onHand, true, false) + lostMilli,
      );
      const reason = `Lost in transit: ${line.reason ?? header.note ?? ctx.transferId}`;
      const ledgerRow = (
        type: string,
        before: string,
        delta: string,
        after: string,
      ) =>
        em.query(
          `
          INSERT INTO ${prefix}"stock_balance_ledger" (
            id, tenant_id, warehouse_id, sku_id, movement_type,
            qty_before, qty_delta, on_hand_after, reserved_after,
            unit_cost, avg_cost_after, reference_type, reference_id,
            actor_id, correlation_id, reason, occurred_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6::numeric(18,3), $7::numeric(18,3), $8::numeric(18,3), $9::numeric(18,3),
            $10::bigint, $11::bigint, 'STOCK_TRANSFER', $12,
            $13, $14, $15, $16
          )
          `,
          [
            randomUUID(),
            tenantId,
            header.to_warehouse_id,
            line.skuId,
            type,
            before,
            delta,
            after,
            reserved,
            costStr,
            avg,
            ctx.transferId,
            ctx.actorId,
            ctx.correlationId,
            reason.slice(0, 255),
            ctx.occurredAt,
          ],
        );
      await ledgerRow('TRANSFER_LOST_IN', onHand, lostStr, onHandPlusLost);
      await ledgerRow('TRANSFER_LOSS', onHandPlusLost, `-${lostStr}`, onHand);
      if (this.outbox) {
        await this.outbox.add(em, INVENTORY_STOCK_CHANGED, {
          warehouseId: header.to_warehouse_id as string,
          skuId: line.skuId,
          movementType: 'TRANSFER_LOSS',
          qtyDelta: `-${lostStr}`,
          onHandAfter: onHand,
          reservedAfter: reserved,
          unitCost: costStr,
          avgCostAfter: avg,
          referenceType: 'STOCK_TRANSFER',
          referenceId: ctx.transferId,
          occurredAt: ctx.occurredAt,
        } satisfies StockChangedPayload);
      }
    }
  }

  /**
   * D17: cancel a transfer. A DRAFT only changes status. After dispatch the
   * units not yet received (dispatched - received - lost) leave the
   * destination in-transit counter and return to the source warehouse at the
   * dispatch cost with a reversing ledger row (`TRANSFER_CANCEL`,
   * `reversal_of_ledger_id` = the dispatch row) and an
   * `inventory.stock.changed` event; units already received stay.
   */
  async cancelTransfer(transferId: string, reason?: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const headerRows = await em.query(
        `SELECT * FROM ${prefix}"stock_transfer"
         WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, transferId],
      );
      if (headerRows.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.TRANSFER_NOT_FOUND,
          `Stock transfer ${transferId} not found`,
          404,
        );
      }
      const header = headerRows[0];
      assertCanCancelStockTransfer(header.status);

      const occurredAt = new Date().toISOString();
      const actorId = RequestContext.get()?.actor?.id ?? 'system';
      const correlationId = RequestContext.get()?.requestId ?? null;

      if (header.status !== 'DRAFT') {
        const items = await em.query(
          `
          SELECT id, sku_id AS "skuId",
                 dispatched_qty AS "dispatchedQty",
                 received_qty AS "receivedQty",
                 discrepancy_qty AS "discrepancyQty",
                 unit_cost AS "unitCost"
          FROM ${prefix}"stock_transfer_item"
          WHERE tenant_id = $1 AND transfer_id = $2
          ORDER BY sku_id ASC
          FOR UPDATE
          `,
          [tenantId, transferId],
        );
        for (const item of items) {
          const remainingMilli =
            parseQtyToMilli(String(item.dispatchedQty), true, false) -
            parseQtyToMilli(String(item.receivedQty), true, false) -
            parseQtyToMilli(String(item.discrepancyQty), true, false);
          if (remainingMilli <= 0n) continue;
          const remainingStr = formatMilliToQty(remainingMilli);
          const unitCost = vndToNumber(
            parseMoneyToVnd(String(item.unitCost ?? '0')),
          );

          // destination: take the units off the road (never clamp)
          await lockStockBalance(
            em,
            tenantId,
            header.to_warehouse_id,
            item.skuId,
          );
          const [dest] = await em.query(
            `SELECT in_transit_qty AS "inTransitQty"
             FROM ${prefix}"stock_balance"
             WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
             FOR UPDATE`,
            [tenantId, header.to_warehouse_id, item.skuId],
          );
          if (
            !dest ||
            parseQtyToMilli(String(dest.inTransitQty), true, false) <
              remainingMilli
          ) {
            throw new InventoryDomainError(
              InventoryDomainErrorCode.TRANSFER_QUANTITY_MISMATCH,
              `Destination in-transit quantity for SKU ${item.skuId} is lower than the ${remainingStr} to return`,
              409,
            );
          }
          await em.query(
            `UPDATE ${prefix}"stock_balance"
             SET in_transit_qty = in_transit_qty - $4::numeric(18,3),
                 version = version + 1, updated_at = now()
             WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3`,
            [tenantId, header.to_warehouse_id, item.skuId, remainingStr],
          );

          // source: the units come back at the dispatch cost
          await lockStockBalance(
            em,
            tenantId,
            header.from_warehouse_id,
            item.skuId,
          );
          const [src] = await em.query(
            `SELECT on_hand_qty AS "onHandQty", reserved_qty AS "reservedQty",
                    COALESCE(avg_unit_cost, 0) AS "avgUnitCost"
             FROM ${prefix}"stock_balance"
             WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
             FOR UPDATE`,
            [tenantId, header.from_warehouse_id, item.skuId],
          );
          const oldOnHand = formatMilliToQty(
            parseQtyToMilli(String(src?.onHandQty ?? '0'), true, false),
          );
          const reserved = formatMilliToQty(
            parseQtyToMilli(String(src?.reservedQty ?? '0'), true, false),
          );
          const oldAvg = vndToNumber(
            parseMoneyToVnd(String(src?.avgUnitCost ?? '0')),
          );
          const valuation = computeWeightedAverageCostOnReceipt({
            currentOnHandQty: oldOnHand,
            currentAvgUnitCost: oldAvg,
            receivedBaseQty: remainingStr,
            receivedUnitCost: unitCost,
          });
          await em.query(
            `
            INSERT INTO ${prefix}"stock_balance" (
              id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty,
              in_transit_qty, avg_unit_cost, valuation_amount, version, updated_at
            ) VALUES ($1, $2, $3, $4, $5::numeric(18,3), 0, 0, $6::bigint, $7::bigint, 1, now())
            ON CONFLICT (tenant_id, warehouse_id, sku_id) DO UPDATE
            SET on_hand_qty = ${prefix}"stock_balance".on_hand_qty + $8::numeric(18,3),
                avg_unit_cost = $6::bigint,
                valuation_amount = $7::bigint,
                version = ${prefix}"stock_balance".version + 1,
                updated_at = now()
            `,
            [
              randomUUID(),
              tenantId,
              header.from_warehouse_id,
              item.skuId,
              valuation.newOnHandQty,
              valuation.newAvgUnitCost,
              valuation.newValuationAmount,
              remainingStr,
            ],
          );
          const [dispatchRow] = await em.query(
            `SELECT id FROM ${prefix}"stock_balance_ledger"
             WHERE tenant_id = $1 AND reference_type = 'STOCK_TRANSFER'
               AND reference_id = $2 AND warehouse_id = $3 AND sku_id = $4
               AND movement_type = 'TRANSFER_DISPATCH'
             ORDER BY occurred_at DESC LIMIT 1`,
            [tenantId, transferId, header.from_warehouse_id, item.skuId],
          );
          await em.query(
            `
            INSERT INTO ${prefix}"stock_balance_ledger" (
              id, tenant_id, warehouse_id, sku_id, movement_type,
              qty_before, qty_delta, on_hand_after, reserved_after,
              unit_cost, avg_cost_after, reference_type, reference_id,
              actor_id, correlation_id, reason, reversal_of_ledger_id, occurred_at
            ) VALUES (
              $1, $2, $3, $4, 'TRANSFER_CANCEL',
              $5::numeric(18,3), $6::numeric(18,3), $7::numeric(18,3), $8::numeric(18,3),
              $9::bigint, $10::bigint, 'STOCK_TRANSFER', $11,
              $12, $13, $14, $15, $16
            )
            `,
            [
              randomUUID(),
              tenantId,
              header.from_warehouse_id,
              item.skuId,
              oldOnHand,
              remainingStr,
              valuation.newOnHandQty,
              reserved,
              unitCost,
              valuation.newAvgUnitCost,
              transferId,
              actorId,
              correlationId,
              (reason ?? 'Transfer cancelled after dispatch').slice(0, 255),
              dispatchRow?.id ?? null,
              occurredAt,
            ],
          );
          if (this.outbox) {
            await this.outbox.add(em, INVENTORY_STOCK_CHANGED, {
              warehouseId: header.from_warehouse_id,
              skuId: item.skuId,
              movementType: 'TRANSFER_CANCEL',
              qtyDelta: remainingStr,
              onHandAfter: valuation.newOnHandQty,
              reservedAfter: reserved,
              unitCost,
              avgCostAfter: valuation.newAvgUnitCost,
              referenceType: 'STOCK_TRANSFER',
              referenceId: transferId,
              occurredAt,
            } satisfies StockChangedPayload);
          }
        }
      }

      await em.query(
        `UPDATE ${prefix}"stock_transfer"
         SET status = 'CANCELLED', cancelled_by = $3, cancelled_at = $4::timestamptz,
             cancel_reason = $5, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, transferId, actorId, occurredAt, reason ?? null],
      );
      return this.loadTransferResponse(em, prefix, tenantId, transferId);
    });
  }

  async listTransfers(
    warehouseId?: string,
    status?: string,
    scope?: WarehouseScope,
  ) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const params: unknown[] = [tenantId];
      const filters: string[] = [];

      if (warehouseId) {
        params.push(warehouseId);
        filters.push(
          `AND (from_warehouse_id = $${params.length} OR to_warehouse_id = $${params.length})`,
        );
      }
      if (status) {
        params.push(status);
        filters.push(`AND status = $${params.length}`);
      }
      if (scope) {
        // visible when either end is in scope
        params.push(scope);
        filters.push(
          `AND (from_warehouse_id = ANY($${params.length}::uuid[]) OR to_warehouse_id = ANY($${params.length}::uuid[]))`,
        );
      }

      const headers = await em.query(
        `
        SELECT id
        FROM ${prefix}"stock_transfer"
        WHERE tenant_id = $1 ${filters.join(' ')}
        ORDER BY created_at DESC
        LIMIT 100
        `,
        params,
      );
      const results = [];
      for (const h of headers) {
        results.push(
          await this.loadTransferResponse(em, prefix, tenantId, h.id),
        );
      }
      return results;
    });
  }

  async getTransferById(transferId: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      return this.loadTransferResponse(em, prefix, tenantId, transferId);
    });
  }

  private async loadTransferResponse(
    em: EntityManager,
    prefix: string,
    tenantId: string,
    transferId: string,
  ) {
    const headers = await em.query(
      `
      SELECT
        id,
        tenant_id AS "tenantId",
        code,
        from_warehouse_id AS "fromWarehouseId",
        to_warehouse_id AS "toWarehouseId",
        status,
        note,
        dispatched_by AS "dispatchedBy",
        dispatched_at AS "dispatchedAt",
        received_by AS "receivedBy",
        received_at AS "receivedAt",
        cancelled_by AS "cancelledBy",
        cancelled_at AS "cancelledAt",
        cancel_reason AS "cancelReason",
        created_by AS "createdBy",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ${prefix}"stock_transfer"
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1
      `,
      [tenantId, transferId],
    );
    if (headers.length === 0) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.TRANSFER_NOT_FOUND,
        `Stock transfer ${transferId} not found`,
        404,
      );
    }

    const items = await em.query(
      `
      SELECT
        id,
        line_no AS "lineNo",
        sku_id AS "skuId",
        transfer_qty AS "transferQty",
        dispatched_qty AS "dispatchedQty",
        received_qty AS "receivedQty",
        discrepancy_qty AS "discrepancyQty",
        (dispatched_qty - received_qty - discrepancy_qty) AS "inTransitRemainingQty",
        unit_cost AS "unitCost",
        discrepancy_reason AS "discrepancyReason"
      FROM ${prefix}"stock_transfer_item"
      WHERE tenant_id = $1 AND transfer_id = $2
      ORDER BY line_no ASC
      `,
      [tenantId, transferId],
    );

    const status = String(headers[0].status);
    const daysOpen = transferDaysOpen(status, headers[0].dispatchedAt);
    return {
      ...headers[0],
      // D17: still on the road after TRANSFER_OVERDUE_DAYS days
      daysOpen,
      overdue: isTransferOverdue(daysOpen),
      items: items.map((i: Record<string, unknown>) => ({
        id: i.id,
        lineNo: Number(i.lineNo),
        skuId: i.skuId,
        transferQty: formatMilliToQty(
          parseQtyToMilli(String(i.transferQty), false, false),
        ),
        dispatchedQty: formatMilliToQty(
          parseQtyToMilli(String(i.dispatchedQty), true, false),
        ),
        receivedQty: formatMilliToQty(
          parseQtyToMilli(String(i.receivedQty), true, false),
        ),
        discrepancyQty: formatMilliToQty(
          parseQtyToMilli(String(i.discrepancyQty), true, false),
        ),
        // a cancelled transfer has nothing on the road: the rest went back
        inTransitRemainingQty:
          status === 'CANCELLED'
            ? '0.000'
            : formatMilliToQty(
                parseQtyToMilli(
                  String(i.inTransitRemainingQty ?? '0'),
                  true,
                  true,
                ),
              ),
        returnedQty:
          status === 'CANCELLED'
            ? formatMilliToQty(
                parseQtyToMilli(
                  String(i.inTransitRemainingQty ?? '0'),
                  true,
                  true,
                ),
              )
            : '0.000',
        unitCost: vndToNumber(parseMoneyToVnd(String(i.unitCost ?? '0'))),
        discrepancyReason: i.discrepancyReason,
      })),
    };
  }
}
