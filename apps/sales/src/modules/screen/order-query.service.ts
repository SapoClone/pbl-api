import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { toMoney } from '../../common/money';
import {
  STORED_ORDER_STATUS,
  allowedActionsOf,
  channelTypeSql,
  csvCell,
  effectiveAmounts,
  sourceOf,
  toScreenFulfillmentStatus,
  toScreenMethod,
  toScreenOrderStatus,
  toScreenPaymentStatus,
} from '../../common/order-views';
import { inTenantTx } from '../../common/tenant-tx';
import {
  SalesDomainError,
  SalesDomainErrorCode,
} from '../../domain/sales-domain';
import { getSchemaPrefix } from '../../infrastructure/persistence/sales-code.generator';
import {
  ListOrdersReqDto,
  OrderSummaryQueryDto,
  PrintOrderQueryDto,
} from '../../orders/dto/list-orders.req.dto';
import {
  BranchScope,
  branchAllowed,
  branchFilter,
} from '../../presentation/access';
import { ensureChannelsSeeded } from '../reference/reference.service';

export const EXPORT_MAX_ROWS = 10_000;

/** Spreadsheets read a CSV as UTF-8 only with this mark first */
const UTF8_BOM = String.fromCharCode(0xfeff);

/** UTC+7, the zone the screens and insight count days in */
const ICT_OFFSET = '+07:00';
const DAY_MS = 24 * 60 * 60 * 1000;

/** `2026-10-20` is a day in UTC+7; a datetime is taken as given */
export function parseRange(
  from?: string,
  to?: string,
): { from?: Date; to?: Date } {
  const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const start = from
    ? new Date(isDay(from) ? `${from}T00:00:00${ICT_OFFSET}` : from)
    : undefined;
  let end: Date | undefined;
  if (to) {
    end = isDay(to)
      ? new Date(new Date(`${to}T00:00:00${ICT_OFFSET}`).getTime() + DAY_MS)
      : new Date(to);
  }
  return { from: start, to: end };
}

/** Start of today in UTC+7 and of tomorrow */
export function todayRange(now = new Date()): { from: Date; to: Date } {
  const ict = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const day = ict.toISOString().slice(0, 10);
  const from = new Date(`${day}T00:00:00${ICT_OFFSET}`);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

const FULFILLMENT_SQL: Record<string, string> = {
  unfulfilled: `(o.fulfillment_stage IS NULL AND o.fulfillment_status IN ('UNFULFILLED', 'RESERVED'))`,
  packing: `(o.fulfillment_stage = 'PACKING' AND o.fulfillment_status NOT IN ('FULFILLED', 'RETURNED', 'PARTIALLY_FULFILLED'))`,
  shipping: `((o.fulfillment_stage = 'SHIPPING' OR o.fulfillment_status = 'PARTIALLY_FULFILLED') AND o.fulfillment_status NOT IN ('FULFILLED', 'RETURNED'))`,
  delivered: `o.fulfillment_status = 'FULFILLED'`,
  returned: `o.fulfillment_status = 'RETURNED'`,
};

const PAYMENT_SQL: Record<string, string> = {
  unpaid: `o.payment_status = 'UNPAID'`,
  partially_paid: `o.payment_status = 'PARTIALLY_PAID'`,
  paid: `o.payment_status IN ('PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED')`,
  refunded: `o.payment_status = 'REFUNDED'`,
  // not derived: needs the finance reconciliation
  unreconciled: `FALSE`,
};

const TAB_SQL: Record<string, string> = {
  all: `o.order_status <> 'DRAFT'`,
  new: `o.order_status = 'PENDING'`,
  confirmed: `(o.order_status = 'CONFIRMED' AND ${FULFILLMENT_SQL.unfulfilled})`,
  packing: `(o.order_status = 'CONFIRMED' AND ${FULFILLMENT_SQL.packing})`,
  shipping: `(o.order_status = 'CONFIRMED' AND ${FULFILLMENT_SQL.shipping})`,
  completed: `o.order_status = 'COMPLETED'`,
  needs_action: `(o.exception_code IS NOT NULL AND o.order_status NOT IN ('COMPLETED', 'CANCELLED'))`,
  processing: `(o.order_status = 'CONFIRMED' AND o.fulfillment_status <> 'FULFILLED')`,
};

const SORT_SQL: Record<string, string> = {
  createdAt: 'o.created_at',
  totalAmount: 'o.total_amount',
};

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface OrderListRow {
  id: string;
  code: string;
  branchId: string;
  status: string;
  paymentMethod: string;
  customerName: string | null;
  totalAmount: number;
  itemCount: number;
  createdBy: string;
  createdAt: string;
  items: never[];
  externalOrderCode: string | null;
  customer: {
    id: string | null;
    name: string | null;
    phoneMasked: null;
  } | null;
  channel: { id: string | null; type: string; name: string };
  orderStatus: string;
  fulfillmentStatus: string;
  paymentStatus: string;
  exceptionCode: string | null;
}

type Row = Record<string, any>;

@Injectable()
export class OrderQueryService {
  constructor(private readonly dataSource: DataSource) {}

  /** The FROM clause with both channel joins (the order's own row, else the seeded row of its type) */
  private from(prefix: string): string {
    return `${prefix}"orders" o
      LEFT JOIN ${prefix}"sales_channels" ch ON ch.tenant_id = o.tenant_id AND ch.id = o.channel_id
      LEFT JOIN ${prefix}"sales_channels" chd ON chd.tenant_id = o.tenant_id
        AND chd.connection_id IS NULL AND chd.type = ${channelTypeSql('o', 'ch')}`;
  }

  /** WHERE conditions of the list filters; `params[0]` is the tenant */
  private conditions(
    query: ListOrdersReqDto,
    scope: BranchScope,
    params: unknown[],
  ): string[] | null {
    const where: string[] = ['o.tenant_id = $1'];
    const add = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const branchIds = branchFilter(
      scope,
      query.branchId,
      'ORDER_NOT_FOUND',
      'Branch not found',
    );
    if (branchIds) {
      if (branchIds.length === 0) return null;
      where.push(`o.branch_id = ANY(${add(branchIds)}::uuid[])`);
    }
    if (query.q) {
      const p = add(likePattern(query.q));
      where.push(
        `(o.code ILIKE ${p} OR o.external_order_id ILIKE ${p} OR o.customer_name ILIKE ${p})`,
      );
    }
    if (query.tab) where.push(TAB_SQL[query.tab]);
    if (query.orderStatus?.length) {
      where.push(
        `o.order_status = ANY(${add(query.orderStatus.map((s) => STORED_ORDER_STATUS[s]))}::text[])`,
      );
    }
    if (query.paymentStatus?.length) {
      where.push(
        `(${query.paymentStatus.map((s) => PAYMENT_SQL[s]).join(' OR ')})`,
      );
    }
    if (query.fulfillmentStatus?.length) {
      where.push(
        `(${query.fulfillmentStatus.map((s) => FULFILLMENT_SQL[s]).join(' OR ')})`,
      );
    }
    if (query.channel?.length) {
      where.push(
        `${channelTypeSql('o', 'ch')} = ANY(${add(query.channel.map((c) => c.toLowerCase()))}::text[])`,
      );
    }
    if (query.customerId)
      where.push(`o.customer_id = ${add(query.customerId)}`);
    if (query.registerId) {
      where.push(
        `o.shift_id IN (SELECT s.id FROM ${'__PREFIX__'}"pos_shifts" s WHERE s.tenant_id = o.tenant_id AND s.register_id = ${add(query.registerId)})`,
      );
    }
    const range = parseRange(query.from, query.to);
    if (range.from) where.push(`o.created_at >= ${add(range.from)}`);
    if (range.to) where.push(`o.created_at < ${add(range.to)}`);
    return where;
  }

  private channelOf(row: Row) {
    const type = (row.ch_type ?? row.chd_type ?? derivedType(row)) as string;
    return {
      id: (row.channel_id ?? row.chd_id ?? null) as string | null,
      type,
      name: (row.ch_name ?? row.chd_name ?? type) as string,
    };
  }

  private listRow(row: Row): OrderListRow {
    const amounts = effectiveAmounts({
      totalAmount: toMoney(row.total_amount),
      grandTotal: toMoney(row.grand_total ?? 0),
    });
    return {
      id: row.id,
      code: row.code,
      branchId: row.branch_id,
      status: row.status,
      paymentMethod: row.payment_method,
      customerName: row.customer_name ?? null,
      totalAmount: amounts.totalAmount,
      itemCount: Number(row.item_count),
      createdBy: row.created_by,
      createdAt: new Date(row.created_at).toISOString(),
      items: [],
      externalOrderCode: row.external_order_id ?? null,
      customer:
        row.customer_id || row.customer_name
          ? {
              id: row.customer_id ?? null,
              name: row.customer_name ?? null,
              phoneMasked: null,
            }
          : null,
      channel: this.channelOf(row),
      orderStatus: toScreenOrderStatus(row.order_status),
      fulfillmentStatus: toScreenFulfillmentStatus(
        row.fulfillment_status,
        row.fulfillment_stage,
      ),
      paymentStatus: toScreenPaymentStatus(row.payment_status),
      exceptionCode: row.exception_code ?? null,
    };
  }

  private async select(
    em: EntityManager,
    tenantId: string,
    query: ListOrdersReqDto,
    scope: BranchScope,
    paging: { limit: number; offset: number } | null,
  ): Promise<{ rows: Row[]; total: number }> {
    const prefix = getSchemaPrefix(em);
    const params: unknown[] = [tenantId];
    const where = this.conditions(query, scope, params);
    if (where === null) return { rows: [], total: 0 };
    const whereSql = where.join(' AND ').replace(/__PREFIX__/g, prefix);
    const from = this.from(prefix);
    const count = await em.query(
      `SELECT COUNT(*)::int AS total FROM ${from} WHERE ${whereSql}`,
      params,
    );
    const total = Number(count[0]?.total ?? 0);
    const sort = SORT_SQL[query.sort ?? 'createdAt'];
    const dir = query.order === 'asc' ? 'ASC' : 'DESC';
    const limit = paging ? paging.limit : EXPORT_MAX_ROWS;
    const offset = paging ? paging.offset : 0;
    const rows = await em.query(
      `SELECT o.*, ch.type AS ch_type, ch.name AS ch_name, chd.id AS chd_id, chd.type AS chd_type, chd.name AS chd_name
       FROM ${from} WHERE ${whereSql}
       ORDER BY ${sort} ${dir}, o.id ${dir}
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params,
    );
    return { rows, total };
  }

  async list(query: ListOrdersReqDto, scope: BranchScope) {
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      await ensureChannelsSeeded(em, tenantId);
      const { rows, total } = await this.select(em, tenantId, query, scope, {
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      });
      const totalPages = Math.max(1, Math.ceil(total / query.limit));
      return {
        data: rows.map((r) => this.listRow(r)),
        pagination: {
          limit: query.limit,
          currentPage: query.page,
          ...(query.page < totalPages ? { nextPage: query.page + 1 } : {}),
          totalRecords: total,
          totalPages,
        },
      };
    });
  }

  /** `text/csv` body (UTF-8 BOM first) of the filtered list, at most 10,000 rows */
  async exportCsv(
    query: ListOrdersReqDto,
    scope: BranchScope,
  ): Promise<string> {
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      await ensureChannelsSeeded(em, tenantId);
      const { rows, total } = await this.select(
        em,
        tenantId,
        query,
        scope,
        null,
      );
      if (total > EXPORT_MAX_ROWS) {
        throw new SalesDomainError(
          SalesDomainErrorCode.EXPORT_TOO_LARGE,
          `More than ${EXPORT_MAX_ROWS} orders match: narrow the date range`,
          422,
          { total, max: EXPORT_MAX_ROWS },
        );
      }
      const header = [
        'code',
        'externalOrderCode',
        'createdAt',
        'branchId',
        'customerName',
        'channel',
        'orderStatus',
        'fulfillmentStatus',
        'paymentStatus',
        'itemCount',
        'totalAmount',
      ];
      const lines = rows.map((r) => {
        const o = this.listRow(r);
        return [
          o.code,
          o.externalOrderCode,
          o.createdAt,
          o.branchId,
          o.customerName,
          o.channel.type,
          o.orderStatus,
          o.fulfillmentStatus,
          o.paymentStatus,
          o.itemCount,
          o.totalAmount,
        ]
          .map(csvCell)
          .join(',');
      });
      return `${UTF8_BOM}${[header.join(','), ...lines].join('\r\n')}\r\n`;
    });
  }

  async summary(query: OrderSummaryQueryDto, scope: BranchScope) {
    const branchIds = branchFilter(
      scope,
      query.branchId,
      'ORDER_NOT_FOUND',
      'Branch not found',
    );
    const range = parseRange(query.from, query.to);
    const today = todayRange();
    const from = range.from ?? today.from;
    const to =
      range.to ??
      (range.from ? new Date(range.from.getTime() + DAY_MS) : today.to);
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      await ensureChannelsSeeded(em, tenantId);
      const prefix = getSchemaPrefix(em);
      const params: unknown[] = [tenantId];
      let branchSql = '';
      if (branchIds) {
        if (branchIds.length === 0) return emptySummary();
        params.push(branchIds);
        branchSql = `AND o.branch_id = ANY($2::uuid[])`;
      }
      params.push(from, to);
      const fromParam = `$${params.length - 1}`;
      const toParam = `$${params.length}`;
      const inRange = `o.created_at >= ${fromParam} AND o.created_at < ${toParam}`;
      const counts = await em.query(
        `SELECT
           COUNT(*) FILTER (WHERE ${inRange} AND ${TAB_SQL.all})::int AS t_all,
           COUNT(*) FILTER (WHERE ${inRange} AND ${TAB_SQL.new})::int AS t_new,
           COUNT(*) FILTER (WHERE ${inRange} AND ${TAB_SQL.confirmed})::int AS t_confirmed,
           COUNT(*) FILTER (WHERE ${inRange} AND ${TAB_SQL.packing})::int AS t_packing,
           COUNT(*) FILTER (WHERE ${inRange} AND ${TAB_SQL.shipping})::int AS t_shipping,
           COUNT(*) FILTER (WHERE ${inRange} AND ${TAB_SQL.completed})::int AS t_completed,
           COUNT(*) FILTER (WHERE ${inRange} AND ${TAB_SQL.needs_action})::int AS t_needs_action,
           COUNT(*) FILTER (WHERE ${TAB_SQL.new})::int AS awaiting,
           COUNT(*) FILTER (WHERE ${TAB_SQL.packing})::int AS packing,
           COUNT(*) FILTER (WHERE ${TAB_SQL.shipping})::int AS shipping,
           COUNT(*) FILTER (WHERE ${TAB_SQL.needs_action})::int AS needs_action,
           COUNT(*) FILTER (WHERE ${TAB_SQL.needs_action} AND o.exception_code = 'sku_unmapped')::int AS sku_unmapped,
           COUNT(*) FILTER (WHERE ${TAB_SQL.needs_action} AND o.exception_code = 'stock_shortage')::int AS stock_shortage
         FROM ${prefix}"orders" o
         WHERE o.tenant_id = $1 ${branchSql}`,
        params,
      );
      const c = counts[0] as Row;
      const latest = await em.query(
        `SELECT o.id, o.code, o.exception_code, ch.name AS ch_name, chd.name AS chd_name, o.channel_type
         FROM ${this.from(prefix)}
         WHERE o.tenant_id = $1 ${branchSql} AND ${TAB_SQL.needs_action}
         ORDER BY o.updated_at DESC, o.id DESC LIMIT 1`,
        params.slice(0, branchIds ? 2 : 1),
      );
      const l = latest[0] as Row | undefined;
      return {
        today: { total: c.t_all, completed: c.t_completed },
        awaitingConfirmation: c.awaiting,
        inFulfillment: { packing: c.packing, shipping: c.shipping },
        needsAction: {
          total: c.needs_action,
          skuUnmapped: c.sku_unmapped,
          stockShortage: c.stock_shortage,
        },
        tabCounts: {
          all: c.t_all,
          new: c.t_new,
          confirmed: c.t_confirmed,
          packing: c.t_packing,
          shipping: c.t_shipping,
          completed: c.t_completed,
          needsAction: c.t_needs_action,
        },
        latestException: l
          ? {
              orderId: l.id,
              code: l.code,
              exceptionCode: l.exception_code,
              externalSku: null,
              channelName: l.ch_name ?? l.chd_name ?? null,
            }
          : null,
      };
    });
  }

  /** The order of the screen contract; `null` for a missing one or one outside the branch scope */
  async detail(id: string, scope: BranchScope) {
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      const prefix = getSchemaPrefix(em);
      const rows = await em.query(
        `SELECT o.*, ch.type AS ch_type, ch.name AS ch_name, ch.environment AS ch_env,
                chd.id AS chd_id, chd.type AS chd_type, chd.name AS chd_name,
                b.name AS branch_name
         FROM ${this.from(prefix)}
         LEFT JOIN ${prefix}"branch_projection" b ON b.tenant_id = o.tenant_id AND b.branch_id = o.branch_id
         WHERE o.tenant_id = $1 AND o.id = $2`,
        [tenantId, id],
      );
      const o = rows[0] as Row | undefined;
      if (!o || !branchAllowed(scope, o.branch_id)) return null;

      const items = await em.query(
        `SELECT * FROM ${prefix}"order_items" WHERE tenant_id = $1 AND order_id = $2 ORDER BY id ASC`,
        [tenantId, id],
      );
      const tenders = await em.query(
        `SELECT * FROM ${prefix}"order_tenders" WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at ASC`,
        [tenantId, id],
      );
      const fulfillments = await em.query(
        `SELECT * FROM ${prefix}"order_fulfillments" WHERE tenant_id = $1 AND order_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, id],
      );
      return this.detailView(o, items, tenders, fulfillments[0]);
    });
  }

  private detailView(o: Row, items: Row[], tenders: Row[], fulfillment?: Row) {
    const amounts = effectiveAmounts({
      totalAmount: toMoney(o.total_amount),
      grandTotal: toMoney(o.grand_total ?? 0),
      subtotal: toMoney(o.subtotal ?? 0),
      paidAmount: toMoney(o.paid_amount ?? 0),
      paymentStatus: o.payment_status,
    });
    const discount =
      toMoney(o.item_discount_total ?? 0) +
      toMoney(o.order_discount_total ?? 0) +
      toMoney(o.promotion_discount_total ?? 0);
    const paymentStatus = toScreenPaymentStatus(o.payment_status);
    const closed =
      o.order_status === 'CANCELLED' || paymentStatus === 'refunded';
    const dueAmount = closed
      ? 0
      : Math.max(0, amounts.totalAmount - amounts.paidAmount);
    const payments = tenders.map((t) => ({
      id: t.id,
      method: toScreenMethod(t.method),
      amount: t.kind === 'REFUND' ? -toMoney(t.amount) : toMoney(t.amount),
      status:
        t.status === 'CONFIRMED'
          ? 'paid'
          : t.status === 'FAILED'
            ? 'failed'
            : 'pending',
      paidAt: new Date(
        t.paid_at ?? t.confirmed_at ?? t.created_at,
      ).toISOString(),
    }));
    const changeAmount = tenders
      .filter((t) => t.kind !== 'REFUND')
      .reduce((sum, t) => sum + toMoney(t.change_due ?? 0), 0);
    const channel = this.channelOf(o);
    return {
      id: o.id,
      code: o.code,
      branchId: o.branch_id,
      status: o.status,
      paymentMethod: o.payment_method,
      customerName: o.customer_name ?? null,
      totalAmount: amounts.totalAmount,
      itemCount: Number(o.item_count),
      createdBy: o.created_by,
      createdAt: new Date(o.created_at).toISOString(),
      externalOrderCode: o.external_order_id ?? null,
      version: Number(o.version ?? 1),
      source: sourceOf(o.channel_type),
      branch: { id: o.branch_id, name: o.branch_name ?? null },
      channel: { ...channel, environment: o.ch_env ?? null },
      orderStatus: toScreenOrderStatus(o.order_status),
      fulfillmentStatus: toScreenFulfillmentStatus(
        o.fulfillment_status,
        o.fulfillment_stage,
      ),
      paymentStatus,
      exceptionCode: o.exception_code ?? null,
      items: items.map((i) => ({
        // existing keys
        sku: i.sku,
        name: i.name,
        quantity: Number(i.quantity),
        unitPrice: toMoney(i.unit_price),
        lineTotal: toMoney(i.line_total),
        // screen contract
        id: i.id,
        variantId: i.variant_id ?? null,
        skuCode: i.sku,
        productName: i.name,
        variantName: i.variant_label ?? null,
        discountAmount:
          toMoney(i.item_discount_amount ?? 0) +
          toMoney(i.allocated_order_discount ?? 0),
      })),
      subtotal: amounts.subtotal,
      discountAmount: discount,
      shippingFee: toMoney(o.shipping_fee ?? 0),
      taxAmount: toMoney(o.tax_total ?? 0),
      paidAmount: amounts.paidAmount,
      dueAmount,
      changeAmount,
      customer:
        o.customer_id || o.customer_name
          ? {
              id: o.customer_id ?? null,
              name: o.customer_name ?? null,
              phoneMasked: null,
              groupName: null,
            }
          : null,
      shipping: fulfillment
        ? {
            method: 'delivery',
            addressText: null,
            providerName: fulfillment.carrier_code ?? null,
            trackingCode: fulfillment.tracking_number ?? null,
            status: String(fulfillment.status).toLowerCase(),
          }
        : null,
      payments,
      note: o.note ?? null,
      receivedAt: new Date(o.created_at).toISOString(),
      allowedActions: allowedActionsOf({
        orderStatus: o.order_status,
        fulfillmentStatus: o.fulfillment_status,
        fulfillmentStage: o.fulfillment_stage,
        channelType: o.channel_type,
      }),
    };
  }

  /** History in the contract's shape: one entry per changed axis, newest first, at most 200 */
  async timeline(id: string, scope: BranchScope) {
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      const prefix = getSchemaPrefix(em);
      const order = await em.query(
        `SELECT branch_id FROM ${prefix}"orders" WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (order.length === 0 || !branchAllowed(scope, order[0].branch_id)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.ORDER_NOT_FOUND,
          `Order ${id} not found`,
          404,
        );
      }
      const rows = await em.query(
        `SELECT * FROM ${prefix}"order_status_history" WHERE tenant_id = $1 AND order_id = $2
         ORDER BY created_at DESC, id DESC LIMIT 200`,
        [tenantId, id],
      );
      const data: Record<string, unknown>[] = [];
      for (const r of rows as Row[]) {
        const actor = r.actor_id
          ? { type: 'account', id: r.actor_id, name: null }
          : { type: 'system', id: null, name: 'Hệ thống' };
        const at = new Date(r.created_at).toISOString();
        const note = r.reason ?? null;
        const entry = (statusType: string, from: string | null, to: string) =>
          data.push({ at, statusType, from, to, actor, note });
        const created = r.from_order_status === null;
        const order = [
          r.from_order_status && toScreenOrderStatus(r.from_order_status),
          toScreenOrderStatus(r.to_order_status),
        ] as const;
        if (created || r.from_order_status !== r.to_order_status) {
          entry('order', order[0] || null, order[1]);
        }
        if (!created) {
          const stage = (v: string | null) =>
            v === 'PACKING' ? 'packing' : v === 'SHIPPING' ? 'shipping' : null;
          const fulfil = (v: string | null) =>
            v === null
              ? null
              : (stage(v) ?? toScreenFulfillmentStatus(v, null));
          if (r.from_fulfillment_status !== r.to_fulfillment_status) {
            entry(
              'fulfillment',
              fulfil(r.from_fulfillment_status),
              fulfil(r.to_fulfillment_status) as string,
            );
          }
          if (r.from_payment_status !== r.to_payment_status) {
            entry(
              'payment',
              r.from_payment_status &&
                toScreenPaymentStatus(r.from_payment_status),
              toScreenPaymentStatus(r.to_payment_status),
            );
          }
        }
      }
      return { data };
    });
  }

  /** JSON print data (`type=receipt|packing_slip`), rendered by the client */
  async print(id: string, query: PrintOrderQueryDto, scope: BranchScope) {
    const order = await this.detail(id, scope);
    if (!order) {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_NOT_FOUND,
        `Order ${id} not found`,
        404,
      );
    }
    const type = query.type ?? 'receipt';
    const lines = order.items.map((i) => ({
      skuCode: i.skuCode,
      name: i.productName,
      variantName: i.variantName,
      quantity: i.quantity,
      ...(type === 'receipt'
        ? {
            unitPrice: i.unitPrice,
            discountAmount: i.discountAmount,
            lineTotal: i.lineTotal,
          }
        : {}),
    }));
    return {
      type,
      paper: query.paper ?? '80mm',
      // store name and address belong to platform: not known here
      store: { name: null, address: null },
      branch: order.branch,
      code: order.code,
      invoicePrefix: null,
      printedAt: new Date().toISOString(),
      time: order.createdAt,
      cashier: { id: order.createdBy, name: null },
      customer: order.customer,
      shipping: order.shipping,
      note: order.note,
      lines,
      ...(type === 'receipt'
        ? {
            totals: {
              subtotal: order.subtotal,
              discountAmount: order.discountAmount,
              shippingFee: order.shippingFee,
              taxAmount: order.taxAmount,
              totalAmount: order.totalAmount,
              paidAmount: order.paidAmount,
              dueAmount: order.dueAmount,
              changeAmount: order.changeAmount,
            },
            payments: order.payments,
          }
        : {}),
      qrPayload: null,
    };
  }
}

function derivedType(row: Row): string {
  switch (row.channel_type) {
    case 'MANUAL':
      return 'manual';
    case 'ONLINE':
      return 'website';
    case 'MARKETPLACE':
      return 'marketplace';
    default:
      return 'pos';
  }
}

function emptySummary() {
  return {
    today: { total: 0, completed: 0 },
    awaitingConfirmation: 0,
    inFulfillment: { packing: 0, shipping: 0 },
    needsAction: { total: 0, skuUnmapped: 0, stockShortage: 0 },
    tabCounts: {
      all: 0,
      new: 0,
      confirmed: 0,
      packing: 0,
      shipping: 0,
      completed: 0,
      needsAction: 0,
    },
    latestException: null,
  };
}
