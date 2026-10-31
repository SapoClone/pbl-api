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
import {
  assertCanDispatchStockTransfer,
  assertValidStockTransferWarehouses,
  computeValuationAfterDeduction,
  computeWeightedAverageCostOnReceipt,
  formatCentsToMoney,
  formatMilliToQty,
  InventoryDomainError,
  InventoryDomainErrorCode,
  normalizeAndSortWarehouseLines,
  normalizeInventoryCode,
  parseMoneyToCents,
  parseQtyToMilli,
} from '../../domain/inventory-domain';
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

  async createTransfer(dto: CreateStockTransferDto) {
    assertValidStockTransferWarehouses(dto.fromWarehouseId, dto.toWarehouseId);

    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      await assertActiveWarehouse(em, prefix, tenantId, dto.fromWarehouseId);
      await assertActiveWarehouse(em, prefix, tenantId, dto.toWarehouseId);

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
        { onHandQty: string; reservedQty: string; avgUnitCost: string }
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
            avgUnitCost: formatCentsToMoney(
              parseMoneyToCents(String(balRows[0].avgUnitCost)),
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
            valuation_amount = $5::numeric(18,2),
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
            unit_cost = $4::numeric(18,2)
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
            $9::numeric(18,2), $10::numeric(18,2), 'STOCK_TRANSFER', $11,
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

      const itemBySku = new Map<string, Record<string, unknown>>();
      for (const row of dbItems) {
        itemBySku.set(String(row.skuId), row);
      }

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
        const dbItem = itemBySku.get(reqLine.skuId);
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
            ? formatCentsToMoney(
                parseMoneyToCents(String(destBalRows[0].avgUnitCost)),
              )
            : '0.00';
        const oldValuation =
          destBalRows.length > 0
            ? formatCentsToMoney(
                parseMoneyToCents(String(destBalRows[0].valuationAmount)),
              )
            : '0.00';

        const unitCostStr = formatCentsToMoney(
          parseMoneyToCents(String(dbItem.unitCost ?? '0')),
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
              $9::numeric(18,2), $10::numeric(18,2), 'STOCK_TRANSFER', $11,
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
              on_hand_qty = $4::numeric(18,3),
              in_transit_qty = GREATEST(0, in_transit_qty - $5::numeric(18,3)),
              avg_unit_cost = $6::numeric(18,2),
              valuation_amount = $7::numeric(18,2),
              version = version + 1,
              updated_at = now()
            WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
            `,
            [
              tenantId,
              header.to_warehouse_id,
              reqLine.skuId,
              newOnHandQty,
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

  async listTransfers(warehouseId?: string, status?: string) {
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

    return {
      ...headers[0],
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
        inTransitRemainingQty: formatMilliToQty(
          parseQtyToMilli(String(i.inTransitRemainingQty ?? '0'), true, true),
        ),
        unitCost: formatCentsToMoney(
          parseMoneyToCents(String(i.unitCost ?? '0')),
        ),
        discrepancyReason: i.discrepancyReason,
      })),
    };
  }
}
