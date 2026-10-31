import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { RequestContext, runInTenantTransaction } from '@pbl/common';
import {
  INVENTORY_STOCK_CHANGED,
  INVENTORY_STOCKTAKE_ADJUSTED,
  StockChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  formatCentsToMoney,
  formatMilliToQty,
  InventoryDomainError,
  InventoryDomainErrorCode,
  normalizeInventoryCode,
  parseMoneyToCents,
  parseQtyToMilli,
} from '../../domain/inventory-domain';
import {
  applyWarehouseScope,
  WarehouseScope,
} from '../../scope/warehouse-scope';
import {
  assertActiveWarehouse,
  schemaPrefix,
} from '../warehouses/warehouses.service';
import {
  ApproveStocktakeDto,
  CreateStocktakeDto,
  RecordStocktakeCountsDto,
} from './stocktake.dto';

@Injectable()
export class StocktakeService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly outbox?: EventOutbox,
  ) {}

  async createStocktake(dto: CreateStocktakeDto) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      await assertActiveWarehouse(em, prefix, tenantId, dto.warehouseId);

      const stockTakeId = randomUUID();
      const code = dto.code
        ? normalizeInventoryCode(dto.code, 'stocktake code')
        : `STK-${stockTakeId.slice(0, 8).toUpperCase()}`;

      await em.query(
        `
        INSERT INTO ${prefix}"stock_take" (
          id, tenant_id, code, warehouse_id, status, freeze_movement, note, created_by
        ) VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7)
        `,
        [
          stockTakeId,
          tenantId,
          code,
          dto.warehouseId,
          dto.freezeMovement ?? false,
          dto.note ?? null,
          RequestContext.get()?.actor?.id ?? null,
        ],
      );

      if (dto.skuIds && dto.skuIds.length > 0) {
        const uniqueSkuIds = Array.from(new Set(dto.skuIds)).sort();
        for (let i = 0; i < uniqueSkuIds.length; i += 1) {
          const skuId = uniqueSkuIds[i];
          const snap = await this.readCurrentSnapshot(
            em,
            prefix,
            tenantId,
            dto.warehouseId,
            skuId,
          );
          await em.query(
            `
            INSERT INTO ${prefix}"stock_take_item" (
              id, tenant_id, stock_take_id, line_no, sku_id,
              snapshot_on_hand_qty, snapshot_reserved_qty, snapshot_version
            ) VALUES ($1, $2, $3, $4, $5, $6::numeric(18,3), $7::numeric(18,3), $8)
            `,
            [
              randomUUID(),
              tenantId,
              stockTakeId,
              i + 1,
              skuId,
              snap.onHandQty,
              snap.reservedQty,
              snap.version,
            ],
          );
        }
      }

      return this.loadStocktakeResponse(em, prefix, tenantId, stockTakeId);
    });
  }

  async recordCounts(stockTakeId: string, dto: RecordStocktakeCountsDto) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);

      const headerRows = await em.query(
        `
        SELECT *
        FROM ${prefix}"stock_take"
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE
        `,
        [tenantId, stockTakeId],
      );
      if (headerRows.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.STOCKTAKE_NOT_FOUND,
          `Stocktake ${stockTakeId} not found`,
          404,
        );
      }
      const header = headerRows[0];
      if (!['DRAFT', 'COUNTING'].includes(header.status)) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.STOCKTAKE_INVALID_STATE,
          `Cannot record counts on stocktake in state ${header.status}`,
          409,
        );
      }

      const maxLineRows = await em.query(
        `
        SELECT COALESCE(MAX(line_no), 0)::int AS "maxLine"
        FROM ${prefix}"stock_take_item"
        WHERE tenant_id = $1 AND stock_take_id = $2
        `,
        [tenantId, stockTakeId],
      );
      let nextLineNo = Number(maxLineRows[0]?.maxLine ?? 0) + 1;

      for (const countLine of dto.counts) {
        const countedMilli = parseQtyToMilli(countLine.countedQty, true, false);
        const countedStr = formatMilliToQty(countedMilli);

        const existingItemRows = await em.query(
          `
          SELECT
            id,
            snapshot_on_hand_qty AS "snapshotOnHandQty",
            snapshot_reserved_qty AS "snapshotReservedQty",
            snapshot_version AS "snapshotVersion"
          FROM ${prefix}"stock_take_item"
          WHERE tenant_id = $1 AND stock_take_id = $2 AND sku_id = $3
          LIMIT 1
          `,
          [tenantId, stockTakeId, countLine.skuId],
        );

        if (existingItemRows.length > 0 && !dto.refreshSnapshot) {
          const ex = existingItemRows[0];
          const snapOnHandMilli = parseQtyToMilli(
            String(ex.snapshotOnHandQty),
            true,
            false,
          );
          const varianceStr = formatMilliToQty(countedMilli - snapOnHandMilli);
          await em.query(
            `
            UPDATE ${prefix}"stock_take_item"
            SET
              counted_qty = $3::numeric(18,3),
              variance_qty = $4::numeric(18,3),
              reason = COALESCE($5, reason)
            WHERE tenant_id = $1 AND id = $2
            `,
            [
              tenantId,
              ex.id,
              countedStr,
              varianceStr,
              countLine.reason ?? null,
            ],
          );
        } else {
          const snap = await this.readCurrentSnapshot(
            em,
            prefix,
            tenantId,
            header.warehouse_id,
            countLine.skuId,
          );
          const snapOnHandMilli = parseQtyToMilli(snap.onHandQty, true, false);
          const varianceStr = formatMilliToQty(countedMilli - snapOnHandMilli);

          if (existingItemRows.length > 0) {
            await em.query(
              `
              UPDATE ${prefix}"stock_take_item"
              SET
                snapshot_on_hand_qty = $3::numeric(18,3),
                snapshot_reserved_qty = $4::numeric(18,3),
                snapshot_version = $5,
                counted_qty = $6::numeric(18,3),
                variance_qty = $7::numeric(18,3),
                reason = COALESCE($8, reason)
              WHERE tenant_id = $1 AND id = $2
              `,
              [
                tenantId,
                existingItemRows[0].id,
                snap.onHandQty,
                snap.reservedQty,
                snap.version,
                countedStr,
                varianceStr,
                countLine.reason ?? null,
              ],
            );
          } else {
            await em.query(
              `
              INSERT INTO ${prefix}"stock_take_item" (
                id, tenant_id, stock_take_id, line_no, sku_id,
                snapshot_on_hand_qty, snapshot_reserved_qty, snapshot_version,
                counted_qty, variance_qty, reason
              ) VALUES ($1, $2, $3, $4, $5, $6::numeric(18,3), $7::numeric(18,3), $8, $9::numeric(18,3), $10::numeric(18,3), $11)
              `,
              [
                randomUUID(),
                tenantId,
                stockTakeId,
                nextLineNo++,
                countLine.skuId,
                snap.onHandQty,
                snap.reservedQty,
                snap.version,
                countedStr,
                varianceStr,
                countLine.reason ?? null,
              ],
            );
          }
        }
      }

      await em.query(
        `
        UPDATE ${prefix}"stock_take"
        SET status = 'COUNTING', updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        `,
        [tenantId, stockTakeId],
      );

      return this.loadStocktakeResponse(em, prefix, tenantId, stockTakeId);
    });
  }

  async approveStocktake(stockTakeId: string, dto?: ApproveStocktakeDto) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);

      const headerRows = await em.query(
        `
        SELECT *
        FROM ${prefix}"stock_take"
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE
        `,
        [tenantId, stockTakeId],
      );
      if (headerRows.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.STOCKTAKE_NOT_FOUND,
          `Stocktake ${stockTakeId} not found`,
          404,
        );
      }
      const header = headerRows[0];
      if (header.status !== 'COUNTING') {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.STOCKTAKE_INVALID_STATE,
          `Cannot approve stocktake in state ${header.status}; counts must be recorded first`,
          409,
        );
      }

      await assertActiveWarehouse(em, prefix, tenantId, header.warehouse_id);

      const items = await em.query(
        `
        SELECT
          id,
          line_no AS "lineNo",
          sku_id AS "skuId",
          snapshot_on_hand_qty AS "snapshotOnHandQty",
          snapshot_reserved_qty AS "snapshotReservedQty",
          snapshot_version AS "snapshotVersion",
          counted_qty AS "countedQty",
          reason
        FROM ${prefix}"stock_take_item"
        WHERE tenant_id = $1 AND stock_take_id = $2
        ORDER BY sku_id ASC
        FOR UPDATE
        `,
        [tenantId, stockTakeId],
      );

      if (items.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.STOCKTAKE_INVALID_STATE,
          'Cannot approve stocktake with zero counted items',
          409,
        );
      }

      const occurredAt = new Date().toISOString();
      const actorId = RequestContext.get()?.actor?.id ?? 'system';
      const correlationId = RequestContext.get()?.requestId ?? null;

      for (const item of items) {
        if (item.countedQty === null || item.countedQty === undefined) {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.STOCKTAKE_INVALID_STATE,
            `SKU ${item.skuId} is missing a counted quantity`,
            409,
          );
        }

        const countedMilli = parseQtyToMilli(
          String(item.countedQty),
          true,
          false,
        );
        const countedStr = formatMilliToQty(countedMilli);

        const balRows = await em.query(
          `
          SELECT
            on_hand_qty AS "onHandQty",
            reserved_qty AS "reservedQty",
            COALESCE(avg_unit_cost, 0) AS "avgUnitCost",
            version
          FROM ${prefix}"stock_balance"
          WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
          FOR UPDATE
          `,
          [tenantId, header.warehouse_id, item.skuId],
        );

        const currentOnHandMilli =
          balRows.length > 0
            ? parseQtyToMilli(String(balRows[0].onHandQty), true, false)
            : 0n;
        const currentReservedMilli =
          balRows.length > 0
            ? parseQtyToMilli(String(balRows[0].reservedQty), true, false)
            : 0n;
        const currentVersion =
          balRows.length > 0 ? BigInt(String(balRows[0].version)) : 0n;
        const avgCostCents =
          balRows.length > 0
            ? parseMoneyToCents(String(balRows[0].avgUnitCost))
            : 0n;

        const snapVersion = BigInt(String(item.snapshotVersion));

        // 1. Check for stale snapshot (concurrent stock mutation while counting)
        if (currentVersion !== snapVersion && !dto?.forceRebase) {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.STOCKTAKE_STALE_SNAPSHOT,
            `Stock for SKU ${item.skuId} changed while counting (snapshot version ${snapVersion.toString()}, current version ${currentVersion.toString()}). Re-count or pass forceRebase=true.`,
            409,
            {
              skuId: item.skuId,
              snapshotVersion: Number(snapVersion),
              currentVersion: Number(currentVersion),
              snapshotOnHandQty: formatMilliToQty(
                parseQtyToMilli(String(item.snapshotOnHandQty), true, false),
              ),
              currentOnHandQty: formatMilliToQty(currentOnHandMilli),
            },
          );
        }

        // 2. Ensure counted_qty >= currentReservedMilli (never invalidate active reservations)
        if (countedMilli < currentReservedMilli) {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.STOCKTAKE_BELOW_RESERVED,
            `Counted quantity (${countedStr}) for SKU ${item.skuId} is below active reserved quantity (${formatMilliToQty(currentReservedMilli)})`,
            409,
            {
              skuId: item.skuId,
              countedQty: countedStr,
              reservedQty: formatMilliToQty(currentReservedMilli),
            },
          );
        }

        const varianceMilli = countedMilli - currentOnHandMilli;
        const varianceStr = formatMilliToQty(varianceMilli);

        await em.query(
          `
          UPDATE ${prefix}"stock_take_item"
          SET variance_qty = $3::numeric(18,3)
          WHERE tenant_id = $1 AND id = $2
          `,
          [tenantId, item.id, varianceStr],
        );

        if (varianceMilli === 0n) {
          continue;
        }

        const newValuationCents =
          countedMilli === 0n
            ? 0n
            : (countedMilli * avgCostCents + 500n) / 1000n;
        const avgCostStr = formatCentsToMoney(avgCostCents);
        const newValuationStr = formatCentsToMoney(newValuationCents);
        const oldOnHandStr = formatMilliToQty(currentOnHandMilli);
        const reservedStr = formatMilliToQty(currentReservedMilli);

        await em.query(
          `
          INSERT INTO ${prefix}"stock_balance" (
            id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty, in_transit_qty,
            avg_unit_cost, valuation_amount, version, updated_at
          ) VALUES ($1, $2, $3, $4, $5::numeric(18,3), 0, 0, $6::numeric(18,2), $7::numeric(18,2), 1, now())
          ON CONFLICT (tenant_id, warehouse_id, sku_id) DO UPDATE
          SET
            on_hand_qty = $5::numeric(18,3),
            valuation_amount = $7::numeric(18,2),
            version = ${prefix}"stock_balance".version + 1,
            updated_at = now()
          `,
          [
            randomUUID(),
            tenantId,
            header.warehouse_id,
            item.skuId,
            countedStr,
            avgCostStr,
            newValuationStr,
          ],
        );

        await em.query(
          `
          INSERT INTO ${prefix}"stock_balance_ledger" (
            id, tenant_id, warehouse_id, sku_id, movement_type,
            qty_before, qty_delta, on_hand_after, reserved_after,
            unit_cost, avg_cost_after, reference_type, reference_id,
            actor_id, correlation_id, reason, occurred_at
          ) VALUES (
            $1, $2, $3, $4, 'STOCKTAKE_ADJUSTMENT',
            $5::numeric(18,3), $6::numeric(18,3), $7::numeric(18,3), $8::numeric(18,3),
            $9::numeric(18,2), $10::numeric(18,2), 'STOCK_TAKE', $11,
            $12, $13, $14, $15
          )
          `,
          [
            randomUUID(),
            tenantId,
            header.warehouse_id,
            item.skuId,
            oldOnHandStr,
            varianceStr,
            countedStr,
            reservedStr,
            avgCostStr,
            avgCostStr,
            stockTakeId,
            actorId,
            correlationId,
            item.reason ??
              dto?.note ??
              header.note ??
              'Stocktake variance adjustment',
            occurredAt,
          ],
        );

        if (this.outbox) {
          await this.outbox.add(em, INVENTORY_STOCK_CHANGED, {
            warehouseId: header.warehouse_id,
            skuId: item.skuId,
            movementType: 'STOCKTAKE_ADJUSTMENT',
            qtyDelta: varianceStr,
            onHandAfter: countedStr,
            reservedAfter: reservedStr,
            unitCost: avgCostStr,
            avgCostAfter: avgCostStr,
            referenceType: 'STOCK_TAKE',
            referenceId: stockTakeId,
            occurredAt,
          } satisfies StockChangedPayload);
        }
      }

      await em.query(
        `
        UPDATE ${prefix}"stock_take"
        SET
          status = 'APPROVED',
          approved_by = $3,
          approved_at = $4::timestamptz,
          note = COALESCE($5, note),
          updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        `,
        [tenantId, stockTakeId, actorId, occurredAt, dto?.note ?? null],
      );

      if (this.outbox) {
        await this.outbox.add(em, INVENTORY_STOCKTAKE_ADJUSTED, {
          stockTakeId,
          code: header.code,
          warehouseId: header.warehouse_id,
          approvedAt: occurredAt,
        });
      }

      return this.loadStocktakeResponse(em, prefix, tenantId, stockTakeId);
    });
  }

  async getById(stockTakeId: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      return this.loadStocktakeResponse(em, prefix, tenantId, stockTakeId);
    });
  }

  async list(warehouseId?: string, scope?: WarehouseScope) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const params: unknown[] = [tenantId];
      const filters: string[] = [];
      if (warehouseId) {
        params.push(warehouseId);
        filters.push(`AND warehouse_id = $${params.length}`);
      }
      applyWarehouseScope(params, filters, 'warehouse_id', scope);

      const headers = await em.query(
        `
        SELECT id
        FROM ${prefix}"stock_take"
        WHERE tenant_id = $1 ${filters.join(' ')}
        ORDER BY created_at DESC
        LIMIT 100
        `,
        params,
      );
      const results = [];
      for (const h of headers) {
        results.push(
          await this.loadStocktakeResponse(em, prefix, tenantId, h.id),
        );
      }
      return results;
    });
  }

  private async readCurrentSnapshot(
    em: EntityManager,
    prefix: string,
    tenantId: string,
    warehouseId: string,
    skuId: string,
  ) {
    const rows = await em.query(
      `
      SELECT
        on_hand_qty AS "onHandQty",
        reserved_qty AS "reservedQty",
        version
      FROM ${prefix}"stock_balance"
      WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
      LIMIT 1
      `,
      [tenantId, warehouseId, skuId],
    );
    if (rows.length === 0) {
      return { onHandQty: '0.000', reservedQty: '0.000', version: '0' };
    }
    return {
      onHandQty: formatMilliToQty(
        parseQtyToMilli(String(rows[0].onHandQty), true, false),
      ),
      reservedQty: formatMilliToQty(
        parseQtyToMilli(String(rows[0].reservedQty), true, false),
      ),
      version: String(rows[0].version),
    };
  }

  private async loadStocktakeResponse(
    em: EntityManager,
    prefix: string,
    tenantId: string,
    stockTakeId: string,
  ) {
    const headers = await em.query(
      `
      SELECT
        id,
        tenant_id AS "tenantId",
        code,
        warehouse_id AS "warehouseId",
        status,
        freeze_movement AS "freezeMovement",
        note,
        approved_by AS "approvedBy",
        approved_at AS "approvedAt",
        created_by AS "createdBy",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ${prefix}"stock_take"
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1
      `,
      [tenantId, stockTakeId],
    );
    if (headers.length === 0) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.STOCKTAKE_NOT_FOUND,
        `Stocktake ${stockTakeId} not found`,
        404,
      );
    }

    const items = await em.query(
      `
      SELECT
        id,
        line_no AS "lineNo",
        sku_id AS "skuId",
        snapshot_on_hand_qty AS "snapshotOnHandQty",
        snapshot_reserved_qty AS "snapshotReservedQty",
        snapshot_version AS "snapshotVersion",
        counted_qty AS "countedQty",
        variance_qty AS "varianceQty",
        reason
      FROM ${prefix}"stock_take_item"
      WHERE tenant_id = $1 AND stock_take_id = $2
      ORDER BY line_no ASC
      `,
      [tenantId, stockTakeId],
    );

    return {
      ...headers[0],
      items: items.map((i: Record<string, unknown>) => ({
        id: i.id,
        lineNo: Number(i.lineNo),
        skuId: i.skuId,
        snapshotOnHandQty: formatMilliToQty(
          parseQtyToMilli(String(i.snapshotOnHandQty), true, false),
        ),
        snapshotReservedQty: formatMilliToQty(
          parseQtyToMilli(String(i.snapshotReservedQty), true, false),
        ),
        snapshotVersion: Number(i.snapshotVersion),
        countedQty:
          i.countedQty !== null && i.countedQty !== undefined
            ? formatMilliToQty(
                parseQtyToMilli(String(i.countedQty), true, false),
              )
            : null,
        varianceQty:
          i.varianceQty !== null && i.varianceQty !== undefined
            ? formatMilliToQty(
                parseQtyToMilli(String(i.varianceQty), true, true),
              )
            : null,
        reason: i.reason,
      })),
    };
  }
}
