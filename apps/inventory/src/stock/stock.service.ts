import { BadRequestException, Injectable } from '@nestjs/common';
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
import { ListStockReqDto, StockReceiptReqDto } from './dto/stock.dto';
import { StockItemEntity } from './entities/stock.entities';
import { mergeLines } from './stock-lines';

/** Error codes of this service (a domain letter plus 3 digits, api-conventions §6) */
export const InventoryErrorCode = {
  UNKNOWN_BRANCH: 'I001',
  OUT_OF_STOCK: 'I002',
  RESERVATION_MISMATCH: 'I003',
} as const;

export interface StockRes {
  branchId: string;
  sku: string;
  onHand: number;
  reserved: number;
  /** What can still be sold: on hand minus the holds */
  available: number;
}

export interface Page<T> {
  data: T[];
  pagination: {
    limit: number;
    currentPage: number;
    nextPage?: number;
    totalRecords: number;
    totalPages: number;
  };
}

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
  async receive(dto: StockReceiptReqDto): Promise<StockRes[]> {
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
      const result: StockRes[] = [];
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

  async list(query: ListStockReqDto): Promise<Page<StockRes>> {
    const [rows, total] = await this.stock.findAndCount({
      where: query.branchId ? { branchId: query.branchId } : {},
      order: { sku: 'ASC', branchId: 'ASC' },
      take: query.limit,
      skip: (query.page - 1) * query.limit,
    });
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    return {
      data: rows.map((row) => ({
        branchId: row.branchId,
        sku: row.sku,
        onHand: row.quantityOnHand,
        reserved: row.quantityReserved,
        available: row.quantityOnHand - row.quantityReserved,
      })),
      pagination: {
        limit: query.limit,
        currentPage: query.page,
        ...(query.page < totalPages ? { nextPage: query.page + 1 } : {}),
        totalRecords: total,
        totalPages,
      },
    };
  }
}
