import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { runInTenantTransaction } from '@pbl/common';
import {
  INVENTORY_STOCK_BELOW_MIN,
  StockBelowMinPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  formatMilliToQty,
  InventoryDomainError,
  InventoryDomainErrorCode,
  parseMoneyToVnd,
  parseQtyToMilli,
  vndToNumber,
} from '../../domain/inventory-domain';
import { schemaPrefix } from '../warehouses/warehouses.service';
import {
  LedgerRefType,
  ListLedgerEntriesQueryDto,
  ListStockLevelsQueryDto,
  StockFilterQueryDto,
  StockLookupQueryDto,
  UpsertBranchThresholdDto,
} from './stock-views.dto';

/** Rows an export may hold; more answers 400 EXPORT_TOO_LARGE */
export const EXPORT_MAX_ROWS = 50000;

/**
 * Ledger `movement_type` values behind each contract `refType`.
 * `sale_shortfall` and `reservation_release` have no ledger rows today.
 */
const MOVEMENT_TYPES: Record<LedgerRefType, string[]> = {
  receipt: ['RECEIPT', 'PURCHASE_RECEIPT', 'MANUAL_RECEIPT', 'RETURN_RECEIPT'],
  issue: ['MANUAL_ISSUE'],
  transfer_out: ['TRANSFER_DISPATCH'],
  transfer_in: ['TRANSFER_RECEIPT'],
  stock_take: ['STOCKTAKE_ADJUSTMENT'],
  sale: ['SALE_COMMIT', 'SALE_ISSUE'],
  sale_shortfall: [],
  reservation_release: [],
};

export function refTypeOf(movementType: string): string {
  for (const [refType, types] of Object.entries(MOVEMENT_TYPES)) {
    if (types.includes(movementType)) return refType;
  }
  return movementType.toLowerCase();
}

export type StockLevelValue = 'ok' | 'below_min' | 'out_of_stock';

/** `out_of_stock` at zero available, `below_min` under the minimum, else `ok` */
export function levelOf(
  available: number,
  minQuantity: number | null,
): StockLevelValue {
  if (available <= 0) return 'out_of_stock';
  if (minQuantity !== null && available < minQuantity) return 'below_min';
  return 'ok';
}

/** One CSV cell: quoted, and a leading formula character is defused */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

interface Built {
  /** `WITH ... lvl AS (...)`: one row per (branch, SKU) */
  cte: string;
  params: unknown[];
  where: string;
}

/**
 * The contract's stock views (02-catalog-inventory) on top of their
 * warehouse + SKU model. A branch is the sum of its warehouses
 * (`warehouse.branch_id`); a central or quarantine warehouse has no branch and
 * is not part of these views. The catalog variant id is the `sku_id` of
 * `stock_balance`; nothing about their keys changes.
 */
@Injectable()
export class StockViewsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly outbox?: EventOutbox,
  ) {}

  private levels(
    prefix: string,
    tenantId: string,
    branches: string[] | null,
    filter: StockFilterQueryDto,
  ): Built {
    const params: unknown[] = [tenantId];
    let bf = '';
    if (filter.branchId) {
      params.push(filter.branchId);
      bf += ` AND w.branch_id = $${params.length}`;
    }
    if (branches) {
      params.push(branches);
      bf += ` AND w.branch_id = ANY($${params.length}::uuid[])`;
    }
    const cte = `
      WITH bal AS (
        SELECT w.branch_id, b.sku_id,
               SUM(b.on_hand_qty) AS on_hand,
               SUM(b.reserved_qty) AS reserved,
               SUM(b.valuation_amount) AS stock_value
        FROM ${prefix}"stock_balance" b
        JOIN ${prefix}"warehouse" w
          ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
        WHERE b.tenant_id = $1 AND w.branch_id IS NOT NULL${bf}
        GROUP BY w.branch_id, b.sku_id
      ), thr AS (
        SELECT w.branch_id, t.sku_id,
               SUM(t.min_qty) AS min_qty, SUM(t.max_qty) AS max_qty
        FROM ${prefix}"stock_threshold" t
        JOIN ${prefix}"warehouse" w
          ON w.tenant_id = t.tenant_id AND w.id = t.warehouse_id
        WHERE t.tenant_id = $1 AND w.branch_id IS NOT NULL${bf}
        GROUP BY w.branch_id, t.sku_id
      ), keys AS (
        SELECT branch_id, sku_id FROM bal
        UNION
        SELECT branch_id, sku_id FROM thr
      ), base AS (
        SELECT k.branch_id, k.sku_id,
               COALESCE(bal.on_hand, 0) AS on_hand,
               COALESCE(bal.reserved, 0) AS reserved,
               COALESCE(bal.on_hand, 0) - COALESCE(bal.reserved, 0) AS available,
               COALESCE(bal.stock_value, 0) AS stock_value,
               thr.min_qty, thr.max_qty,
               p.sku_code, p.name, p.barcode
        FROM keys k
        LEFT JOIN bal ON bal.branch_id = k.branch_id AND bal.sku_id = k.sku_id
        LEFT JOIN thr ON thr.branch_id = k.branch_id AND thr.sku_id = k.sku_id
        LEFT JOIN ${prefix}"catalog_sku_projection" p
          ON p.tenant_id = $1 AND p.sku_id = k.sku_id
      ), lvl AS (
        SELECT base.*,
               CASE
                 WHEN available <= 0 THEN 'out_of_stock'
                 WHEN min_qty IS NOT NULL AND available < min_qty THEN 'below_min'
                 ELSE 'ok'
               END AS level
        FROM base
      )`;
    const conds: string[] = [];
    if (filter.q?.trim()) {
      params.push(`%${filter.q.trim().replace(/[\\%_]/g, '\\$&')}%`);
      const n = params.length;
      conds.push(
        `(sku_code ILIKE $${n} ESCAPE '\\' OR name ILIKE $${n} ESCAPE '\\' OR barcode ILIKE $${n} ESCAPE '\\')`,
      );
    }
    if (filter.variantIds?.length) {
      params.push(filter.variantIds);
      conds.push(`sku_id = ANY($${params.length}::uuid[])`);
    }
    if (filter.level) {
      params.push(filter.level);
      conds.push(`level = $${params.length}`);
    }
    return {
      cte,
      params,
      where: conds.length ? `WHERE ${conds.join(' AND ')}` : '',
    };
  }

  private orderBy(filter: StockFilterQueryDto): string {
    const dir = filter.order === 'desc' ? 'DESC' : 'ASC';
    const col =
      filter.sort === 'available'
        ? 'available'
        : filter.sort === 'onHand'
          ? 'on_hand'
          : 'COALESCE(name, sku_code, sku_id::text)';
    return `ORDER BY ${col} ${dir}, branch_id ASC, sku_id ASC`;
  }

  private row(r: Record<string, unknown>) {
    const available = num(r.available);
    const minQuantity = numOrNull(r.min_qty);
    return {
      branchId: r.branch_id,
      variantId: r.sku_id,
      sku: r.sku_code ?? null,
      name: r.name ?? null,
      variantLabel: null,
      barcode: r.barcode ?? null,
      onHand: num(r.on_hand),
      reserved: num(r.reserved),
      available,
      minQuantity,
      maxQuantity: numOrNull(r.max_qty),
      level: levelOf(available, minQuantity),
    };
  }

  async list(
    query: ListStockLevelsQueryDto,
    branches: string[] | null,
  ): Promise<{ data: unknown[]; pagination: Record<string, number> }> {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const b = this.levels(schemaPrefix(em), tenantId, branches, query);
      const count = await em.query(
        `${b.cte} SELECT COUNT(*)::int AS total FROM lvl ${b.where}`,
        b.params,
      );
      const totalRecords = Number(count[0]?.total ?? 0);
      const limit = query.limit ?? 20;
      const page = query.page ?? 1;
      const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
      const rows = await em.query(
        `${b.cte} SELECT * FROM lvl ${b.where} ${this.orderBy(query)}
         LIMIT $${b.params.length + 1} OFFSET $${b.params.length + 2}`,
        [...b.params, limit, (page - 1) * limit],
      );
      return {
        data: rows.map((r: Record<string, unknown>) => this.row(r)),
        pagination: {
          limit,
          currentPage: page,
          ...(page < totalPages ? { nextPage: page + 1 } : {}),
          totalRecords,
          totalPages,
        },
      };
    });
  }

  async summary(branchId: string | undefined, branches: string[] | null) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const b = this.levels(schemaPrefix(em), tenantId, branches, { branchId });
      const [t] = await em.query(
        `${b.cte}
         SELECT COUNT(DISTINCT sku_id)::int AS sku_count,
                COALESCE(SUM(on_hand), 0) AS on_hand,
                COALESCE(SUM(reserved), 0) AS reserved,
                COALESCE(SUM(available), 0) AS available,
                COUNT(*) FILTER (WHERE level = 'below_min')::int AS below_min,
                COUNT(*) FILTER (WHERE level = 'out_of_stock')::int AS out_of_stock,
                COALESCE(SUM(stock_value), 0) AS stock_value
         FROM lvl`,
        b.params,
      );
      let byBranch: unknown[] = [];
      if (!branchId) {
        const rows = await em.query(
          `${b.cte}
           SELECT l.branch_id, bp.name AS branch_name,
                  SUM(l.available) AS available, SUM(l.max_qty) AS max_sum
           FROM lvl l
           LEFT JOIN ${schemaPrefix(em)}"branch_projection" bp
             ON bp.tenant_id = $1 AND bp.branch_id = l.branch_id
           GROUP BY l.branch_id, bp.name
           ORDER BY bp.name ASC NULLS LAST, l.branch_id ASC`,
          b.params,
        );
        byBranch = rows.map((r: Record<string, unknown>) => {
          const maxSum = numOrNull(r.max_sum);
          return {
            branchId: r.branch_id,
            branchName: r.branch_name ?? null,
            available: num(r.available),
            fillRate:
              maxSum && maxSum > 0
                ? Math.round((num(r.available) / maxSum) * 10000) / 10000
                : null,
          };
        });
      }
      return {
        branchId: branchId ?? null,
        skuCount: Number(t.sku_count),
        onHand: num(t.on_hand),
        reserved: num(t.reserved),
        available: num(t.available),
        belowMinCount: Number(t.below_min),
        outOfStockCount: Number(t.out_of_stock),
        stockValue: vndToNumber(parseMoneyToVnd(String(t.stock_value))),
        byBranch,
      };
    });
  }

  async lookup(query: StockLookupQueryDto) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const variants = await em.query(
        `SELECT sku_id, sku_code, name, barcode, base_price
         FROM ${prefix}"catalog_sku_projection"
         WHERE tenant_id = $1 AND status = 'ACTIVE'
           AND (sku_code = $2 OR barcode = $2)
         ORDER BY (sku_code = $2) DESC, sku_code ASC
         LIMIT 1`,
        [tenantId, query.code],
      );
      if (variants.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.SKU_NOT_FOUND,
          `No variant matches "${query.code}"`,
          404,
        );
      }
      const v = variants[0];
      const [s] = await em.query(
        `SELECT COALESCE(SUM(b.on_hand_qty), 0) AS on_hand,
                COALESCE(SUM(b.reserved_qty), 0) AS reserved
         FROM ${prefix}"stock_balance" b
         JOIN ${prefix}"warehouse" w
           ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
         WHERE b.tenant_id = $1 AND b.sku_id = $2 AND w.branch_id = $3`,
        [tenantId, v.sku_id, query.branchId],
      );
      return {
        variantId: v.sku_id,
        sku: v.sku_code,
        barcode: v.barcode ?? null,
        name: v.name,
        variantLabel: null,
        price: numOrNull(v.base_price),
        onHand: num(s.on_hand),
        reserved: num(s.reserved),
        available: num(s.on_hand) - num(s.reserved),
      };
    });
  }

  async exportCsv(
    query: StockFilterQueryDto,
    branches: string[] | null,
  ): Promise<string> {
    const rows = await runInTenantTransaction(
      this.dataSource,
      async (em, tenantId) => {
        const b = this.levels(schemaPrefix(em), tenantId, branches, query);
        return em.query(
          `${b.cte} SELECT lvl.*, bp.branch_name FROM lvl
           LEFT JOIN (
             SELECT tenant_id, branch_id, name AS branch_name
             FROM ${schemaPrefix(em)}"branch_projection"
           ) bp ON bp.tenant_id = $1 AND bp.branch_id = lvl.branch_id
           ${b.where} ${this.orderBy(query)} LIMIT ${EXPORT_MAX_ROWS + 1}`,
          b.params,
        );
      },
    );
    if (rows.length > EXPORT_MAX_ROWS) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.EXPORT_TOO_LARGE,
        `The export holds more than ${EXPORT_MAX_ROWS} rows: narrow the filters`,
        400,
      );
    }
    const header = [
      'branchId',
      'branchName',
      'variantId',
      'sku',
      'name',
      'barcode',
      'onHand',
      'reserved',
      'available',
      'minQuantity',
      'maxQuantity',
      'level',
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows as Record<string, unknown>[]) {
      const x = this.row(r);
      lines.push(
        [
          x.branchId,
          r.branch_name,
          x.variantId,
          x.sku,
          x.name,
          x.barcode,
          x.onHand,
          x.reserved,
          x.available,
          x.minQuantity,
          x.maxQuantity,
          x.level,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  async ledgerEntries(
    query: ListLedgerEntriesQueryDto,
    branches: string[] | null,
  ) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const params: unknown[] = [tenantId];
      const conds: string[] = [];
      const add = (sql: (n: number) => string, value: unknown) => {
        params.push(value);
        conds.push(sql(params.length));
      };
      if (query.branchId) add((n) => `w.branch_id = $${n}`, query.branchId);
      if (branches) add((n) => `w.branch_id = ANY($${n}::uuid[])`, branches);
      if (query.variantId) add((n) => `l.sku_id = $${n}`, query.variantId);
      if (query.refType) {
        add(
          (n) => `l.movement_type = ANY($${n}::text[])`,
          MOVEMENT_TYPES[query.refType],
        );
      }
      if (query.from)
        add((n) => `l.occurred_at >= $${n}::timestamptz`, query.from);
      if (query.to) {
        // a bare date means the whole day
        if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
          add(
            (n) => `l.occurred_at < ($${n}::date + 1)::timestamptz`,
            query.to,
          );
        } else {
          add((n) => `l.occurred_at <= $${n}::timestamptz`, query.to);
        }
      }
      const where = conds.length ? `AND ${conds.join(' AND ')}` : '';
      const from = `
        FROM ${prefix}"stock_balance_ledger" l
        LEFT JOIN ${prefix}"warehouse" w
          ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
        LEFT JOIN ${prefix}"catalog_sku_projection" p
          ON p.tenant_id = l.tenant_id AND p.sku_id = l.sku_id
        WHERE l.tenant_id = $1 ${where}`;
      const count = await em.query(
        `SELECT COUNT(*)::int AS total ${from}`,
        params,
      );
      const totalRecords = Number(count[0]?.total ?? 0);
      const limit = query.limit ?? 20;
      const page = query.page ?? 1;
      const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
      const rows = await em.query(
        `SELECT l.id, w.branch_id, l.sku_id, l.qty_delta, l.on_hand_after,
                l.movement_type, l.reference_type, l.reference_id,
                l.actor_id, l.occurred_at,
                p.sku_code,
                CASE l.reference_type
                  WHEN 'STOCK_RECEIPT' THEN (SELECT r.code FROM ${prefix}"stock_receipt" r
                    WHERE r.tenant_id = l.tenant_id AND r.id = l.reference_id)
                  WHEN 'STOCK_ISSUE' THEN (SELECT i.code FROM ${prefix}"stock_issue" i
                    WHERE i.tenant_id = l.tenant_id AND i.id = l.reference_id)
                  WHEN 'STOCK_TRANSFER' THEN (SELECT t.code FROM ${prefix}"stock_transfer" t
                    WHERE t.tenant_id = l.tenant_id AND t.id = l.reference_id)
                  WHEN 'STOCK_TAKE' THEN (SELECT k.code FROM ${prefix}"stock_take" k
                    WHERE k.tenant_id = l.tenant_id AND k.id = l.reference_id)
                END AS ref_code
         ${from}
         ORDER BY l.occurred_at DESC, l.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit],
      );
      return {
        data: rows.map((r: Record<string, unknown>) => ({
          id: r.id,
          branchId: r.branch_id ?? null,
          variantId: r.sku_id,
          sku: r.sku_code ?? null,
          changeQty: num(r.qty_delta),
          balanceAfter: num(r.on_hand_after),
          refType: refTypeOf(String(r.movement_type)),
          refId: r.reference_id,
          refCode: r.ref_code ?? null,
          // only the id is kept in the ledger: platform owns the names
          actor: r.actor_id ? { id: r.actor_id, name: null } : null,
          createdAt: r.occurred_at,
        })),
        pagination: {
          limit,
          currentPage: page,
          ...(page < totalPages ? { nextPage: page + 1 } : {}),
          totalRecords,
          totalPages,
        },
      };
    });
  }

  /**
   * Upsert keyed by (branch, variant): the threshold lives on the branch's
   * default warehouse (else its first active one). Emits
   * `inventory.stock.below_min` when the new minimum puts available under it.
   */
  async upsertBranchThreshold(dto: UpsertBranchThresholdDto) {
    const minMilli = parseQtyToMilli(String(dto.minQuantity), true, false);
    const maxMilli =
      dto.maxQuantity === undefined || dto.maxQuantity === null
        ? null
        : parseQtyToMilli(String(dto.maxQuantity), true, false);
    if (maxMilli !== null && maxMilli < minMilli) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.INVALID_QUANTITY,
        'maxQuantity must be greater than or equal to minQuantity',
        400,
      );
    }
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const warehouseId = await this.warehouseOfBranch(
        em,
        prefix,
        tenantId,
        dto.branchId,
      );
      await em.query(
        `INSERT INTO ${prefix}"stock_threshold"
           (id, tenant_id, warehouse_id, sku_id, min_qty, max_qty, updated_at)
         VALUES ($1, $2, $3, $4, $5::numeric(18,3), $6::numeric(18,3), now())
         ON CONFLICT (tenant_id, warehouse_id, sku_id) DO UPDATE
         SET min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty,
             updated_at = now()`,
        [
          randomUUID(),
          tenantId,
          warehouseId,
          dto.variantId,
          formatMilliToQty(minMilli),
          maxMilli === null ? null : formatMilliToQty(maxMilli),
        ],
      );
      const [bal] = await em.query(
        `SELECT on_hand_qty - reserved_qty AS available
         FROM ${prefix}"stock_balance"
         WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3`,
        [tenantId, warehouseId, dto.variantId],
      );
      const available = num(bal?.available);
      if (this.outbox && available < dto.minQuantity) {
        const [p] = await em.query(
          `SELECT sku_code, name FROM ${prefix}"catalog_sku_projection"
           WHERE tenant_id = $1 AND sku_id = $2`,
          [tenantId, dto.variantId],
        );
        await this.outbox.add(em, INVENTORY_STOCK_BELOW_MIN, {
          branchId: dto.branchId,
          warehouseId,
          variantId: dto.variantId,
          sku: p?.sku_code ?? null,
          name: p?.name ?? null,
          available,
          minQuantity: dto.minQuantity,
          occurredAt: new Date().toISOString(),
        } satisfies StockBelowMinPayload);
      }
      return {
        branchId: dto.branchId,
        variantId: dto.variantId,
        minQuantity: dto.minQuantity,
        maxQuantity: dto.maxQuantity ?? null,
      };
    });
  }

  private async warehouseOfBranch(
    em: EntityManager,
    prefix: string,
    tenantId: string,
    branchId: string,
  ): Promise<string> {
    const rows = await em.query(
      `SELECT id FROM ${prefix}"warehouse"
       WHERE tenant_id = $1 AND branch_id = $2 AND status = 'ACTIVE'
       ORDER BY is_default DESC, code ASC LIMIT 1`,
      [tenantId, branchId],
    );
    if (rows.length === 0) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.WAREHOUSE_NOT_FOUND,
        `Branch ${branchId} has no active warehouse`,
        400,
      );
    }
    return rows[0].id;
  }
}
