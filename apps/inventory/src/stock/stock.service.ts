import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  InjectTenantScopedRepository,
  runInTenantTransaction,
  TenantContext,
  TenantScopedRepository,
} from '@pbl/common';
import { INVENTORY_STOCK_CHANGED, StockChangedPayload } from '@pbl/contracts';
import { EventOutbox, qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import {
  CreateWarehouseDto,
  ListStockReqDto,
  ReceiveStockBalanceDto,
  StockReceiptReqDto,
} from './dto/stock.dto';
import { StockItemEntity } from './entities/stock.entities';
import {
  formatMilliToDecimal,
  parseDecimalToMilli,
  WarehouseReservationErrorCode,
} from './reservations.service';
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
    @Optional() private readonly outbox?: EventOutbox,
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

  private schemaPrefix(em: EntityManager): string {
    const schema = (em.connection?.options as { schema?: string } | undefined)
      ?.schema;
    return schema ? `"${schema}".` : '';
  }

  async createWarehouse(dto: CreateWarehouseDto) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = this.schemaPrefix(em);
      const id = randomUUID();
      const rows = await em.query(
        `
        INSERT INTO ${prefix}"warehouse" (
          id, tenant_id, branch_id, code, name, is_default, status
        ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
        ON CONFLICT (tenant_id, code) DO UPDATE
        SET name = EXCLUDED.name, branch_id = EXCLUDED.branch_id, updated_at = now()
        RETURNING
          id,
          tenant_id AS "tenantId",
          branch_id AS "branchId",
          code,
          name,
          is_default AS "isDefault",
          status
        `,
        [
          id,
          tenantId,
          dto.branchId,
          dto.code,
          dto.name,
          dto.isDefault ?? false,
        ],
      );
      return rows[0];
    });
  }

  async listWarehouses() {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = this.schemaPrefix(em);
      return em.query(
        `
        SELECT
          id,
          tenant_id AS "tenantId",
          branch_id AS "branchId",
          code,
          name,
          is_default AS "isDefault",
          status
        FROM ${prefix}"warehouse"
        WHERE tenant_id = $1
        ORDER BY code ASC
        `,
        [tenantId],
      );
    });
  }

  async receiveStockBalance(dto: ReceiveStockBalanceDto) {
    const qtyMilli = parseDecimalToMilli(dto.qty);
    if (qtyMilli <= 0n) {
      throw new BadRequestException({
        errorCode: WarehouseReservationErrorCode.INVALID_QUANTITY,
        message: 'Receipt quantity must be strictly positive',
      });
    }
    const qtyStr = formatMilliToDecimal(qtyMilli);
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = this.schemaPrefix(em);
      const rows = await em.query(
        `
        INSERT INTO ${prefix}"stock_balance" (
          id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty, in_transit_qty, version
        ) VALUES ($1, $2, $3, $4, $5::numeric(18,3), 0, 0, 1)
        ON CONFLICT (tenant_id, warehouse_id, sku_id) DO UPDATE
        SET
          on_hand_qty = ${prefix}"stock_balance".on_hand_qty + EXCLUDED.on_hand_qty,
          version = ${prefix}"stock_balance".version + 1,
          updated_at = now()
        RETURNING
          id,
          tenant_id AS "tenantId",
          warehouse_id AS "warehouseId",
          sku_id AS "skuId",
          on_hand_qty AS "onHandQty",
          reserved_qty AS "reservedQty",
          (on_hand_qty - reserved_qty) AS "availableQty",
          version
        `,
        [randomUUID(), tenantId, dto.warehouseId, dto.skuId, qtyStr],
      );
      const balance = rows[0];
      const refId = dto.referenceId ?? randomUUID();
      const occurredAt = new Date().toISOString();
      const onHandAfter = formatMilliToDecimal(
        parseDecimalToMilli(String(balance.onHandQty)),
      );
      const reservedAfter = formatMilliToDecimal(
        parseDecimalToMilli(String(balance.reservedQty)),
      );
      await em.query(
        `
        INSERT INTO ${prefix}"stock_balance_ledger" (
          id, tenant_id, warehouse_id, sku_id, movement_type, qty_delta,
          on_hand_after, reserved_after, reference_type, reference_id, occurred_at
        ) VALUES ($1, $2, $3, $4, 'RECEIPT', $5::numeric(18,3), $6::numeric(18,3), $7::numeric(18,3), 'RECEIPT', $8, $9)
        `,
        [
          randomUUID(),
          tenantId,
          dto.warehouseId,
          dto.skuId,
          qtyStr,
          onHandAfter,
          reservedAfter,
          refId,
          occurredAt,
        ],
      );
      if (this.outbox) {
        await this.outbox.add(em, INVENTORY_STOCK_CHANGED, {
          warehouseId: dto.warehouseId,
          skuId: dto.skuId,
          movementType: 'RECEIPT',
          qtyDelta: qtyStr,
          onHandAfter,
          reservedAfter,
          referenceType: 'RECEIPT',
          referenceId: refId,
          occurredAt,
        } satisfies StockChangedPayload);
      }
      return {
        ...balance,
        onHandQty: onHandAfter,
        reservedQty: reservedAfter,
        availableQty: formatMilliToDecimal(
          parseDecimalToMilli(String(balance.availableQty)),
        ),
      };
    });
  }

  async listStockBalances(warehouseId?: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = this.schemaPrefix(em);
      const params: unknown[] = [tenantId];
      const filter = warehouseId ? `AND warehouse_id = $2` : '';
      if (warehouseId) params.push(warehouseId);
      const rows = await em.query(
        `
        SELECT
          id,
          tenant_id AS "tenantId",
          warehouse_id AS "warehouseId",
          sku_id AS "skuId",
          on_hand_qty AS "onHandQty",
          reserved_qty AS "reservedQty",
          (on_hand_qty - reserved_qty) AS "availableQty",
          version
        FROM ${prefix}"stock_balance"
        WHERE tenant_id = $1 ${filter}
        ORDER BY warehouse_id ASC, sku_id ASC
        `,
        params,
      );
      return rows.map((r: Record<string, unknown>) => ({
        ...r,
        onHandQty: formatMilliToDecimal(
          parseDecimalToMilli(String(r.onHandQty)),
        ),
        reservedQty: formatMilliToDecimal(
          parseDecimalToMilli(String(r.reservedQty)),
        ),
        availableQty: formatMilliToDecimal(
          parseDecimalToMilli(String(r.availableQty)),
        ),
      }));
    });
  }
}
