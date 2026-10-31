import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext } from '@pbl/common';
import { qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { BranchGuard } from '../common/branch-guard';
import {
  EXPORT_ROW_CAP,
  Page,
  TIME_ZONE,
  Where,
  actorId,
  badRequest,
  conflict,
  iso,
  likePattern,
  nextCode,
  notFound,
  num,
  pageOf,
  toCsv,
} from '../common/sql';
import { InventoryErrorCode } from '../stock/stock.service';
import {
  PAYABLE_STATUSES,
  PurchaseOrderAction,
  PurchaseOrderStatus,
  nextStatus,
  priceOrder,
} from './po-rules';
import {
  CreatePaymentReqDto,
  CreatePurchaseOrderReqDto,
  ExportPurchaseOrdersReqDto,
  PurchaseOrderActionReqDto,
  PurchaseOrderFilterDto,
  PurchaseOrderLineDto,
  PurchaseOrderSummaryReqDto,
  UpdatePurchaseOrderReqDto,
} from './purchase-order.dto';

export interface PurchaseOrderRowRes {
  id: string;
  code: string;
  createdAt: string;
  supplier: { id: string; name: string };
  branchId: string;
  quantityOrdered: number;
  quantityReceived: number;
  totalAmount: number;
  remainingAmount: number;
  status: PurchaseOrderStatus;
  expectedDate: string | null;
}

export interface PurchaseOrderRes extends PurchaseOrderRowRes {
  items: {
    id: string;
    variantId: string | null;
    sku: string;
    name: string;
    unitName: string | null;
    quantityOrdered: number;
    quantityReceived: number;
    unitCost: number;
    vatRate: number;
    lineSubtotal: number;
    vatAmount: number;
  }[];
  subtotal: number;
  vatAmount: number;
  depositAmount: number;
  paidAmount: number;
  paymentTermDays: number | null;
  noteToSupplier: string | null;
  cancelReason: string | null;
  /** Receiving against an order is deferred to the receipt flow */
  receipts: never[];
  version: number;
}

const SORTS: Record<string, string> = {
  createdAt: 'p."created_at"',
  expectedDate: 'p."expected_date"',
  totalAmount: 'p."total_amount"',
};

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly branches: BranchGuard,
  ) {}

  private t(name: string) {
    return qualifiedTable(this.dataSource, name);
  }

  // ---- reads ---------------------------------------------------------

  private rowSelect(): string {
    return `SELECT p.*, to_char(p."expected_date", 'YYYY-MM-DD') AS expected_day, s."name" AS supplier_name,
              (SELECT coalesce(sum(l."quantity_ordered"), 0) FROM ${this.t('purchase_order_line')} l WHERE l."purchase_order_id" = p."id") AS qty_ordered,
              (SELECT coalesce(sum(l."quantity_received"), 0) FROM ${this.t('purchase_order_line')} l WHERE l."purchase_order_id" = p."id") AS qty_received
            FROM ${this.t('purchase_order')} p JOIN ${this.t('supplier')} s ON s."id" = p."supplier_id"`;
  }

  private mapRow(row: Record<string, unknown>): PurchaseOrderRowRes {
    return {
      id: row.id as string,
      code: row.code as string,
      createdAt: iso(row.created_at as Date) as string,
      supplier: {
        id: row.supplier_id as string,
        name: row.supplier_name as string,
      },
      branchId: row.branch_id as string,
      quantityOrdered: num(row.qty_ordered),
      quantityReceived: num(row.qty_received),
      totalAmount: num(row.total_amount),
      remainingAmount: num(row.total_amount) - num(row.paid_amount),
      status: row.status as PurchaseOrderStatus,
      expectedDate: (row.expected_day as string) ?? null,
    };
  }

  private filters(
    tenantId: string,
    query: Omit<ExportPurchaseOrdersReqDto, 'sort' | 'order'>,
  ): Where {
    const where = new Where().add('p."tenant_id" = ?', tenantId);
    if (query.status) where.add('p."status" = ?', query.status);
    if (query.supplierId) where.add('p."supplier_id" = ?', query.supplierId);
    if (query.branchId) where.add('p."branch_id" = ?', query.branchId);
    if (query.q) {
      const like = where.param(likePattern(query.q));
      where.add(`(p."code" ILIKE ${like} OR s."name" ILIKE ${like})`);
    }
    return where.dateRange('p."created_at"', query.from, query.to);
  }

  async list(
    query: PurchaseOrderFilterDto,
  ): Promise<Page<PurchaseOrderRowRes>> {
    const where = this.filters(TenantContext.require(), query);
    const join = `${this.t('purchase_order')} p JOIN ${this.t('supplier')} s ON s."id" = p."supplier_id"`;
    const [{ count }] = await this.dataSource.query(
      `SELECT count(*) AS count FROM ${join} ${where.sql}`,
      where.params,
    );
    const rows = await this.dataSource.query(
      `${this.rowSelect()} ${where.sql}
       ORDER BY ${SORTS[query.sort ?? 'createdAt']} ${query.order ?? 'DESC'}, p."id"
       LIMIT ${where.param(query.limit)} OFFSET ${where.param((query.page - 1) * query.limit)}`,
      where.params,
    );
    return pageOf(
      rows.map((r: Record<string, unknown>) => this.mapRow(r)),
      Number(count),
      query.page,
      query.limit,
    );
  }

  async exportCsv(query: ExportPurchaseOrdersReqDto): Promise<string> {
    const where = this.filters(TenantContext.require(), query);
    const rows = await this.dataSource.query(
      `${this.rowSelect()} ${where.sql}
       ORDER BY ${SORTS[query.sort ?? 'createdAt']} ${query.order ?? 'DESC'}, p."id" LIMIT ${EXPORT_ROW_CAP}`,
      where.params,
    );
    return toCsv(
      [
        'code',
        'status',
        'supplier',
        'branchId',
        'expectedDate',
        'quantityOrdered',
        'quantityReceived',
        'subtotal',
        'vatAmount',
        'totalAmount',
        'paidAmount',
        'remainingAmount',
        'createdAt',
      ],
      rows.map((r: Record<string, unknown>) => [
        r.code,
        r.status,
        r.supplier_name,
        r.branch_id,
        r.expected_day,
        num(r.qty_ordered),
        num(r.qty_received),
        num(r.subtotal),
        num(r.vat_amount),
        num(r.total_amount),
        num(r.paid_amount),
        num(r.total_amount) - num(r.paid_amount),
        iso(r.created_at as Date),
      ]),
    );
  }

  async summary(query: PurchaseOrderSummaryReqDto) {
    const where = this.filters(TenantContext.require(), query);
    const open =
      "p.\"status\" IN ('draft','pending_approval','approved','partially_received')";
    const today = `(now() AT TIME ZONE '${TIME_ZONE}')::date`;
    const [row] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE ${open}) AS open_count,
              count(*) FILTER (WHERE p."status" = 'partially_received') AS partial_count,
              count(*) FILTER (WHERE p."status" = 'approved') AS awaiting_count,
              count(*) FILTER (WHERE p."status" IN ('approved','partially_received')
                AND p."expected_date" BETWEEN ${today} AND ${today} + 7) AS due_count,
              coalesce(sum(p."total_amount" - p."paid_amount") FILTER (WHERE p."status" IN ('approved','partially_received','received')), 0) AS payable
       FROM ${this.t('purchase_order')} p JOIN ${this.t('supplier')} s ON s."id" = p."supplier_id" ${where.sql}`,
      where.params,
    );
    return {
      openCount: num(row.open_count),
      partiallyReceivedCount: num(row.partial_count),
      awaitingDeliveryCount: num(row.awaiting_count),
      dueThisWeekCount: num(row.due_count),
      payableAmount: num(row.payable),
    };
  }

  async get(id: string): Promise<PurchaseOrderRes> {
    return this.load(this.dataSource.manager, TenantContext.require(), id);
  }

  private async load(
    em: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<PurchaseOrderRes> {
    const rows = await em.query(
      `${this.rowSelect()} WHERE p."tenant_id" = $1 AND p."id" = $2`,
      [tenantId, id],
    );
    if (!rows.length) throw notFound('Purchase order');
    const lines = await em.query(
      `SELECT * FROM ${this.t('purchase_order_line')} WHERE "tenant_id" = $1 AND "purchase_order_id" = $2 ORDER BY "line_no"`,
      [tenantId, id],
    );
    const row = rows[0];
    return {
      ...this.mapRow(row),
      items: lines.map((l: Record<string, unknown>) => ({
        id: l.id as string,
        variantId: (l.variant_id as string) ?? null,
        sku: l.sku as string,
        name: l.name as string,
        unitName: (l.unit_name as string) ?? null,
        quantityOrdered: num(l.quantity_ordered),
        quantityReceived: num(l.quantity_received),
        unitCost: num(l.unit_cost),
        vatRate: num(l.vat_rate),
        lineSubtotal: num(l.line_subtotal),
        vatAmount: num(l.vat_amount),
      })),
      subtotal: num(row.subtotal),
      vatAmount: num(row.vat_amount),
      depositAmount: num(row.deposit_amount),
      paidAmount: num(row.paid_amount),
      paymentTermDays:
        row.payment_term_days === null ? null : num(row.payment_term_days),
      noteToSupplier: (row.note_to_supplier as string) ?? null,
      cancelReason: (row.cancel_reason as string) ?? null,
      receipts: [],
      version: num(row.version),
    };
  }

  // ---- writes --------------------------------------------------------

  private async assertSupplier(
    em: EntityManager,
    tenantId: string,
    id: string,
  ) {
    const rows = await em.query(
      `SELECT 1 FROM ${this.t('supplier')} WHERE "tenant_id" = $1 AND "id" = $2 AND "deleted_at" IS NULL`,
      [tenantId, id],
    );
    if (!rows.length) {
      throw badRequest(
        InventoryErrorCode.UNKNOWN_SUPPLIER,
        'The supplier does not exist in this store',
      );
    }
  }

  /** Replaces the lines of an order and returns the computed totals */
  private async writeLines(
    em: EntityManager,
    tenantId: string,
    orderId: string,
    items: PurchaseOrderLineDto[],
  ) {
    const priced = priceOrder(items);
    await em.query(
      `DELETE FROM ${this.t('purchase_order_line')} WHERE "tenant_id" = $1 AND "purchase_order_id" = $2`,
      [tenantId, orderId],
    );
    for (const [index, item] of items.entries()) {
      await em.query(
        `INSERT INTO ${this.t('purchase_order_line')}
          ("id","tenant_id","purchase_order_id","line_no","variant_id","sku","name","unit_name","quantity_ordered","unit_cost","vat_rate","line_subtotal","vat_amount")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          randomUUID(),
          tenantId,
          orderId,
          index + 1,
          item.variantId ?? null,
          item.sku,
          item.name,
          item.unitName ?? null,
          item.quantityOrdered,
          item.unitCost,
          item.vatRate,
          priced.lines[index].lineSubtotal,
          priced.lines[index].vatAmount,
        ],
      );
    }
    return priced;
  }

  async create(dto: CreatePurchaseOrderReqDto): Promise<PurchaseOrderRes> {
    const tenantId = TenantContext.require();
    await this.branches.assertActive(dto.branchId);
    const id = randomUUID();
    await this.dataSource.transaction(async (em) => {
      await this.assertSupplier(em, tenantId, dto.supplierId);
      const code = await nextCode(
        em,
        tenantId,
        this.t('code_sequence'),
        'purchase_order',
        'PO',
        5,
      );
      await em.query(
        `INSERT INTO ${this.t('purchase_order')}
          ("id","tenant_id","code","supplier_id","branch_id","status","expected_date","note_to_supplier","payment_term_days","deposit_amount","created_by")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          tenantId,
          code,
          dto.supplierId,
          dto.branchId,
          dto.submit ? 'pending_approval' : 'draft',
          dto.expectedDate ?? null,
          dto.noteToSupplier ?? null,
          dto.paymentTermDays ?? null,
          dto.depositAmount ?? 0,
          actorId(),
        ],
      );
      const totals = await this.writeLines(em, tenantId, id, dto.items);
      await this.setTotals(em, tenantId, id, totals);
    });
    return this.get(id);
  }

  private setTotals(
    em: EntityManager,
    tenantId: string,
    id: string,
    totals: { subtotal: number; vatAmount: number; totalAmount: number },
  ) {
    return em.query(
      `UPDATE ${this.t('purchase_order')} SET "subtotal" = $3, "vat_amount" = $4, "total_amount" = $5
       WHERE "tenant_id" = $1 AND "id" = $2`,
      [tenantId, id, totals.subtotal, totals.vatAmount, totals.totalAmount],
    );
  }

  /** Locks the order row; checks the optimistic version when the client sent one */
  private async lock(
    em: EntityManager,
    tenantId: string,
    id: string,
    version?: number,
  ) {
    const [row] = await em.query(
      `SELECT * FROM ${this.t('purchase_order')} WHERE "tenant_id" = $1 AND "id" = $2 FOR UPDATE`,
      [tenantId, id],
    );
    if (!row) throw notFound('Purchase order');
    if (version !== undefined && version !== row.version) {
      throw conflict(
        InventoryErrorCode.VERSION_CONFLICT,
        'The purchase order was changed by someone else',
      );
    }
    return row as Record<string, unknown>;
  }

  /** Edits are allowed in `draft` only (I012) */
  async update(
    id: string,
    dto: UpdatePurchaseOrderReqDto,
  ): Promise<PurchaseOrderRes> {
    const tenantId = TenantContext.require();
    if (dto.branchId) await this.branches.assertActive(dto.branchId);
    await this.dataSource.transaction(async (em) => {
      const row = await this.lock(em, tenantId, id, dto.version);
      if (row.status !== 'draft') {
        throw badRequest(
          InventoryErrorCode.PURCHASE_ORDER_NOT_EDITABLE,
          'Only a draft purchase order can be edited',
        );
      }
      if (dto.supplierId)
        await this.assertSupplier(em, tenantId, dto.supplierId);
      const columns: [keyof UpdatePurchaseOrderReqDto, string][] = [
        ['supplierId', 'supplier_id'],
        ['branchId', 'branch_id'],
        ['expectedDate', 'expected_date'],
        ['noteToSupplier', 'note_to_supplier'],
        ['paymentTermDays', 'payment_term_days'],
        ['depositAmount', 'deposit_amount'],
      ];
      const sets = ['"version" = "version" + 1', '"updated_at" = now()'];
      const params: unknown[] = [tenantId, id];
      for (const [field, column] of columns) {
        if (dto[field] !== undefined) {
          params.push(dto[field]);
          sets.push(`"${column}" = $${params.length}`);
        }
      }
      await em.query(
        `UPDATE ${this.t('purchase_order')} SET ${sets.join(', ')} WHERE "tenant_id" = $1 AND "id" = $2`,
        params,
      );
      if (dto.items) {
        await this.setTotals(
          em,
          tenantId,
          id,
          await this.writeLines(em, tenantId, id, dto.items),
        );
      }
    });
    return this.get(id);
  }

  /**
   * submit / approve / cancel. Supplier debt follows the order: approving adds its total,
   * cancelling an approved order takes back what was not yet paid.
   */
  async act(
    id: string,
    action: PurchaseOrderAction,
    dto: PurchaseOrderActionReqDto,
  ): Promise<PurchaseOrderRes> {
    const tenantId = TenantContext.require();
    await this.dataSource.transaction(async (em) => {
      const row = await this.lock(em, tenantId, id, dto.version);
      const status = row.status as PurchaseOrderStatus;
      const to = nextStatus(action, status);
      if (!to) {
        throw badRequest(
          InventoryErrorCode.INVALID_TRANSITION,
          `A purchase order that is ${status} cannot be ${action === 'cancel' ? 'cancelled' : action === 'submit' ? 'submitted' : 'approved'}`,
        );
      }
      await em.query(
        `UPDATE ${this.t('purchase_order')} SET "status" = $3, "cancel_reason" = COALESCE($4, "cancel_reason"),
           "version" = "version" + 1, "updated_at" = now() WHERE "tenant_id" = $1 AND "id" = $2`,
        [tenantId, id, to, action === 'cancel' ? (dto.reason ?? null) : null],
      );
      const owed = num(row.total_amount) - num(row.paid_amount);
      if (action === 'approve') {
        await this.moveDebt(
          em,
          tenantId,
          row.supplier_id as string,
          num(row.total_amount),
        );
      } else if (action === 'cancel' && status === 'approved') {
        await this.moveDebt(em, tenantId, row.supplier_id as string, -owed);
      }
    });
    return this.get(id);
  }

  private moveDebt(
    em: EntityManager,
    tenantId: string,
    supplierId: string,
    delta: number,
  ) {
    return em.query(
      `UPDATE ${this.t('supplier')} SET "debt_balance" = "debt_balance" + $3, "updated_at" = now()
       WHERE "tenant_id" = $1 AND "id" = $2`,
      [tenantId, supplierId, delta],
    );
  }

  /** Records a payment: paid amount up, supplier debt down; never more than what remains (I013) */
  async pay(id: string, dto: CreatePaymentReqDto) {
    const tenantId = TenantContext.require();
    const paymentId = randomUUID();
    return this.dataSource.transaction(async (em) => {
      const row = await this.lock(em, tenantId, id);
      if (!PAYABLE_STATUSES.includes(row.status as PurchaseOrderStatus)) {
        throw badRequest(
          InventoryErrorCode.INVALID_TRANSITION,
          'Payments are recorded once the purchase order is approved',
        );
      }
      const remaining = num(row.total_amount) - num(row.paid_amount);
      if (dto.amount > remaining) {
        throw badRequest(
          InventoryErrorCode.PAYMENT_EXCEEDS_REMAINING,
          `The payment is more than the ${remaining} still owed`,
        );
      }
      const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
      await em.query(
        `INSERT INTO ${this.t('supplier_payment')} ("id","tenant_id","purchase_order_id","supplier_id","amount","method","paid_at","note")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          paymentId,
          tenantId,
          id,
          row.supplier_id,
          dto.amount,
          dto.method,
          paidAt,
          dto.note ?? null,
        ],
      );
      await em.query(
        `UPDATE ${this.t('purchase_order')} SET "paid_amount" = "paid_amount" + $3, "version" = "version" + 1, "updated_at" = now()
         WHERE "tenant_id" = $1 AND "id" = $2`,
        [tenantId, id, dto.amount],
      );
      await em.query(
        `UPDATE ${this.t('supplier')} SET "debt_balance" = "debt_balance" - $3, "total_paid" = "total_paid" + $3, "updated_at" = now()
         WHERE "tenant_id" = $1 AND "id" = $2`,
        [tenantId, row.supplier_id, dto.amount],
      );
      const paidAmount = num(row.paid_amount) + dto.amount;
      return {
        id: paymentId,
        amount: dto.amount,
        method: dto.method,
        paidAt: paidAt.toISOString(),
        note: dto.note ?? null,
        purchaseOrder: {
          paidAmount,
          remainingAmount: num(row.total_amount) - paidAmount,
        },
      };
    });
  }
}
