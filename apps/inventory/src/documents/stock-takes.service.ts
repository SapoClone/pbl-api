import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext } from '@pbl/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { BranchGuard } from '../common/branch-guard';
import {
  Page,
  Scope,
  Where,
  actorId,
  assertBranchInScope,
  assertVisible,
  badRequest,
  iso,
  likePattern,
  nextCode,
  notFound,
  num,
  numOrNull,
  pageOf,
} from '../common/sql';
import { compareSku } from '../stock/stock-lines';
import { setStock } from '../stock/stock-movement';
import { InventoryErrorCode } from '../stock/stock.service';
import { DocumentBase } from './document-base';
import {
  CreateStockTakeReqDto,
  DocumentActionReqDto,
  ListTakesReqDto,
  UpdateTakeItemsReqDto,
} from './document.dto';

export interface TakeRowRes {
  id: string;
  code: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  branchId: string;
  note: string | null;
  lineCount: number;
  completedAt: string | null;
  createdAt: string;
  version: number;
}

export interface TakeRes extends TakeRowRes {
  items: {
    variantId: string | null;
    sku: string;
    systemQuantity: number;
    countedQuantity: number | null;
    difference: number | null;
    reason: string | null;
  }[];
}

/** Counting a branch: a snapshot, counted quantities, then one adjustment per line */
@Injectable()
export class StockTakesService extends DocumentBase {
  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly branches: BranchGuard,
  ) {
    super(dataSource);
  }

  private select(): string {
    return `SELECT x.*, (SELECT count(*) FROM ${this.t('stock_take_line')} l WHERE l."stock_take_id" = x."id") AS line_count
            FROM ${this.t('stock_take')} x`;
  }

  private map(row: Record<string, any>): TakeRowRes {
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      branchId: row.branch_id,
      note: row.note ?? null,
      lineCount: num(row.line_count),
      completedAt: iso(row.completed_at),
      createdAt: iso(row.created_at) as string,
      version: num(row.version),
    };
  }

  async create(dto: CreateStockTakeReqDto, scope: Scope): Promise<TakeRes> {
    const tenantId = TenantContext.require();
    assertBranchInScope(scope, dto.branchId);
    await this.branches.assertActive(dto.branchId);
    const id = randomUUID();
    await this.dataSource.transaction(async (em) => {
      const code = await nextCode(
        em,
        tenantId,
        this.t('code_sequence'),
        'stock_take',
        'KK',
        5,
      );
      await em.query(
        `INSERT INTO ${this.t('stock_take')} ("id","tenant_id","code","branch_id","status","note","created_by")
         VALUES ($1,$2,$3,$4,'in_progress',$5,$6)`,
        [id, tenantId, code, dto.branchId, dto.note ?? null, actorId()],
      );
      const skus = dto.skus?.length ? [...new Set(dto.skus)] : null;
      // snapshot: the system quantity per SKU (0 for a SKU the branch has never held)
      await em.query(
        skus
          ? `INSERT INTO ${this.t('stock_take_line')} ("id","tenant_id","stock_take_id","sku","system_quantity")
             SELECT gen_random_uuid(), $1, $2, w.sku, coalesce(s."quantity_on_hand", 0)
             FROM unnest($4::text[]) AS w(sku)
             LEFT JOIN ${this.t('stock_item')} s ON s."tenant_id" = $1 AND s."branch_id" = $3 AND s."sku" = w.sku`
          : `INSERT INTO ${this.t('stock_take_line')} ("id","tenant_id","stock_take_id","sku","system_quantity")
             SELECT gen_random_uuid(), $1, $2, s."sku", s."quantity_on_hand"
             FROM ${this.t('stock_item')} s WHERE s."tenant_id" = $1 AND s."branch_id" = $3`,
        skus
          ? [tenantId, id, dto.branchId, skus]
          : [tenantId, id, dto.branchId],
      );
    });
    return this.get(id, scope);
  }

  async get(id: string, scope: Scope): Promise<TakeRes> {
    const tenantId = TenantContext.require();
    const rows = await this.dataSource.query(
      `${this.select()} WHERE x."tenant_id" = $1 AND x."id" = $2`,
      [tenantId, id],
    );
    if (!rows.length) throw notFound('Stock take');
    assertVisible(scope, 'Stock take', rows[0].branch_id);
    const lines = await this.dataSource.query(
      `SELECT * FROM ${this.t('stock_take_line')} WHERE "tenant_id" = $1 AND "stock_take_id" = $2 ORDER BY "sku" COLLATE "C"`,
      [tenantId, id],
    );
    return {
      ...this.map(rows[0]),
      items: lines.map((l: Record<string, any>) => {
        const counted = numOrNull(l.counted_quantity);
        return {
          variantId: l.variant_id ?? null,
          sku: l.sku,
          systemQuantity: num(l.system_quantity),
          countedQuantity: counted,
          difference:
            counted === null ? null : counted - num(l.system_quantity),
          reason: l.reason ?? null,
        };
      }),
    };
  }

  async list(query: ListTakesReqDto, scope: Scope): Promise<Page<TakeRowRes>> {
    const where = new Where().add('x."tenant_id" = ?', TenantContext.require());
    if (query.branchId) {
      assertBranchInScope(scope, query.branchId);
      where.add('x."branch_id" = ?', query.branchId);
    } else {
      where.branchScope(scope, 'x."branch_id"');
    }
    if (query.status) where.add('x."status" = ?', query.status);
    if (query.q) where.add('x."code" ILIKE ?', likePattern(query.q));
    where.dateRange('x."created_at"', query.from, query.to);
    const [{ count }] = await this.dataSource.query(
      `SELECT count(*) AS count FROM ${this.t('stock_take')} x ${where.sql}`,
      where.params,
    );
    const rows = await this.dataSource.query(
      `${this.select()} ${where.sql} ORDER BY x."created_at" ${query.order ?? 'DESC'}, x."id"
       LIMIT ${where.param(query.limit)} OFFSET ${where.param((query.page - 1) * query.limit)}`,
      where.params,
    );
    return pageOf(
      rows.map((r: Record<string, any>) => this.map(r)),
      Number(count),
      query.page,
      query.limit,
    );
  }

  private notOpen(status: string) {
    return badRequest(
      InventoryErrorCode.NOT_EDITABLE,
      `A stock take that is ${status} cannot be changed`,
    );
  }

  /**
   * Counted quantities as upserts per SKU (`replace` is idempotent, `increment` adds);
   * a SKU not in the take is added with its current system quantity.
   */
  async updateItems(
    id: string,
    dto: UpdateTakeItemsReqDto,
    scope: Scope,
  ): Promise<TakeRes> {
    const tenantId = TenantContext.require();
    await this.dataSource.transaction(async (em) => {
      const row = await this.lockHeader(
        em,
        'stock_take',
        tenantId,
        id,
        'Stock take',
        dto.version,
        (row) => assertVisible(scope, 'Stock take', row.branch_id),
      );
      if (row.status !== 'in_progress') throw this.notOpen(row.status);
      for (const item of dto.items) {
        const increment = item.mode === 'increment';
        await em.query(
          `INSERT INTO ${this.t('stock_take_line')} ("id","tenant_id","stock_take_id","variant_id","sku","system_quantity","counted_quantity","reason")
           VALUES ($1,$2,$3,$4,$5::varchar,
             coalesce((SELECT "quantity_on_hand" FROM ${this.t('stock_item')} WHERE "tenant_id" = $2 AND "branch_id" = $9 AND "sku" = $5), 0),
             $6,$7)
           ON CONFLICT ("stock_take_id", "sku") DO UPDATE SET
             "counted_quantity" = CASE WHEN $8::boolean THEN coalesce(${this.t('stock_take_line')}."counted_quantity", 0) + EXCLUDED."counted_quantity" ELSE EXCLUDED."counted_quantity" END,
             "reason" = COALESCE(EXCLUDED."reason", ${this.t('stock_take_line')}."reason"),
             "variant_id" = COALESCE(EXCLUDED."variant_id", ${this.t('stock_take_line')}."variant_id")`,
          [
            randomUUID(),
            tenantId,
            id,
            item.variantId ?? null,
            item.sku,
            item.countedQuantity,
            item.reason ?? null,
            increment,
            row.branch_id,
          ],
        );
      }
      await this.bump(em, 'stock_take', tenantId, id, '');
    });
    return this.get(id, scope);
  }

  /** on hand := counted for every counted line; each real change writes a `stock_take` ledger row */
  async complete(
    id: string,
    dto: DocumentActionReqDto,
    scope: Scope,
  ): Promise<TakeRes> {
    const tenantId = TenantContext.require();
    await this.dataSource.transaction(async (em) => {
      const row = await this.lockHeader(
        em,
        'stock_take',
        tenantId,
        id,
        'Stock take',
        dto.version,
        (row) => assertVisible(scope, 'Stock take', row.branch_id),
      );
      if (row.status !== 'in_progress') throw this.notOpen(row.status);
      const lines = (await em.query(
        `SELECT "sku", "counted_quantity" FROM ${this.t('stock_take_line')}
         WHERE "tenant_id" = $1 AND "stock_take_id" = $2 AND "counted_quantity" IS NOT NULL`,
        [tenantId, id],
      )) as Record<string, any>[];
      for (const line of lines.sort((a, b) => compareSku(a.sku, b.sku))) {
        await setStock(
          em,
          this.movement,
          tenantId,
          row.branch_id,
          line.sku,
          num(line.counted_quantity),
          'stock_take',
          id,
        );
      }
      await this.bump(
        em,
        'stock_take',
        tenantId,
        id,
        `"status" = 'completed', "completed_at" = now()`,
      );
    });
    return this.get(id, scope);
  }

  async cancel(
    id: string,
    dto: DocumentActionReqDto,
    scope: Scope,
  ): Promise<TakeRes> {
    const tenantId = TenantContext.require();
    await this.dataSource.transaction(async (em) => {
      const row = await this.lockHeader(
        em,
        'stock_take',
        tenantId,
        id,
        'Stock take',
        dto.version,
        (row) => assertVisible(scope, 'Stock take', row.branch_id),
      );
      if (row.status !== 'in_progress') throw this.notOpen(row.status);
      await this.bump(em, 'stock_take', tenantId, id, `"status" = 'cancelled'`);
    });
    return this.get(id, scope);
  }
}
