import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  InjectTenantScopedRepository,
  TenantContext,
  TenantScopedRepository,
} from '@pbl/common';
import { qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import {
  EXPORT_ROW_CAP,
  Page,
  Where,
  likePattern,
  num,
  numOrNull,
  pageOf,
  toCsv,
} from '../common/sql';
import {
  ExportStockReqDto,
  ListStockReqDto,
  StockFilterDto,
  StockReceiptReqDto,
} from './dto/stock.dto';
import { StockItemEntity } from './entities/stock.entities';
import { mergeLines } from './stock-lines';

export type { Page };

/** Error codes of this service (a domain letter plus 3 digits, api-conventions §6) */
export const InventoryErrorCode = {
  UNKNOWN_BRANCH: 'I001',
  OUT_OF_STOCK: 'I002',
  RESERVATION_MISMATCH: 'I003',
  UNKNOWN_SUPPLIER: 'I005',
  NOT_EDITABLE: 'I006',
  INVALID_TRANSITION: 'I007',
  SAME_BRANCH: 'I008',
  DUPLICATE_SUPPLIER_PHONE: 'I009',
  SUPPLIER_IN_USE: 'I011',
  PURCHASE_ORDER_NOT_EDITABLE: 'I012',
  PAYMENT_EXCEEDS_REMAINING: 'I013',
  VERSION_CONFLICT: 'I014',
  COUNT_BELOW_HELD: 'I015',
} as const;

export type StockLevel = 'ok' | 'below_min' | 'out_of_stock';

/** What a receipt answers: quantities only (unchanged since the first release) */
export interface StockQuantityRes {
  branchId: string;
  sku: string;
  onHand: number;
  reserved: number;
  /** What can still be sold: on hand minus the holds */
  available: number;
}

export interface StockRes extends StockQuantityRes {
  minQuantity: number | null;
  maxQuantity: number | null;
  level: StockLevel;
}

export interface StockSummaryRes {
  branchId: string | null;
  skuCount: number;
  onHand: number;
  reserved: number;
  available: number;
  belowMinCount: number;
  outOfStockCount: number;
  /** null until receipts carry an average cost */
  stockValue: number | null;
  byBranch: {
    branchId: string;
    branchName: string | null;
    available: number;
    fillRate: number | null;
  }[];
}

export interface StockLookupRes {
  variantId: string | null;
  sku: string;
  barcode: string | null;
  name: string | null;
  variantLabel: string | null;
  price: number | null;
  branchId: string;
  onHand: number;
  reserved: number;
  available: number;
}

/** out_of_stock when nothing is available, below_min under the threshold, else ok */
export function stockLevel(
  available: number,
  minQuantity: number | null,
): StockLevel {
  if (available <= 0) return 'out_of_stock';
  if (minQuantity !== null && available < minQuantity) return 'below_min';
  return 'ok';
}

const AVAILABLE = '(s."quantity_on_hand" - s."quantity_reserved")';
const LEVEL_CONDITION: Record<StockLevel, string> = {
  out_of_stock: `${AVAILABLE} <= 0`,
  below_min: `(${AVAILABLE} > 0 AND t."min_quantity" IS NOT NULL AND ${AVAILABLE} < t."min_quantity")`,
  ok: `(${AVAILABLE} > 0 AND (t."min_quantity" IS NULL OR ${AVAILABLE} >= t."min_quantity"))`,
};
const SORT_COLUMNS: Record<string, string> = {
  sku: 's."sku"',
  available: AVAILABLE,
  onHand: 's."quantity_on_hand"',
  reserved: 's."quantity_reserved"',
};
const THRESHOLD_JOIN = `LEFT JOIN %T t ON t."tenant_id" = s."tenant_id" AND t."branch_id" = s."branch_id" AND t."sku" = s."sku"`;

/** Stock of the selected store: receiving goods and looking at what there is */
@Injectable()
export class StockService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectTenantScopedRepository(StockItemEntity)
    private readonly stock: TenantScopedRepository<StockItemEntity>,
    @InjectTenantScopedRepository(BranchProjectionEntity)
    private readonly branches: TenantScopedRepository<BranchProjectionEntity>,
  ) {}

  /**
   * Adds goods to a branch, one ledger row per SKU, in one transaction. A branch id
   * from the request is checked against the projection with the tenant.
   */
  async receive(dto: StockReceiptReqDto): Promise<StockQuantityRes[]> {
    const tenantId = TenantContext.require();
    const branch = await this.branches.findOne({
      where: { branchId: dto.branchId },
    });
    if (!branch || branch.status !== 'active') {
      throw new BadRequestException({
        errorCode: InventoryErrorCode.UNKNOWN_BRANCH,
        message: 'The branch does not exist in this store or is not active',
      });
    }
    const receiptId = randomUUID();
    return this.dataSource.transaction(async (em) => {
      const item = qualifiedTable(em.connection, 'stock_item');
      const ledger = qualifiedTable(em.connection, 'inventory_ledger');
      const result: StockQuantityRes[] = [];
      for (const line of mergeLines(dto.items)) {
        // an INSERT ... RETURNING answers with the rows
        const rows = await em.query(
          `INSERT INTO ${item} ("id", "tenant_id", "branch_id", "sku", "quantity_on_hand")
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ("tenant_id", "branch_id", "sku") DO UPDATE SET
             "quantity_on_hand" = ${item}."quantity_on_hand" + EXCLUDED."quantity_on_hand",
             "updated_at" = now()
           RETURNING "quantity_on_hand", "quantity_reserved"`,
          [randomUUID(), tenantId, dto.branchId, line.sku, line.quantity],
        );
        const onHand: number = rows[0].quantity_on_hand;
        const reserved: number = rows[0].quantity_reserved;
        await em.query(
          `INSERT INTO ${ledger} ("id", "tenant_id", "branch_id", "sku", "change_qty", "balance_after", "ref_type", "ref_id")
           VALUES ($1, $2, $3, $4, $5, $6, 'receipt', $7)`,
          [
            randomUUID(),
            tenantId,
            dto.branchId,
            line.sku,
            line.quantity,
            onHand,
            receiptId,
          ],
        );
        result.push({
          branchId: dto.branchId,
          sku: line.sku,
          onHand,
          reserved,
          available: onHand - reserved,
        });
      }
      return result;
    });
  }

  /** Same filters as the list; `level` is derived from available and the threshold */
  private filters(
    tenantId: string,
    query: StockFilterDto & { sku?: string },
  ): { where: Where; join: string } {
    const where = new Where().add('s."tenant_id" = ?', tenantId);
    if (query.branchId) where.add('s."branch_id" = ?', query.branchId);
    if (query.sku) where.add('s."sku" = ?', query.sku);
    if (query.q) where.add('s."sku" ILIKE ?', likePattern(query.q));
    if (query.level) where.add(LEVEL_CONDITION[query.level]);
    return { where, join: THRESHOLD_JOIN };
  }

  private table(name: string) {
    return qualifiedTable(this.dataSource, name);
  }

  private toRow(row: Record<string, unknown>): StockRes {
    const onHand = num(row.on_hand);
    const reserved = num(row.reserved);
    const minQuantity = numOrNull(row.min_quantity);
    return {
      branchId: row.branch_id as string,
      sku: row.sku as string,
      onHand,
      reserved,
      available: onHand - reserved,
      minQuantity,
      maxQuantity: numOrNull(row.max_quantity),
      level: stockLevel(onHand - reserved, minQuantity),
    };
  }

  private async selectRows(
    tenantId: string,
    query: StockFilterDto & { sku?: string },
    paging?: { limit: number; offset: number },
  ) {
    const { where, join } = this.filters(tenantId, query);
    const sort = SORT_COLUMNS[query.sort ?? 'sku'];
    const order = query.order ?? 'ASC';
    const limit = paging
      ? `LIMIT ${where.param(paging.limit)} OFFSET ${where.param(paging.offset)}`
      : `LIMIT ${EXPORT_ROW_CAP}`;
    const rows = await this.dataSource.query(
      `SELECT s."branch_id", s."sku", s."quantity_on_hand" AS on_hand, s."quantity_reserved" AS reserved,
              t."min_quantity", t."max_quantity"
       FROM ${this.table('stock_item')} s ${join.replace(/%T/g, this.table('stock_threshold'))}
       ${where.sql}
       ORDER BY ${sort} ${order}, s."sku" ASC, s."branch_id" ASC ${limit}`,
      where.params,
    );
    return rows as Record<string, unknown>[];
  }

  async list(query: ListStockReqDto): Promise<Page<StockRes>> {
    const tenantId = TenantContext.require();
    const rows = await this.selectRows(tenantId, query, {
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });
    const { where, join } = this.filters(tenantId, query);
    const [{ count }] = await this.dataSource.query(
      `SELECT count(*) AS count FROM ${this.table('stock_item')} s ${join.replace(/%T/g, this.table('stock_threshold'))} ${where.sql}`,
      where.params,
    );
    return pageOf(
      rows.map((row) => this.toRow(row)),
      num(count),
      query.page,
      query.limit,
    );
  }

  /** CSV of the list's filters, at most 10,000 rows */
  async exportCsv(query: ExportStockReqDto): Promise<string> {
    const rows = (await this.selectRows(TenantContext.require(), query)).map(
      (row) => this.toRow(row),
    );
    return toCsv(
      [
        'branchId',
        'sku',
        'onHand',
        'reserved',
        'available',
        'minQuantity',
        'maxQuantity',
        'level',
      ],
      rows.map((r) => [
        r.branchId,
        r.sku,
        r.onHand,
        r.reserved,
        r.available,
        r.minQuantity,
        r.maxQuantity,
        r.level,
      ]),
    );
  }

  /**
   * KPI cards. `stockValue` stays null: there is no average cost until receipts carry
   * unit costs (decision logged in the first-wave report).
   */
  async summary(branchId?: string): Promise<StockSummaryRes> {
    const tenantId = TenantContext.require();
    const { where, join } = this.filters(tenantId, { branchId });
    const from = `${this.table('stock_item')} s ${join.replace(/%T/g, this.table('stock_threshold'))}`;
    const [row] = await this.dataSource.query(
      `SELECT count(DISTINCT s."sku") AS sku_count,
              coalesce(sum(s."quantity_on_hand"), 0) AS on_hand,
              coalesce(sum(s."quantity_reserved"), 0) AS reserved,
              count(*) FILTER (WHERE ${LEVEL_CONDITION.below_min}) AS below_min,
              count(*) FILTER (WHERE ${LEVEL_CONDITION.out_of_stock}) AS out_of_stock
       FROM ${from} ${where.sql}`,
      where.params,
    );
    const onHand = num(row.on_hand);
    const reserved = num(row.reserved);
    let byBranch: StockSummaryRes['byBranch'] = [];
    if (!branchId) {
      const perBranch = await this.dataSource.query(
        `SELECT s."branch_id", b."name",
                sum(s."quantity_on_hand" - s."quantity_reserved") AS available,
                sum(t."max_quantity") AS max_total
         FROM ${from}
         LEFT JOIN ${this.table('branch_projection')} b ON b."branch_id" = s."branch_id" AND b."tenant_id" = s."tenant_id"
         ${where.sql}
         GROUP BY s."branch_id", b."name" ORDER BY b."name" NULLS LAST, s."branch_id"`,
        where.params,
      );
      byBranch = perBranch.map((b: Record<string, unknown>) => ({
        branchId: b.branch_id as string,
        branchName: (b.name as string) ?? null,
        available: num(b.available),
        fillRate:
          b.max_total && num(b.max_total) > 0
            ? Math.round((num(b.available) / num(b.max_total)) * 100) / 100
            : null,
      }));
    }
    return {
      branchId: branchId ?? null,
      skuCount: num(row.sku_count),
      onHand,
      reserved,
      available: onHand - reserved,
      belowMinCount: num(row.below_min),
      outOfStockCount: num(row.out_of_stock),
      stockValue: null,
      byBranch,
    };
  }

  /** Exact SKU match in one branch (barcode lookup belongs to catalog, deferred) */
  async lookup(branchId: string, code: string): Promise<StockLookupRes> {
    const tenantId = TenantContext.require();
    const rows = await this.selectRows(tenantId, { branchId, sku: code });
    if (!rows.length) {
      throw new NotFoundException('No stock row matches this code');
    }
    const row = this.toRow(rows[0]);
    return {
      variantId: null,
      sku: row.sku,
      barcode: null,
      name: null,
      variantLabel: null,
      price: null,
      branchId: row.branchId,
      onHand: row.onHand,
      reserved: row.reserved,
      available: row.available,
    };
  }
}
