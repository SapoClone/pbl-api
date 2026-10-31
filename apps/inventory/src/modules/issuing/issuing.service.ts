import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { RequestContext, runInTenantTransaction } from '@pbl/common';
import {
  INVENTORY_STOCK_CHANGED,
  INVENTORY_STOCK_ISSUED,
  StockChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  computeValuationAfterDeduction,
  formatMilliToQty,
  InventoryDomainError,
  InventoryDomainErrorCode,
  normalizeAndSortWarehouseLines,
  normalizeInventoryCode,
  parseMoneyToVnd,
  parseQtyToMilli,
  vndToNumber,
} from '../../domain/inventory-domain';
import {
  applyWarehouseScope,
  WarehouseScope,
} from '../../scope/warehouse-scope';
import {
  assertActiveWarehouse,
  schemaPrefix,
} from '../warehouses/warehouses.service';
import { CreateStockIssueDto } from './issuing.dto';

@Injectable()
export class IssuingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly outbox?: EventOutbox,
  ) {}

  async createIssue(dto: CreateStockIssueDto, idempotencyKey?: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const cleanKey = idempotencyKey?.trim() || null;

      if (cleanKey) {
        const existingByKey = await em.query(
          `
          SELECT id
          FROM ${prefix}"stock_issue"
          WHERE tenant_id = $1 AND idempotency_key = $2
          LIMIT 1
          `,
          [tenantId, cleanKey],
        );
        if (existingByKey.length > 0) {
          return this.loadIssueResponse(
            em,
            prefix,
            tenantId,
            existingByKey[0].id,
          );
        }
      }

      await assertActiveWarehouse(em, prefix, tenantId, dto.warehouseId);

      const normalizedLines = normalizeAndSortWarehouseLines(
        dto.items.map((item) => ({
          warehouseId: dto.warehouseId,
          skuId: item.skuId,
          qty: item.qty,
        })),
      );

      const issueId = randomUUID();
      const code = dto.code
        ? normalizeInventoryCode(dto.code, 'issue code')
        : `ISS-${issueId.slice(0, 8).toUpperCase()}`;

      await em.query(
        `
        INSERT INTO ${prefix}"stock_issue" (
          id, tenant_id, code, warehouse_id, reason_code, status,
          idempotency_key, note, created_by
        ) VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $7, $8)
        `,
        [
          issueId,
          tenantId,
          code,
          dto.warehouseId,
          dto.reasonCode,
          cleanKey,
          dto.note ?? null,
          RequestContext.get()?.actor?.id ?? null,
        ],
      );

      for (let i = 0; i < normalizedLines.length; i += 1) {
        const line = normalizedLines[i];
        await em.query(
          `
          INSERT INTO ${prefix}"stock_issue_item" (
            id, tenant_id, issue_id, line_no, sku_id, qty, unit_cost
          ) VALUES ($1, $2, $3, $4, $5, $6::numeric(18,3), 0)
          `,
          [randomUUID(), tenantId, issueId, i + 1, line.skuId, line.qty],
        );
      }

      if (dto.autoPost) {
        return this.postIssueInTx(em, tenantId, issueId, cleanKey ?? undefined);
      }

      return this.loadIssueResponse(em, prefix, tenantId, issueId);
    });
  }

  async postIssue(issueId: string, idempotencyKey?: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      return this.postIssueInTx(em, tenantId, issueId, idempotencyKey);
    });
  }

  private async postIssueInTx(
    em: EntityManager,
    tenantId: string,
    issueId: string,
    idempotencyKey?: string,
  ) {
    const prefix = schemaPrefix(em);

    const headerRows = await em.query(
      `
      SELECT *
      FROM ${prefix}"stock_issue"
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE
      `,
      [tenantId, issueId],
    );
    if (headerRows.length === 0) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.STOCK_ISSUE_NOT_FOUND,
        `Stock issue ${issueId} not found`,
        404,
      );
    }
    const header = headerRows[0];

    if (header.status === 'POSTED') {
      if (
        idempotencyKey &&
        header.idempotency_key &&
        header.idempotency_key === idempotencyKey.trim()
      ) {
        return this.loadIssueResponse(em, prefix, tenantId, issueId);
      }
      throw new InventoryDomainError(
        InventoryDomainErrorCode.STOCK_ISSUE_ALREADY_POSTED,
        `Stock issue ${header.code} (${issueId}) has already been posted`,
        409,
      );
    }

    if (header.status !== 'DRAFT') {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.STOCK_ISSUE_INVALID_STATE,
        `Cannot post stock issue in state ${header.status}`,
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
        qty
      FROM ${prefix}"stock_issue_item"
      WHERE tenant_id = $1 AND issue_id = $2
      ORDER BY sku_id ASC
      `,
      [tenantId, issueId],
    );

    // 1. Lock all balances in deterministic sku_id order and verify available_qty >= qty
    const lockedBalances = new Map<
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
      const reqMilli = parseQtyToMilli(String(item.qty), false, false);
      const balanceRows = await em.query(
        `
        SELECT
          on_hand_qty AS "onHandQty",
          reserved_qty AS "reservedQty",
          COALESCE(avg_unit_cost, 0) AS "avgUnitCost"
        FROM ${prefix}"stock_balance"
        WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
        FOR UPDATE
        `,
        [tenantId, header.warehouse_id, item.skuId],
      );

      const onHandMilli =
        balanceRows.length > 0
          ? parseQtyToMilli(String(balanceRows[0].onHandQty), true, false)
          : 0n;
      const reservedMilli =
        balanceRows.length > 0
          ? parseQtyToMilli(String(balanceRows[0].reservedQty), true, false)
          : 0n;
      const availableMilli = onHandMilli - reservedMilli;

      if (availableMilli < reqMilli) {
        shortages.push({
          warehouseId: header.warehouse_id,
          skuId: item.skuId,
          requestedQty: formatMilliToQty(reqMilli),
          availableQty: formatMilliToQty(
            availableMilli > 0n ? availableMilli : 0n,
          ),
        });
      } else {
        lockedBalances.set(String(item.skuId), {
          onHandQty: formatMilliToQty(onHandMilli),
          reservedQty: formatMilliToQty(reservedMilli),
          avgUnitCost: vndToNumber(
            parseMoneyToVnd(String(balanceRows[0].avgUnitCost)),
          ),
        });
      }
    }

    if (shortages.length > 0) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.INSUFFICIENT_STOCK,
        'Insufficient available unreserved stock to post stock issue',
        409,
        shortages,
      );
    }

    const occurredAt = new Date().toISOString();
    const actorId = RequestContext.get()?.actor?.id ?? 'system';
    const correlationId = RequestContext.get()?.requestId ?? null;

    // 2. Deduct on_hand_qty, update valuation, record unit_cost on issue_item, and write ledger
    for (const item of items) {
      const bal = lockedBalances.get(String(item.skuId))!;
      const qtyStr = formatMilliToQty(
        parseQtyToMilli(String(item.qty), false, false),
      );
      const qtyDelta = `-${qtyStr}`;

      const valuation = computeValuationAfterDeduction({
        currentOnHandQty: bal.onHandQty,
        currentAvgUnitCost: bal.avgUnitCost,
        deductedBaseQty: qtyStr,
      });

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
          header.warehouse_id,
          item.skuId,
          valuation.newOnHandQty,
          valuation.newValuationAmount,
          qtyStr,
        ],
      );

      await em.query(
        `
        UPDATE ${prefix}"stock_issue_item"
        SET unit_cost = $3::bigint
        WHERE tenant_id = $1 AND id = $2
        `,
        [tenantId, item.id, bal.avgUnitCost],
      );

      await em.query(
        `
        INSERT INTO ${prefix}"stock_balance_ledger" (
          id, tenant_id, warehouse_id, sku_id, movement_type,
          qty_before, qty_delta, on_hand_after, reserved_after,
          unit_cost, avg_cost_after, reference_type, reference_id,
          actor_id, correlation_id, reason, occurred_at
        ) VALUES (
          $1, $2, $3, $4, 'MANUAL_ISSUE',
          $5::numeric(18,3), $6::numeric(18,3), $7::numeric(18,3), $8::numeric(18,3),
          $9::bigint, $10::bigint, 'STOCK_ISSUE', $11,
          $12, $13, $14, $15
        )
        `,
        [
          randomUUID(),
          tenantId,
          header.warehouse_id,
          item.skuId,
          bal.onHandQty,
          qtyDelta,
          valuation.newOnHandQty,
          bal.reservedQty,
          bal.avgUnitCost,
          valuation.newAvgUnitCost,
          issueId,
          actorId,
          correlationId,
          header.reason_code,
          occurredAt,
        ],
      );

      if (this.outbox) {
        await this.outbox.add(em, INVENTORY_STOCK_CHANGED, {
          warehouseId: header.warehouse_id,
          skuId: item.skuId,
          movementType: 'MANUAL_ISSUE',
          qtyDelta,
          onHandAfter: valuation.newOnHandQty,
          reservedAfter: bal.reservedQty,
          unitCost: bal.avgUnitCost,
          avgCostAfter: valuation.newAvgUnitCost,
          referenceType: 'STOCK_ISSUE',
          referenceId: issueId,
          occurredAt,
        } satisfies StockChangedPayload);
      }
    }

    await em.query(
      `
      UPDATE ${prefix}"stock_issue"
      SET
        status = 'POSTED',
        posted_by = $3,
        posted_at = $4::timestamptz,
        idempotency_key = COALESCE(idempotency_key, $5),
        updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      `,
      [tenantId, issueId, actorId, occurredAt, idempotencyKey?.trim() ?? null],
    );

    if (this.outbox) {
      await this.outbox.add(em, INVENTORY_STOCK_ISSUED, {
        issueId,
        code: header.code,
        warehouseId: header.warehouse_id,
        reasonCode: header.reason_code,
        postedAt: occurredAt,
      });
    }

    return this.loadIssueResponse(em, prefix, tenantId, issueId);
  }

  async listIssues(warehouseId?: string, scope?: WarehouseScope) {
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
        FROM ${prefix}"stock_issue"
        WHERE tenant_id = $1 ${filters.join(' ')}
        ORDER BY created_at DESC
        LIMIT 100
        `,
        params,
      );
      const results = [];
      for (const h of headers) {
        results.push(await this.loadIssueResponse(em, prefix, tenantId, h.id));
      }
      return results;
    });
  }

  async getIssueById(issueId: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      return this.loadIssueResponse(em, prefix, tenantId, issueId);
    });
  }

  private async loadIssueResponse(
    em: EntityManager,
    prefix: string,
    tenantId: string,
    issueId: string,
  ) {
    const headers = await em.query(
      `
      SELECT
        id,
        tenant_id AS "tenantId",
        code,
        warehouse_id AS "warehouseId",
        reason_code AS "reasonCode",
        status,
        note,
        posted_by AS "postedBy",
        posted_at AS "postedAt",
        created_by AS "createdBy",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ${prefix}"stock_issue"
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1
      `,
      [tenantId, issueId],
    );
    if (headers.length === 0) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.STOCK_ISSUE_NOT_FOUND,
        `Stock issue ${issueId} not found`,
        404,
      );
    }
    const items = await em.query(
      `
      SELECT
        id,
        line_no AS "lineNo",
        sku_id AS "skuId",
        qty,
        unit_cost AS "unitCost"
      FROM ${prefix}"stock_issue_item"
      WHERE tenant_id = $1 AND issue_id = $2
      ORDER BY line_no ASC
      `,
      [tenantId, issueId],
    );

    return {
      ...headers[0],
      items: items.map((i: Record<string, unknown>) => ({
        id: i.id,
        lineNo: Number(i.lineNo),
        skuId: i.skuId,
        qty: formatMilliToQty(parseQtyToMilli(String(i.qty), false, false)),
        unitCost: vndToNumber(parseMoneyToVnd(String(i.unitCost ?? '0'))),
      })),
    };
  }
}
