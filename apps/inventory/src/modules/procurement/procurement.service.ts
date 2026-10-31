import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { RequestContext, runInTenantTransaction } from '@pbl/common';
import {
  INVENTORY_PURCHASE_ORDER_APPROVED,
  PurchaseOrderApprovedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  convertToBaseQtyMilli,
  formatCentsToMoney,
  formatFactorFromTenThousandths,
  formatMilliToQty,
  InventoryDomainError,
  InventoryDomainErrorCode,
  normalizeInventoryCode,
  parseConversionFactorToTenThousandths,
  parseMoneyToCents,
  parseQtyToMilli,
} from '../../domain/inventory-domain';
import {
  applyWarehouseScope,
  WarehouseScope,
} from '../../scope/warehouse-scope';
import { ReceivingService } from '../receiving/receiving.service';
import {
  assertActiveWarehouse,
  schemaPrefix,
} from '../warehouses/warehouses.service';
import {
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  ReceivePurchaseOrderDto,
  UpdateSupplierDto,
} from './procurement.dto';

@Injectable()
export class ProcurementService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly receiving: ReceivingService,
    @Optional() private readonly outbox?: EventOutbox,
  ) {}

  async createSupplier(dto: CreateSupplierDto) {
    const code = normalizeInventoryCode(dto.code, 'supplier code');
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const existing = await em.query(
        `
        SELECT id
        FROM ${prefix}"supplier"
        WHERE tenant_id = $1 AND code = $2
        LIMIT 1
        `,
        [tenantId, code],
      );
      if (existing.length > 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.SUPPLIER_CODE_CONFLICT,
          `Supplier code "${code}" already exists`,
          409,
        );
      }

      const rows = await em.query(
        `
        INSERT INTO ${prefix}"supplier" (
          id, tenant_id, code, name, phone, email, address, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
        RETURNING
          id,
          tenant_id AS "tenantId",
          code,
          name,
          phone,
          email,
          address,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `,
        [
          randomUUID(),
          tenantId,
          code,
          dto.name.trim(),
          dto.phone ?? null,
          dto.email ?? null,
          dto.address ?? null,
        ],
      );
      return rows[0];
    });
  }

  async listSuppliers(q?: string, status?: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const params: unknown[] = [tenantId];
      const filters: string[] = [];

      if (status) {
        params.push(status);
        filters.push(`AND status = $${params.length}`);
      }
      if (q) {
        params.push(`%${q.trim()}%`);
        filters.push(
          `AND (name ILIKE $${params.length} OR code ILIKE $${params.length})`,
        );
      }

      return em.query(
        `
        SELECT
          id,
          tenant_id AS "tenantId",
          code,
          name,
          phone,
          email,
          address,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM ${prefix}"supplier"
        WHERE tenant_id = $1 ${filters.join(' ')}
        ORDER BY code ASC
        `,
        params,
      );
    });
  }

  async updateSupplier(supplierId: string, dto: UpdateSupplierDto) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const existing = await em.query(
        `
        SELECT *
        FROM ${prefix}"supplier"
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE
        `,
        [tenantId, supplierId],
      );
      if (existing.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.SUPPLIER_NOT_FOUND,
          `Supplier ${supplierId} not found`,
          404,
        );
      }
      const cur = existing[0];
      const rows = await em.query(
        `
        UPDATE ${prefix}"supplier"
        SET
          name = $3,
          phone = $4,
          email = $5,
          address = $6,
          status = $7,
          updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING
          id,
          tenant_id AS "tenantId",
          code,
          name,
          phone,
          email,
          address,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `,
        [
          tenantId,
          supplierId,
          dto.name !== undefined ? dto.name.trim() : cur.name,
          dto.phone !== undefined ? dto.phone : cur.phone,
          dto.email !== undefined ? dto.email : cur.email,
          dto.address !== undefined ? dto.address : cur.address,
          dto.status ?? cur.status,
        ],
      );
      const resultRows = Array.isArray(rows[0]) ? rows[0] : rows;
      return resultRows[0];
    });
  }

  async createPurchaseOrder(dto: CreatePurchaseOrderDto) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      await assertActiveWarehouse(em, prefix, tenantId, dto.warehouseId);

      const supRows = await em.query(
        `
        SELECT id, status
        FROM ${prefix}"supplier"
        WHERE tenant_id = $1 AND id = $2
        LIMIT 1
        `,
        [tenantId, dto.supplierId],
      );
      if (supRows.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.SUPPLIER_NOT_FOUND,
          `Supplier ${dto.supplierId} not found`,
          404,
        );
      }
      if (supRows[0].status !== 'ACTIVE') {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.SUPPLIER_INACTIVE,
          `Supplier ${dto.supplierId} is INACTIVE`,
          409,
        );
      }

      const merged = new Map<
        string,
        {
          skuId: string;
          baseQtyMilli: bigint;
          unitCostCents: bigint;
          unitName: string;
          conversionFactor: string;
        }
      >();

      for (const item of dto.items) {
        const factor = parseConversionFactorToTenThousandths(
          item.conversionFactor,
        );
        const baseQtyMilli = convertToBaseQtyMilli(
          item.orderedQty,
          item.conversionFactor,
        );
        const unitCostCents = parseMoneyToCents(item.unitCost);
        const existing = merged.get(item.skuId);
        if (existing) {
          existing.baseQtyMilli += baseQtyMilli;
          existing.unitCostCents = unitCostCents;
        } else {
          merged.set(item.skuId, {
            skuId: item.skuId,
            baseQtyMilli,
            unitCostCents,
            unitName: (item.unitName ?? 'PCS').trim().toUpperCase(),
            conversionFactor: formatFactorFromTenThousandths(factor),
          });
        }
      }

      const sortedLines = Array.from(merged.values()).sort((a, b) =>
        a.skuId.localeCompare(b.skuId),
      );

      let totalAmountCents = 0n;
      for (const l of sortedLines) {
        totalAmountCents += (l.baseQtyMilli * l.unitCostCents + 500n) / 1000n;
      }

      const poId = randomUUID();
      const code = dto.code
        ? normalizeInventoryCode(dto.code, 'purchase order code')
        : `PO-${poId.slice(0, 8).toUpperCase()}`;

      await em.query(
        `
        INSERT INTO ${prefix}"purchase_order" (
          id, tenant_id, code, supplier_id, warehouse_id,
          status, total_amount, note, created_by
        ) VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6::numeric(18,2), $7, $8)
        `,
        [
          poId,
          tenantId,
          code,
          dto.supplierId,
          dto.warehouseId,
          formatCentsToMoney(totalAmountCents),
          dto.note ?? null,
          RequestContext.get()?.actor?.id ?? null,
        ],
      );

      for (let i = 0; i < sortedLines.length; i += 1) {
        const line = sortedLines[i];
        await em.query(
          `
          INSERT INTO ${prefix}"purchase_order_item" (
            id, tenant_id, purchase_order_id, line_no, sku_id,
            ordered_qty, received_qty, unit_cost, unit_name, conversion_factor
          ) VALUES ($1, $2, $3, $4, $5, $6::numeric(18,3), 0, $7::numeric(18,2), $8, $9::numeric(18,4))
          `,
          [
            randomUUID(),
            tenantId,
            poId,
            i + 1,
            line.skuId,
            formatMilliToQty(line.baseQtyMilli),
            formatCentsToMoney(line.unitCostCents),
            line.unitName,
            line.conversionFactor,
          ],
        );
      }

      return this.loadPurchaseOrderResponse(em, prefix, tenantId, poId);
    });
  }

  async approvePurchaseOrder(poId: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const headerRows = await em.query(
        `
        SELECT *
        FROM ${prefix}"purchase_order"
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE
        `,
        [tenantId, poId],
      );
      if (headerRows.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.PURCHASE_ORDER_NOT_FOUND,
          `Purchase order ${poId} not found`,
          404,
        );
      }
      const header = headerRows[0];
      if (header.status === 'APPROVED') {
        return this.loadPurchaseOrderResponse(em, prefix, tenantId, poId);
      }
      if (header.status !== 'DRAFT') {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.PURCHASE_ORDER_INVALID_STATE,
          `Cannot approve purchase order in state ${header.status}`,
          409,
        );
      }

      const approvedAt = new Date().toISOString();
      const actorId = RequestContext.get()?.actor?.id ?? 'system';

      await em.query(
        `
        UPDATE ${prefix}"purchase_order"
        SET
          status = 'APPROVED',
          approved_by = $3,
          approved_at = $4::timestamptz,
          updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        `,
        [tenantId, poId, actorId, approvedAt],
      );

      if (this.outbox) {
        await this.outbox.add(em, INVENTORY_PURCHASE_ORDER_APPROVED, {
          purchaseOrderId: poId,
          code: header.code,
          supplierId: header.supplier_id,
          warehouseId: header.warehouse_id,
          totalAmount: formatCentsToMoney(
            parseMoneyToCents(String(header.total_amount)),
          ),
          approvedAt,
        } satisfies PurchaseOrderApprovedPayload);
      }

      return this.loadPurchaseOrderResponse(em, prefix, tenantId, poId);
    });
  }

  async receivePurchaseOrder(
    poId: string,
    dto?: ReceivePurchaseOrderDto,
    idempotencyKey?: string,
  ) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);

      const headerRows = await em.query(
        `
        SELECT *
        FROM ${prefix}"purchase_order"
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE
        `,
        [tenantId, poId],
      );
      if (headerRows.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.PURCHASE_ORDER_NOT_FOUND,
          `Purchase order ${poId} not found`,
          404,
        );
      }
      const header = headerRows[0];
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(header.status)) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.PURCHASE_ORDER_INVALID_STATE,
          `Cannot receive against purchase order in state ${header.status}`,
          409,
        );
      }

      const dbItems = await em.query(
        `
        SELECT
          id,
          line_no AS "lineNo",
          sku_id AS "skuId",
          ordered_qty AS "orderedQty",
          received_qty AS "receivedQty",
          unit_cost AS "unitCost"
        FROM ${prefix}"purchase_order_item"
        WHERE tenant_id = $1 AND purchase_order_id = $2
        ORDER BY sku_id ASC
        FOR UPDATE
        `,
        [tenantId, poId],
      );

      const itemBySku = new Map<string, Record<string, unknown>>();
      for (const row of dbItems) {
        itemBySku.set(String(row.skuId), row);
      }

      const incomingLines =
        dto?.items && dto.items.length > 0
          ? dto.items
          : dbItems.map((row: Record<string, unknown>) => {
              const ordMilli = parseQtyToMilli(
                String(row.orderedQty),
                false,
                false,
              );
              const recMilli = parseQtyToMilli(
                String(row.receivedQty),
                true,
                false,
              );
              const remMilli = ordMilli - recMilli;
              return {
                skuId: String(row.skuId),
                qty: formatMilliToQty(remMilli),
                unitCost: formatCentsToMoney(
                  parseMoneyToCents(String(row.unitCost)),
                ),
              };
            });

      const receiptItems: {
        skuId: string;
        qty: string;
        unitCost: string;
      }[] = [];

      for (const reqLine of incomingLines) {
        const dbItem = itemBySku.get(reqLine.skuId);
        if (!dbItem) {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.OVER_RECEIPT_NOT_ALLOWED,
            `SKU ${reqLine.skuId} is not on purchase order ${header.code}`,
            409,
          );
        }

        const ordMilli = parseQtyToMilli(
          String(dbItem.orderedQty),
          false,
          false,
        );
        const prevRecMilli = parseQtyToMilli(
          String(dbItem.receivedQty),
          true,
          false,
        );
        const remMilli = ordMilli - prevRecMilli;
        const receiveNowMilli = parseQtyToMilli(reqLine.qty, false, false);

        if (receiveNowMilli > remMilli) {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.OVER_RECEIPT_NOT_ALLOWED,
            `Cannot receive ${formatMilliToQty(receiveNowMilli)} for SKU ${reqLine.skuId}; remaining ordered quantity is ${formatMilliToQty(remMilli)}`,
            409,
          );
        }

        const unitCostStr = formatCentsToMoney(
          parseMoneyToCents(reqLine.unitCost ?? String(dbItem.unitCost)),
        );
        const receiveNowStr = formatMilliToQty(receiveNowMilli);

        await em.query(
          `
          UPDATE ${prefix}"purchase_order_item"
          SET received_qty = $3::numeric(18,3)
          WHERE tenant_id = $1 AND id = $2
          `,
          [
            tenantId,
            dbItem.id,
            formatMilliToQty(prevRecMilli + receiveNowMilli),
          ],
        );

        receiptItems.push({
          skuId: reqLine.skuId,
          qty: receiveNowStr,
          unitCost: unitCostStr,
        });
      }

      // Create and post the authoritative StockReceipt in the same transaction
      const postedReceipt = await this.receiving.createReceiptInTx(
        em,
        tenantId,
        {
          warehouseId: header.warehouse_id,
          sourceType: 'PURCHASE_ORDER',
          purchaseOrderId: poId,
          supplierId: header.supplier_id,
          note: dto?.note ?? `Receipt for PO ${header.code}`,
          autoPost: true,
          items: receiptItems,
        },
        idempotencyKey,
      );

      // Re-check all PO items to determine PARTIALLY_RECEIVED vs RECEIVED
      const updatedItems = await em.query(
        `
        SELECT
          ordered_qty AS "orderedQty",
          received_qty AS "receivedQty"
        FROM ${prefix}"purchase_order_item"
        WHERE tenant_id = $1 AND purchase_order_id = $2
        `,
        [tenantId, poId],
      );

      let allReceived = true;
      for (const row of updatedItems) {
        const ord = parseQtyToMilli(String(row.orderedQty), false, false);
        const rec = parseQtyToMilli(String(row.receivedQty), true, false);
        if (rec < ord) {
          allReceived = false;
          break;
        }
      }

      const nextStatus = allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      await em.query(
        `
        UPDATE ${prefix}"purchase_order"
        SET status = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        `,
        [tenantId, poId, nextStatus],
      );

      const poResponse = await this.loadPurchaseOrderResponse(
        em,
        prefix,
        tenantId,
        poId,
      );
      return {
        ...poResponse,
        purchaseOrder: poResponse,
        latestReceipt: postedReceipt,
      };
    });
  }

  async listPurchaseOrders(
    supplierId?: string,
    status?: string,
    scope?: WarehouseScope,
  ) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const params: unknown[] = [tenantId];
      const filters: string[] = [];

      if (supplierId) {
        params.push(supplierId);
        filters.push(`AND supplier_id = $${params.length}`);
      }
      if (status) {
        params.push(status);
        filters.push(`AND status = $${params.length}`);
      }
      applyWarehouseScope(params, filters, 'warehouse_id', scope);

      const headers = await em.query(
        `
        SELECT id
        FROM ${prefix}"purchase_order"
        WHERE tenant_id = $1 ${filters.join(' ')}
        ORDER BY created_at DESC
        LIMIT 100
        `,
        params,
      );
      const results = [];
      for (const h of headers) {
        results.push(
          await this.loadPurchaseOrderResponse(em, prefix, tenantId, h.id),
        );
      }
      return results;
    });
  }

  async getPurchaseOrderById(poId: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      return this.loadPurchaseOrderResponse(em, prefix, tenantId, poId);
    });
  }

  private async loadPurchaseOrderResponse(
    em: EntityManager,
    prefix: string,
    tenantId: string,
    poId: string,
  ) {
    const headers = await em.query(
      `
      SELECT
        id,
        tenant_id AS "tenantId",
        code,
        supplier_id AS "supplierId",
        warehouse_id AS "warehouseId",
        status,
        total_amount AS "totalAmount",
        note,
        approved_by AS "approvedBy",
        approved_at AS "approvedAt",
        created_by AS "createdBy",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ${prefix}"purchase_order"
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1
      `,
      [tenantId, poId],
    );
    if (headers.length === 0) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.PURCHASE_ORDER_NOT_FOUND,
        `Purchase order ${poId} not found`,
        404,
      );
    }

    const items = await em.query(
      `
      SELECT
        id,
        line_no AS "lineNo",
        sku_id AS "skuId",
        ordered_qty AS "orderedQty",
        received_qty AS "receivedQty",
        (ordered_qty - received_qty) AS "remainingQty",
        unit_cost AS "unitCost",
        unit_name AS "unitName",
        conversion_factor AS "conversionFactor"
      FROM ${prefix}"purchase_order_item"
      WHERE tenant_id = $1 AND purchase_order_id = $2
      ORDER BY line_no ASC
      `,
      [tenantId, poId],
    );

    const h = headers[0];
    return {
      ...h,
      totalAmount: formatCentsToMoney(parseMoneyToCents(String(h.totalAmount))),
      items: items.map((i: Record<string, unknown>) => ({
        id: i.id,
        lineNo: Number(i.lineNo),
        skuId: i.skuId,
        orderedQty: formatMilliToQty(
          parseQtyToMilli(String(i.orderedQty), false, false),
        ),
        receivedQty: formatMilliToQty(
          parseQtyToMilli(String(i.receivedQty), true, false),
        ),
        remainingQty: formatMilliToQty(
          parseQtyToMilli(String(i.remainingQty), true, false),
        ),
        unitCost: formatCentsToMoney(
          parseMoneyToCents(String(i.unitCost ?? '0')),
        ),
        unitName: i.unitName,
        conversionFactor: formatFactorFromTenThousandths(
          parseConversionFactorToTenThousandths(
            String(i.conversionFactor ?? '1'),
          ),
        ),
      })),
    };
  }
}
