import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext } from '@pbl/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
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
  pageOf,
} from '../common/sql';
import { deductStock } from '../stock/stock-movement';
import { InventoryErrorCode } from '../stock/stock.service';
import { DocumentBase, mergeDocumentLines } from './document-base';
import {
  CreateIssueReqDto,
  DocumentActionReqDto,
  ListIssuesReqDto,
} from './document.dto';

export interface IssueRowRes {
  id: string;
  code: string;
  status: 'draft' | 'approved' | 'cancelled';
  branchId: string;
  reason: string;
  supplierId: string | null;
  note: string | null;
  totalQuantity: number;
  createdAt: string;
  version: number;
}

export interface IssueRes extends IssueRowRes {
  items: { variantId: string | null; sku: string; quantity: number }[];
}

/** Stock leaving without a sale: damaged, internal use, returned to a supplier */
@Injectable()
export class StockIssuesService extends DocumentBase {
  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly branches: BranchGuard,
  ) {
    super(dataSource);
  }

  private select(): string {
    return `SELECT x.*, (SELECT coalesce(sum(l."quantity"), 0) FROM ${this.t('stock_issue_line')} l WHERE l."stock_issue_id" = x."id") AS total_quantity
            FROM ${this.t('stock_issue')} x`;
  }

  private map(row: Record<string, any>): IssueRowRes {
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      branchId: row.branch_id,
      reason: row.reason,
      supplierId: row.supplier_id ?? null,
      note: row.note ?? null,
      totalQuantity: num(row.total_quantity),
      createdAt: iso(row.created_at) as string,
      version: num(row.version),
    };
  }

  async create(dto: CreateIssueReqDto, scope: Scope): Promise<IssueRes> {
    const tenantId = TenantContext.require();
    assertBranchInScope(scope, dto.branchId);
    await this.branches.assertActive(dto.branchId);
    const id = randomUUID();
    await this.dataSource.transaction(async (em) => {
      if (dto.supplierId) {
        const found = await em.query(
          `SELECT 1 FROM ${this.t('supplier')} WHERE "tenant_id" = $1 AND "id" = $2 AND "deleted_at" IS NULL`,
          [tenantId, dto.supplierId],
        );
        if (!found.length) {
          throw badRequest(
            InventoryErrorCode.UNKNOWN_SUPPLIER,
            'The supplier does not exist in this store',
          );
        }
      }
      const code = await nextCode(
        em,
        tenantId,
        this.t('code_sequence'),
        'stock_issue',
        'PX',
        5,
      );
      await em.query(
        `INSERT INTO ${this.t('stock_issue')} ("id","tenant_id","code","branch_id","reason","supplier_id","note","status","created_by")
         VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8)`,
        [
          id,
          tenantId,
          code,
          dto.branchId,
          dto.reason,
          dto.supplierId ?? null,
          dto.note ?? null,
          actorId(),
        ],
      );
      for (const line of mergeDocumentLines(dto.items)) {
        await em.query(
          `INSERT INTO ${this.t('stock_issue_line')} ("id","tenant_id","stock_issue_id","variant_id","sku","quantity")
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            randomUUID(),
            tenantId,
            id,
            line.variantId ?? null,
            line.sku,
            line.quantity,
          ],
        );
      }
    });
    return this.get(id, scope);
  }

  async get(id: string, scope: Scope): Promise<IssueRes> {
    const tenantId = TenantContext.require();
    const em: EntityManager = this.dataSource.manager;
    const rows = await em.query(
      `${this.select()} WHERE x."tenant_id" = $1 AND x."id" = $2`,
      [tenantId, id],
    );
    if (!rows.length) throw notFound('Stock issue');
    assertVisible(scope, 'Stock issue', rows[0].branch_id);
    const lines = await em.query(
      `SELECT * FROM ${this.t('stock_issue_line')} WHERE "tenant_id" = $1 AND "stock_issue_id" = $2 ORDER BY "sku"`,
      [tenantId, id],
    );
    return {
      ...this.map(rows[0]),
      items: lines.map((l: Record<string, any>) => ({
        variantId: l.variant_id ?? null,
        sku: l.sku,
        quantity: num(l.quantity),
      })),
    };
  }

  async list(
    query: ListIssuesReqDto,
    scope: Scope,
  ): Promise<Page<IssueRowRes>> {
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
      `SELECT count(*) AS count FROM ${this.t('stock_issue')} x ${where.sql}`,
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

  /** Deducts the branch (respecting holds); 409 I002 with the shortages leaves the draft untouched */
  async approve(
    id: string,
    dto: DocumentActionReqDto,
    scope: Scope,
  ): Promise<IssueRes> {
    const tenantId = TenantContext.require();
    await this.dataSource.transaction(async (em) => {
      const row = await this.lockHeader(
        em,
        'stock_issue',
        tenantId,
        id,
        'Stock issue',
        dto.version,
        (row) => assertVisible(scope, 'Stock issue', row.branch_id),
      );
      if (row.status !== 'draft') {
        throw badRequest(
          InventoryErrorCode.INVALID_TRANSITION,
          `An issue that is ${row.status} cannot be approved`,
        );
      }
      const lines = await em.query(
        `SELECT "sku", "quantity" FROM ${this.t('stock_issue_line')} WHERE "tenant_id" = $1 AND "stock_issue_id" = $2`,
        [tenantId, id],
      );
      await deductStock(
        em,
        this.movement,
        tenantId,
        row.branch_id,
        lines.map((l: Record<string, any>) => ({
          sku: l.sku,
          quantity: num(l.quantity),
        })),
        'issue',
        id,
      );
      await this.bump(em, 'stock_issue', tenantId, id, `"status" = 'approved'`);
    });
    return this.get(id, scope);
  }

  async cancel(
    id: string,
    dto: DocumentActionReqDto,
    scope: Scope,
  ): Promise<IssueRes> {
    const tenantId = TenantContext.require();
    await this.dataSource.transaction(async (em) => {
      const row = await this.lockHeader(
        em,
        'stock_issue',
        tenantId,
        id,
        'Stock issue',
        dto.version,
        (row) => assertVisible(scope, 'Stock issue', row.branch_id),
      );
      if (row.status !== 'draft') {
        throw badRequest(
          InventoryErrorCode.INVALID_TRANSITION,
          `An issue that is ${row.status} cannot be cancelled`,
        );
      }
      await this.bump(
        em,
        'stock_issue',
        tenantId,
        id,
        `"status" = 'cancelled'`,
      );
    });
    return this.get(id, scope);
  }
}
