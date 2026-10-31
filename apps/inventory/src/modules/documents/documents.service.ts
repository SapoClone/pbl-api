import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { runInTenantTransaction } from '@pbl/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  InventoryDomainError,
  InventoryDomainErrorCode,
  InventoryDomainErrorCodeType,
  parseMoneyToVnd,
  vndToNumber,
} from '../../domain/inventory-domain';
import { IssuingService } from '../issuing/issuing.service';
import { ProcurementService } from '../procurement/procurement.service';
import { ReceivingService } from '../receiving/receiving.service';
import { csvCell, EXPORT_MAX_ROWS } from '../stock-views/stock-views.service';
import { StocktakeService } from '../stocktake/stocktake.service';
import { TransfersService } from '../transfers/transfers.service';
import { schemaPrefix } from '../warehouses/warehouses.service';
import {
  ListPurchaseOrdersQueryDto,
  ListSuppliersDirectoryQueryDto,
  PurchaseOrderFilterQueryDto,
  PurchaseOrderSummaryQueryDto,
} from './documents.dto';

const E = InventoryDomainErrorCode;

interface DocKind {
  table: string;
  label: string;
  notFound: InventoryDomainErrorCodeType;
  invalid: InventoryDomainErrorCodeType;
}
const KINDS = {
  receipt: {
    table: 'stock_receipt',
    label: 'Stock receipt',
    notFound: E.STOCK_RECEIPT_NOT_FOUND,
    invalid: E.STOCK_RECEIPT_INVALID_STATE,
  },
  issue: {
    table: 'stock_issue',
    label: 'Stock issue',
    notFound: E.STOCK_ISSUE_NOT_FOUND,
    invalid: E.STOCK_ISSUE_INVALID_STATE,
  },
  transfer: {
    table: 'stock_transfer',
    label: 'Stock transfer',
    notFound: E.TRANSFER_NOT_FOUND,
    invalid: E.TRANSFER_INVALID_STATE,
  },
  stocktake: {
    table: 'stock_take',
    label: 'Stock take',
    notFound: E.STOCKTAKE_NOT_FOUND,
    invalid: E.STOCKTAKE_INVALID_STATE,
  },
  purchaseOrder: {
    table: 'purchase_order',
    label: 'Purchase order',
    notFound: E.PURCHASE_ORDER_NOT_FOUND,
    invalid: E.PURCHASE_ORDER_INVALID_STATE,
  },
} as const satisfies Record<string, DocKind>;
type Kind = keyof typeof KINDS;

const OPEN_PO = `('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED')`;

/** `028 123 45 36` -> `028 ••• •• 36`: the first three and last two digits stay */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return phone;
  const total = phone.replace(/\D/g, '').length;
  let seen = 0;
  return phone.replace(/\d/g, (d) => {
    seen += 1;
    return seen <= 3 || seen > total - 2 ? d : '•';
  });
}

const num = (v: unknown): number => Number(v ?? 0);

/**
 * Status moves and screen views the contract asks for on top of their
 * documents: cancel, the receipt approval steps, supplier detail and delete,
 * and the purchasing list, summary and export.
 */
@Injectable()
export class DocumentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly receiving: ReceivingService,
    private readonly issuing: IssuingService,
    private readonly transfers: TransfersService,
    private readonly stocktake: StocktakeService,
    private readonly procurement: ProcurementService,
  ) {}

  /**
   * One guarded status change: the row moves only from a status in `from`
   * (404 when it does not exist, 409 otherwise).
   */
  private async move(
    em: EntityManager,
    tenantId: string,
    kind: Kind,
    id: string,
    from: string[],
    to: string,
    extraSet = '',
    extraParams: unknown[] = [],
    extraWhere = '',
  ): Promise<void> {
    const k: DocKind = KINDS[kind];
    const prefix = schemaPrefix(em);
    const rows = await em.query(
      `UPDATE ${prefix}"${k.table}" SET status = $3, ${extraSet} updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = ANY($4::text[]) ${extraWhere}
       RETURNING id`,
      [tenantId, id, to, from, ...extraParams],
    );
    // the postgres driver answers UPDATE ... RETURNING as [rows, affected]
    if ((Array.isArray(rows[0]) ? rows[0] : rows).length > 0) return;
    const cur = await em.query(
      `SELECT status FROM ${prefix}"${k.table}" WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (cur.length === 0) {
      throw new InventoryDomainError(
        k.notFound,
        `${k.label} ${id} not found`,
        404,
      );
    }
    throw new InventoryDomainError(
      k.invalid,
      `${k.label} in state ${cur[0].status} cannot become ${to}`,
      409,
    );
  }

  // ---- stock receipt approval steps

  async submitReceipt(id: string) {
    await runInTenantTransaction(this.dataSource, (em, t) =>
      this.move(em, t, 'receipt', id, ['DRAFT'], 'PENDING_APPROVAL'),
    );
    return this.receiving.getReceiptById(id);
  }

  async approveReceipt(id: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const rows = await em.query(
        `SELECT status FROM ${schemaPrefix(em)}"stock_receipt"
         WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      if (rows.length === 0) {
        throw new InventoryDomainError(
          E.STOCK_RECEIPT_NOT_FOUND,
          `Stock receipt ${id} not found`,
          404,
        );
      }
      if (rows[0].status !== 'PENDING_APPROVAL') {
        throw new InventoryDomainError(
          E.STOCK_RECEIPT_INVALID_STATE,
          `Only a PENDING_APPROVAL receipt can be approved (it is ${rows[0].status})`,
          409,
        );
      }
      return this.receiving.postReceiptInTx(em, tenantId, id);
    });
  }

  async rejectReceipt(id: string, reason?: string) {
    await runInTenantTransaction(this.dataSource, (em, t) =>
      this.move(
        em,
        t,
        'receipt',
        id,
        ['PENDING_APPROVAL'],
        'DRAFT',
        'reject_reason = $5,',
        [reason ?? null],
      ),
    );
    return this.receiving.getReceiptById(id);
  }

  async cancelReceipt(id: string) {
    await runInTenantTransaction(this.dataSource, (em, t) =>
      this.move(
        em,
        t,
        'receipt',
        id,
        ['DRAFT', 'PENDING_APPROVAL'],
        'CANCELLED',
      ),
    );
    return this.receiving.getReceiptById(id);
  }

  // ---- cancel

  async cancelIssue(id: string) {
    await runInTenantTransaction(this.dataSource, (em, t) =>
      this.move(em, t, 'issue', id, ['DRAFT'], 'CANCELLED'),
    );
    return this.issuing.getIssueById(id);
  }

  /** Only a draft: cancelling goods in transit (returning them) is not built */
  async cancelTransfer(id: string) {
    await runInTenantTransaction(this.dataSource, (em, t) =>
      this.move(em, t, 'transfer', id, ['DRAFT'], 'CANCELLED'),
    );
    return this.transfers.getTransferById(id);
  }

  async cancelStocktake(id: string) {
    await runInTenantTransaction(this.dataSource, (em, t) =>
      this.move(em, t, 'stocktake', id, ['DRAFT', 'COUNTING'], 'CANCELLED'),
    );
    return this.stocktake.getById(id);
  }

  /** Before any quantity is received */
  async cancelPurchaseOrder(id: string, reason?: string) {
    await runInTenantTransaction(this.dataSource, (em, t) =>
      this.move(
        em,
        t,
        'purchaseOrder',
        id,
        ['DRAFT', 'APPROVED'],
        'CANCELLED',
        "note = CASE WHEN $5::text IS NULL THEN note ELSE COALESCE(note || E'\\n', '') || $5::text END,",
        [reason ? `Cancelled: ${reason}` : null],
        `AND NOT EXISTS (SELECT 1 FROM ${schemaPrefix(em)}"purchase_order_item" i
           WHERE i.tenant_id = $1 AND i.purchase_order_id = $2 AND i.received_qty > 0)`,
      ),
    );
    return this.procurement.getPurchaseOrderById(id);
  }

  // ---- suppliers

  private supplierStats(prefix: string): string {
    // debt = value of goods received on the supplier's POs: no payment is recorded yet
    return `
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE po.status IN ${OPEN_PO})::int AS open_count,
               COALESCE(SUM(v.received_value), 0) AS debt
        FROM ${prefix}"purchase_order" po
        LEFT JOIN LATERAL (
          SELECT SUM(ROUND(i.received_qty * i.unit_cost)) AS received_value
          FROM ${prefix}"purchase_order_item" i
          WHERE i.tenant_id = po.tenant_id AND i.purchase_order_id = po.id
        ) v ON true
        WHERE po.tenant_id = s.tenant_id AND po.supplier_id = s.id
          AND po.status <> 'CANCELLED'
      ) st ON true`;
  }

  async supplierDetail(id: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const rows = await em.query(
        `SELECT s.id, s.code, s.name, s.phone, s.email, s.address, s.tax_code,
                s.note, s.created_at, st.open_count, st.debt
         FROM ${prefix}"supplier" s ${this.supplierStats(prefix)}
         WHERE s.tenant_id = $1 AND s.id = $2 AND s.deleted_at IS NULL`,
        [tenantId, id],
      );
      if (rows.length === 0) {
        throw new InventoryDomainError(
          E.SUPPLIER_NOT_FOUND,
          `Supplier ${id} not found`,
          404,
        );
      }
      const r = rows[0];
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        phone: r.phone,
        email: r.email,
        address: r.address,
        taxCode: r.tax_code,
        note: r.note,
        openPurchaseOrderCount: Number(r.open_count),
        totalPaid: 0,
        debtBalance: vndToNumber(parseMoneyToVnd(String(r.debt))),
        createdAt: r.created_at,
      };
    });
  }

  async suppliersDirectory(query: ListSuppliersDirectoryQueryDto) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const params: unknown[] = [tenantId];
      let where = '';
      if (query.q?.trim()) {
        params.push(`%${query.q.trim().replace(/[\\%_]/g, '\\$&')}%`);
        const n = params.length;
        where = `AND (s.name ILIKE $${n} ESCAPE '\\' OR s.code ILIKE $${n} ESCAPE '\\' OR s.phone ILIKE $${n} ESCAPE '\\')`;
      }
      const count = await em.query(
        `SELECT COUNT(*)::int AS total FROM ${prefix}"supplier" s
         WHERE s.tenant_id = $1 AND s.deleted_at IS NULL ${where}`,
        params,
      );
      const totalRecords = Number(count[0]?.total ?? 0);
      const { limit, page } = query;
      const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
      const rows = await em.query(
        `SELECT s.id, s.code, s.name, s.phone, st.open_count, st.debt
         FROM ${prefix}"supplier" s ${this.supplierStats(prefix)}
         WHERE s.tenant_id = $1 AND s.deleted_at IS NULL ${where}
         ORDER BY s.code ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit],
      );
      return {
        data: rows.map((r: Record<string, unknown>) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          phone: maskPhone(r.phone as string | null),
          openPurchaseOrderCount: Number(r.open_count),
          debtBalance: vndToNumber(parseMoneyToVnd(String(r.debt))),
        })),
        pagination: {
          limit,
          currentPage: page,
          ...(page < totalPages ? { nextPage: page + 1 } : {}),
          totalRecords,
          totalPages,
        },
      };
    });
  }

  /** Soft delete; 400 while the supplier has open POs or an unpaid balance */
  async deleteSupplier(id: string): Promise<void> {
    await runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const lock = await em.query(
        `SELECT s.id FROM ${prefix}"supplier" s
         WHERE s.tenant_id = $1 AND s.id = $2 AND s.deleted_at IS NULL
         FOR UPDATE`,
        [tenantId, id],
      );
      if (lock.length === 0) {
        throw new InventoryDomainError(
          E.SUPPLIER_NOT_FOUND,
          `Supplier ${id} not found`,
          404,
        );
      }
      const [st] = await em.query(
        `SELECT st.open_count, st.debt FROM ${prefix}"supplier" s
         ${this.supplierStats(prefix)} WHERE s.tenant_id = $1 AND s.id = $2`,
        [tenantId, id],
      );
      if (Number(st.open_count) > 0 || Number(st.debt) > 0) {
        throw new InventoryDomainError(
          E.SUPPLIER_IN_USE,
          'The supplier still has open purchase orders or a balance owed',
          400,
        );
      }
      await em.query(
        `UPDATE ${prefix}"supplier"
         SET deleted_at = now(), status = 'INACTIVE', updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
    });
  }

  // ---- purchase orders: list, summary, export

  private poFrom(
    prefix: string,
    tenantId: string,
    branches: string[] | null,
    f: {
      q?: string;
      status?: string;
      supplierId?: string;
      branchId?: string;
      from?: string;
      to?: string;
    },
  ) {
    const params: unknown[] = [tenantId];
    const conds: string[] = [];
    const add = (sql: (n: number) => string, v: unknown) => {
      params.push(v);
      conds.push(sql(params.length));
    };
    if (f.branchId) add((n) => `w.branch_id = $${n}`, f.branchId);
    if (branches) add((n) => `w.branch_id = ANY($${n}::uuid[])`, branches);
    if (f.supplierId) add((n) => `po.supplier_id = $${n}`, f.supplierId);
    if (f.status) add((n) => `po.status = upper($${n})`, f.status);
    if (f.q?.trim()) {
      add(
        (n) =>
          `(po.code ILIKE $${n} ESCAPE '\\' OR s.name ILIKE $${n} ESCAPE '\\')`,
        `%${f.q.trim().replace(/[\\%_]/g, '\\$&')}%`,
      );
    }
    if (f.from) add((n) => `po.created_at >= $${n}::timestamptz`, f.from);
    if (f.to) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(f.to)) {
        add((n) => `po.created_at < ($${n}::date + 1)::timestamptz`, f.to);
      } else {
        add((n) => `po.created_at <= $${n}::timestamptz`, f.to);
      }
    }
    const sql = `
      FROM ${prefix}"purchase_order" po
      JOIN ${prefix}"warehouse" w
        ON w.tenant_id = po.tenant_id AND w.id = po.warehouse_id
      JOIN ${prefix}"supplier" s
        ON s.tenant_id = po.tenant_id AND s.id = po.supplier_id
      LEFT JOIN LATERAL (
        SELECT SUM(i.ordered_qty) AS ordered, SUM(i.received_qty) AS received,
               SUM(ROUND(i.received_qty * i.unit_cost)) AS received_value
        FROM ${prefix}"purchase_order_item" i
        WHERE i.tenant_id = po.tenant_id AND i.purchase_order_id = po.id
      ) q ON true
      WHERE po.tenant_id = $1 ${conds.map((c) => `AND ${c}`).join(' ')}`;
    return { sql, params };
  }

  private poOrder(f: PurchaseOrderFilterQueryDto): string {
    const col =
      f.sort === 'expectedDate'
        ? 'po.expected_date'
        : f.sort === 'totalAmount'
          ? 'po.total_amount'
          : 'po.created_at';
    return `ORDER BY ${col} ${f.order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, po.id ASC`;
  }

  private poRow(r: Record<string, unknown>) {
    const total = vndToNumber(parseMoneyToVnd(String(r.total_amount)));
    return {
      id: r.id,
      code: r.code,
      createdAt: r.created_at,
      supplier: { id: r.supplier_id, name: r.supplier_name },
      branchId: r.branch_id ?? null,
      quantityOrdered: num(r.ordered),
      quantityReceived: num(r.received),
      totalAmount: total,
      // no payment is recorded yet, so the whole total is still owed
      remainingAmount: total,
      status: String(r.status).toLowerCase(),
      expectedDate: r.expected_date ?? null,
    };
  }

  private static readonly PO_COLUMNS = `
    po.id, po.code, po.created_at, po.supplier_id, s.name AS supplier_name,
    w.branch_id, po.status, po.total_amount,
    to_char(po.expected_date, 'YYYY-MM-DD') AS expected_date,
    q.ordered, q.received`;

  async purchaseOrdersDirectory(
    query: ListPurchaseOrdersQueryDto,
    branches: string[] | null,
  ) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const b = this.poFrom(schemaPrefix(em), tenantId, branches, query);
      const count = await em.query(
        `SELECT COUNT(*)::int AS total ${b.sql}`,
        b.params,
      );
      const totalRecords = Number(count[0]?.total ?? 0);
      const { limit, page } = query;
      const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
      const rows = await em.query(
        `SELECT ${DocumentsService.PO_COLUMNS} ${b.sql} ${this.poOrder(query)}
         LIMIT $${b.params.length + 1} OFFSET $${b.params.length + 2}`,
        [...b.params, limit, (page - 1) * limit],
      );
      return {
        data: rows.map((r: Record<string, unknown>) => this.poRow(r)),
        pagination: {
          limit,
          currentPage: page,
          ...(page < totalPages ? { nextPage: page + 1 } : {}),
          totalRecords,
          totalPages,
        },
      };
    });
  }

  async purchaseOrdersSummary(
    query: PurchaseOrderSummaryQueryDto,
    branches: string[] | null,
  ) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const b = this.poFrom(schemaPrefix(em), tenantId, branches, query);
      const [r] = await em.query(
        `SELECT
           COUNT(*) FILTER (WHERE po.status IN ${OPEN_PO})::int AS open_count,
           COUNT(*) FILTER (WHERE po.status = 'PARTIALLY_RECEIVED')::int AS partial,
           COUNT(*) FILTER (WHERE po.status = 'APPROVED')::int AS awaiting,
           COUNT(*) FILTER (WHERE po.status IN ('APPROVED', 'PARTIALLY_RECEIVED')
             AND po.expected_date >= current_date
             AND po.expected_date < current_date + 7)::int AS due_week,
           COALESCE(SUM(q.received_value) FILTER (WHERE po.status <> 'CANCELLED'), 0) AS payable
         ${b.sql}`,
        b.params,
      );
      return {
        openCount: Number(r.open_count),
        partiallyReceivedCount: Number(r.partial),
        awaitingDeliveryCount: Number(r.awaiting),
        dueThisWeekCount: Number(r.due_week),
        // goods received so far; payments are not recorded yet
        payableAmount: vndToNumber(parseMoneyToVnd(String(r.payable))),
      };
    });
  }

  async purchaseOrdersCsv(
    query: PurchaseOrderFilterQueryDto,
    branches: string[] | null,
  ): Promise<string> {
    const rows = await runInTenantTransaction(
      this.dataSource,
      async (em, tenantId) => {
        const b = this.poFrom(schemaPrefix(em), tenantId, branches, query);
        return em.query(
          `SELECT ${DocumentsService.PO_COLUMNS} ${b.sql} ${this.poOrder(query)}
           LIMIT ${EXPORT_MAX_ROWS + 1}`,
          b.params,
        );
      },
    );
    if (rows.length > EXPORT_MAX_ROWS) {
      throw new InventoryDomainError(
        E.EXPORT_TOO_LARGE,
        `The export holds more than ${EXPORT_MAX_ROWS} rows: narrow the filters`,
        400,
      );
    }
    const lines = [
      [
        'code',
        'createdAt',
        'supplier',
        'branchId',
        'quantityOrdered',
        'quantityReceived',
        'totalAmount',
        'remainingAmount',
        'status',
        'expectedDate',
      ]
        .map(csvCell)
        .join(','),
    ];
    for (const r of rows as Record<string, unknown>[]) {
      const x = this.poRow(r);
      lines.push(
        [
          x.code,
          new Date(x.createdAt as string).toISOString(),
          x.supplier.name,
          x.branchId,
          x.quantityOrdered,
          x.quantityReceived,
          x.totalAmount,
          x.remainingAmount,
          x.status,
          x.expectedDate,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }
}
