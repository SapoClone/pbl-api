import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
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
  Page,
  Where,
  iso,
  likePattern,
  numOrNull,
  pageOf,
} from '../common/sql';
import {
  ListThresholdsReqDto,
  UpsertThresholdReqDto,
} from './dto/threshold.dto';
import { InventoryErrorCode } from './stock.service';

export interface ThresholdRes {
  branchId: string;
  variantId: string | null;
  sku: string;
  minQuantity: number | null;
  maxQuantity: number | null;
  updatedAt: string;
}

const toRes = (row: Record<string, unknown>): ThresholdRes => ({
  branchId: row.branch_id as string,
  variantId: (row.variant_id as string) ?? null,
  sku: row.sku as string,
  minQuantity: numOrNull(row.min_quantity),
  maxQuantity: numOrNull(row.max_quantity),
  updatedAt: iso(row.updated_at as Date) as string,
});

/** Low-stock (min) and target (max) quantities per branch and SKU */
@Injectable()
export class StockThresholdsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectTenantScopedRepository(BranchProjectionEntity)
    private readonly branches: TenantScopedRepository<BranchProjectionEntity>,
  ) {}

  /** Upsert keyed by (tenant, branch, sku); `variantId` is stored without validation */
  async upsert(dto: UpsertThresholdReqDto): Promise<ThresholdRes> {
    const tenantId = TenantContext.require();
    const min = dto.minQuantity ?? null;
    const max = dto.maxQuantity ?? null;
    if (min !== null && max !== null && max < min) {
      throw new UnprocessableEntityException(
        'maxQuantity must not be below minQuantity',
      );
    }
    const branch = await this.branches.findOne({
      where: { branchId: dto.branchId },
    });
    if (!branch || branch.status !== 'active') {
      throw new BadRequestException({
        errorCode: InventoryErrorCode.UNKNOWN_BRANCH,
        message: 'The branch does not exist in this store or is not active',
      });
    }
    const table = qualifiedTable(this.dataSource, 'stock_threshold');
    const rows = await this.dataSource.query(
      `INSERT INTO ${table} ("id", "tenant_id", "branch_id", "sku", "variant_id", "min_quantity", "max_quantity")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ("tenant_id", "branch_id", "sku") DO UPDATE SET
         "variant_id" = COALESCE(EXCLUDED."variant_id", ${table}."variant_id"),
         "min_quantity" = EXCLUDED."min_quantity",
         "max_quantity" = EXCLUDED."max_quantity",
         "updated_at" = now()
       RETURNING *`,
      [
        randomUUID(),
        tenantId,
        dto.branchId,
        dto.sku,
        dto.variantId ?? null,
        min,
        max,
      ],
    );
    return toRes(rows[0]);
  }

  async list(query: ListThresholdsReqDto): Promise<Page<ThresholdRes>> {
    const where = new Where().add('"tenant_id" = ?', TenantContext.require());
    if (query.branchId) where.add('"branch_id" = ?', query.branchId);
    if (query.q) where.add('"sku" ILIKE ?', likePattern(query.q));
    const table = qualifiedTable(this.dataSource, 'stock_threshold');
    const rows = await this.dataSource.query(
      `SELECT * FROM ${table} ${where.sql} ORDER BY "sku" ASC, "branch_id" ASC
       LIMIT ${where.param(query.limit)} OFFSET ${where.param((query.page - 1) * query.limit)}`,
      where.params,
    );
    const [{ count }] = await this.dataSource.query(
      `SELECT count(*) AS count FROM ${table} ${where.sql}`,
      where.params.slice(0, -2),
    );
    return pageOf(rows.map(toRes), Number(count), query.page, query.limit);
  }
}
