import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext } from '@pbl/common';
import { qualifiedTable } from '@pbl/events';
import { DataSource } from 'typeorm';
import {
  Page,
  Scope,
  Where,
  assertBranchInScope,
  iso,
  num,
  pageOf,
} from '../common/sql';
import { ListLedgerReqDto } from './dto/ledger.dto';

export interface LedgerEntryRes {
  id: string;
  branchId: string;
  variantId: string | null;
  sku: string;
  changeQty: number;
  balanceAfter: number;
  refType: string;
  refId: string;
  refCode: string | null;
  actor: null;
  createdAt: string;
}

/** Stock movement history, newest first */
@Injectable()
export class LedgerService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(
    query: ListLedgerReqDto,
    scope: Scope,
  ): Promise<Page<LedgerEntryRes>> {
    const where = new Where().add('"tenant_id" = ?', TenantContext.require());
    if (query.branchId) {
      assertBranchInScope(scope, query.branchId);
      where.add('"branch_id" = ?', query.branchId);
    } else {
      where.branchScope(scope, '"branch_id"');
    }
    if (query.sku) where.add('"sku" = ?', query.sku);
    if (query.refType) where.add('"ref_type" = ?', query.refType);
    where.dateRange('"created_at"', query.from, query.to);
    const table = qualifiedTable(this.dataSource, 'inventory_ledger');
    const [{ count }] = await this.dataSource.query(
      `SELECT count(*) AS count FROM ${table} ${where.sql}`,
      where.params,
    );
    const rows = await this.dataSource.query(
      `SELECT * FROM ${table} ${where.sql} ORDER BY "created_at" DESC, "id" DESC
       LIMIT ${where.param(query.limit)} OFFSET ${where.param((query.page - 1) * query.limit)}`,
      where.params,
    );
    return pageOf(
      rows.map(
        (row: Record<string, unknown>): LedgerEntryRes => ({
          id: row.id as string,
          branchId: row.branch_id as string,
          variantId: null,
          sku: row.sku as string,
          changeQty: num(row.change_qty),
          balanceAfter: num(row.balance_after),
          refType: row.ref_type as string,
          refId: row.ref_id as string,
          refCode: null,
          actor: null,
          createdAt: iso(row.created_at as Date) as string,
        }),
      ),
      Number(count),
      query.page,
      query.limit,
    );
  }
}
