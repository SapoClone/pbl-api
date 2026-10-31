import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext } from '@pbl/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { BranchGuard } from '../common/branch-guard';
import {
  Page,
  Where,
  actorId,
  badRequest,
  iso,
  likePattern,
  nextCode,
  notFound,
  num,
  pageOf,
} from '../common/sql';
import { addStock, deductStock } from '../stock/stock-movement';
import { InventoryErrorCode } from '../stock/stock.service';
import { DocumentBase, mergeDocumentLines } from './document-base';
import {
  CreateTransferReqDto,
  DocumentActionReqDto,
  ListTransfersReqDto,
  ReceiveTransferReqDto,
} from './document.dto';

export type TransferStatus = 'draft' | 'in_transit' | 'received' | 'cancelled';

export interface TransferRowRes {
  id: string;
  code: string;
  status: TransferStatus;
  fromBranch: { id: string; name: string | null };
  toBranch: { id: string; name: string | null };
  totalQuantity: number;
  note: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  version: number;
}

export interface TransferRes extends TransferRowRes {
  items: {
    variantId: string | null;
    sku: string;
    quantity: number;
    receivedQuantity: number | null;
  }[];
}

/**
 * draft -> in_transit (ship deducts the source, `transfer_out`) -> received (adds the
 * destination, `transfer_in`). Each step is one transaction.
 */
@Injectable()
export class StockTransfersService extends DocumentBase {
  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly branches: BranchGuard,
  ) {
    super(dataSource);
  }

  private select(): string {
    return `SELECT x.*, f."name" AS from_name, d."name" AS to_name,
              (SELECT coalesce(sum(l."quantity"), 0) FROM ${this.t('stock_transfer_line')} l WHERE l."stock_transfer_id" = x."id") AS total_quantity
            FROM ${this.t('stock_transfer')} x
            LEFT JOIN ${this.t('branch_projection')} f ON f."branch_id" = x."from_branch_id" AND f."tenant_id" = x."tenant_id"
            LEFT JOIN ${this.t('branch_projection')} d ON d."branch_id" = x."to_branch_id" AND d."tenant_id" = x."tenant_id"`;
  }

  private map(row: Record<string, any>): TransferRowRes {
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      fromBranch: { id: row.from_branch_id, name: row.from_name ?? null },
      toBranch: { id: row.to_branch_id, name: row.to_name ?? null },
      totalQuantity: num(row.total_quantity),
      note: row.note ?? null,
      shippedAt: iso(row.shipped_at),
      receivedAt: iso(row.received_at),
      createdAt: iso(row.created_at) as string,
      version: num(row.version),
    };
  }

  async create(dto: CreateTransferReqDto): Promise<TransferRes> {
    const tenantId = TenantContext.require();
    if (dto.fromBranchId === dto.toBranchId) {
      throw badRequest(
        InventoryErrorCode.SAME_BRANCH,
        'A transfer needs two different branches',
      );
    }
    await this.branches.assertActive(dto.fromBranchId);
    await this.branches.assertActive(dto.toBranchId);
    const id = randomUUID();
    await this.dataSource.transaction(async (em) => {
      const code = await nextCode(
        em,
        tenantId,
        this.t('code_sequence'),
        'stock_transfer',
        'DC',
        5,
      );
      await em.query(
        `INSERT INTO ${this.t('stock_transfer')} ("id","tenant_id","code","from_branch_id","to_branch_id","status","note","created_by")
         VALUES ($1,$2,$3,$4,$5,'draft',$6,$7)`,
        [
          id,
          tenantId,
          code,
          dto.fromBranchId,
          dto.toBranchId,
          dto.note ?? null,
          actorId(),
        ],
      );
      for (const line of mergeDocumentLines(dto.items)) {
        await em.query(
          `INSERT INTO ${this.t('stock_transfer_line')} ("id","tenant_id","stock_transfer_id","variant_id","sku","quantity")
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
    return this.get(id);
  }

  async get(id: string): Promise<TransferRes> {
    return this.load(this.dataSource.manager, TenantContext.require(), id);
  }

  private async load(
    em: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<TransferRes> {
    const rows = await em.query(
      `${this.select()} WHERE x."tenant_id" = $1 AND x."id" = $2`,
      [tenantId, id],
    );
    if (!rows.length) throw notFound('Stock transfer');
    const lines = await em.query(
      `SELECT * FROM ${this.t('stock_transfer_line')} WHERE "tenant_id" = $1 AND "stock_transfer_id" = $2 ORDER BY "sku"`,
      [tenantId, id],
    );
    return {
      ...this.map(rows[0]),
      items: lines.map((l: Record<string, any>) => ({
        variantId: l.variant_id ?? null,
        sku: l.sku,
        quantity: num(l.quantity),
        receivedQuantity:
          l.received_quantity === null ? null : num(l.received_quantity),
      })),
    };
  }

  async list(query: ListTransfersReqDto): Promise<Page<TransferRowRes>> {
    const where = new Where().add('x."tenant_id" = ?', TenantContext.require());
    if (query.branchId) {
      const p = where.param(query.branchId);
      where.add(`(x."from_branch_id" = ${p} OR x."to_branch_id" = ${p})`);
    }
    if (query.status) where.add('x."status" = ?', query.status);
    if (query.q) where.add('x."code" ILIKE ?', likePattern(query.q));
    where.dateRange('x."created_at"', query.from, query.to);
    const [{ count }] = await this.dataSource.query(
      `SELECT count(*) AS count FROM ${this.t('stock_transfer')} x ${where.sql}`,
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

  private invalid(status: string, verb: string) {
    return badRequest(
      InventoryErrorCode.INVALID_TRANSITION,
      `A transfer that is ${status} cannot be ${verb}`,
    );
  }

  /** Deducts the source; 409 I002 with the shortages leaves everything unchanged */
  async ship(id: string, dto: DocumentActionReqDto): Promise<TransferRes> {
    const tenantId = TenantContext.require();
    await this.dataSource.transaction(async (em) => {
      const row = await this.lockHeader(
        em,
        'stock_transfer',
        tenantId,
        id,
        'Stock transfer',
        dto.version,
      );
      if (row.status !== 'draft') throw this.invalid(row.status, 'shipped');
      const lines = await em.query(
        `SELECT "sku", "quantity" FROM ${this.t('stock_transfer_line')} WHERE "tenant_id" = $1 AND "stock_transfer_id" = $2`,
        [tenantId, id],
      );
      await deductStock(
        em,
        this.movement,
        tenantId,
        row.from_branch_id,
        lines.map((l: Record<string, any>) => ({
          sku: l.sku,
          quantity: num(l.quantity),
        })),
        'transfer_out',
        id,
      );
      await this.bump(
        em,
        'stock_transfer',
        tenantId,
        id,
        `"status" = 'in_transit', "shipped_at" = now()`,
      );
    });
    return this.get(id);
  }

  /** Adds what arrived (all of it unless `items` records a shortfall) to the destination */
  async receive(id: string, dto: ReceiveTransferReqDto): Promise<TransferRes> {
    const tenantId = TenantContext.require();
    await this.dataSource.transaction(async (em) => {
      const row = await this.lockHeader(
        em,
        'stock_transfer',
        tenantId,
        id,
        'Stock transfer',
        dto.version,
      );
      if (row.status !== 'in_transit')
        throw this.invalid(row.status, 'received');
      const lines = await em.query(
        `SELECT "id", "sku", "quantity" FROM ${this.t('stock_transfer_line')} WHERE "tenant_id" = $1 AND "stock_transfer_id" = $2`,
        [tenantId, id],
      );
      const reported = new Map(
        (dto.items ?? []).map((i) => [i.sku, i.receivedQuantity]),
      );
      for (const sku of reported.keys()) {
        if (!lines.some((l: Record<string, any>) => l.sku === sku)) {
          throw new UnprocessableEntityException(
            `${sku} is not on this transfer`,
          );
        }
      }
      const arrived: { sku: string; quantity: number }[] = [];
      for (const line of lines as Record<string, any>[]) {
        const received = reported.get(line.sku) ?? num(line.quantity);
        if (received > num(line.quantity)) {
          throw new UnprocessableEntityException(
            `${line.sku}: received more than was shipped`,
          );
        }
        await em.query(
          `UPDATE ${this.t('stock_transfer_line')} SET "received_quantity" = $2 WHERE "id" = $1`,
          [line.id, received],
        );
        if (received > 0) arrived.push({ sku: line.sku, quantity: received });
      }
      await addStock(
        em,
        this.movement,
        tenantId,
        row.to_branch_id,
        arrived,
        'transfer_in',
        id,
      );
      await this.bump(
        em,
        'stock_transfer',
        tenantId,
        id,
        `"status" = 'received', "received_at" = now()`,
      );
    });
    return this.get(id);
  }

  /** From draft nothing moved; from in_transit the goods go back to the source (`transfer_in`) */
  async cancel(id: string, dto: DocumentActionReqDto): Promise<TransferRes> {
    const tenantId = TenantContext.require();
    await this.dataSource.transaction(async (em) => {
      const row = await this.lockHeader(
        em,
        'stock_transfer',
        tenantId,
        id,
        'Stock transfer',
        dto.version,
      );
      if (row.status !== 'draft' && row.status !== 'in_transit') {
        throw this.invalid(row.status, 'cancelled');
      }
      if (row.status === 'in_transit') {
        const lines = await em.query(
          `SELECT "sku", "quantity" FROM ${this.t('stock_transfer_line')} WHERE "tenant_id" = $1 AND "stock_transfer_id" = $2`,
          [tenantId, id],
        );
        await addStock(
          em,
          this.movement,
          tenantId,
          row.from_branch_id,
          lines.map((l: Record<string, any>) => ({
            sku: l.sku,
            quantity: num(l.quantity),
          })),
          'transfer_in',
          id,
        );
      }
      await this.bump(
        em,
        'stock_transfer',
        tenantId,
        id,
        `"status" = 'cancelled'`,
      );
    });
    return this.get(id);
  }
}
