import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantScopedRepository,
} from '@pbl/common';
import { IsNull, Not } from 'typeorm';
import { SalesErrorCode } from '../common/errors';
import { OrderSummaryReqDto } from './dto/list-orders.req.dto';
import { OrderEntity } from './entities/order.entity';
import {
  buildOrderWhere,
  dateRange,
  tabWhere,
  todayInStore,
} from './order-filters';

export const EXPORT_LIMIT = 10_000;
/** Lets Excel read the CSV as UTF-8 */
export const BOM = String.fromCharCode(0xfeff);

export interface OrderSummaryRes {
  today: { total: number; completed: number };
  awaitingConfirmation: number;
  inFulfillment: { packing: number; shipping: number };
  needsAction: { total: number; skuUnmapped: number; stockShortage: number };
  tabCounts: {
    all: number;
    new: number;
    confirmed: number;
    packing: number;
    shipping: number;
    completed: number;
    needsAction: number;
  };
  latestException: {
    orderId: string;
    code: string;
    exceptionCode: string;
    externalSku: string | null;
    channelName: string;
  } | null;
}

const CSV_COLUMNS = [
  'code',
  'createdAt',
  'channel',
  'customerName',
  'customerPhone',
  'orderStatus',
  'fulfillmentStatus',
  'paymentStatus',
  'subtotal',
  'discountAmount',
  'shippingFee',
  'totalAmount',
  'paidAmount',
  'itemCount',
  'externalOrderCode',
  'note',
] as const;

/** A cell that a spreadsheet would run as a formula gets a leading quote */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text))) {
    text = `'${text}`;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Read models over the orders: the summary cards and the CSV export */
@Injectable()
export class OrderQueryService {
  constructor(
    @InjectTenantScopedRepository(OrderEntity)
    private readonly orders: TenantScopedRepository<OrderEntity>,
  ) {}

  /**
   * `today` counts the orders of `from`..`to` (default today, store timezone);
   * every other figure is a live count, limited to `branchId` and, only when sent,
   * to the dates. Drafts never count.
   */
  async summary(query: OrderSummaryReqDto): Promise<OrderSummaryRes> {
    const live = (extra: object = {}) => ({
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.from || query.to
        ? { createdAt: dateRange(query.from, query.to) }
        : {}),
      ...extra,
    });
    const day = todayInStore();
    const todayRange = dateRange(
      query.from ?? day,
      query.to ?? query.from ?? day,
    );
    const notDraft = { status: Not('draft') };
    const count = (where: object) =>
      this.orders.count({ where: { ...live(), ...where } as never });
    const inRange = (extra: object = {}) =>
      this.orders.count({
        where: {
          ...(query.branchId ? { branchId: query.branchId } : {}),
          createdAt: todayRange,
          ...notDraft,
          ...extra,
        } as never,
      });

    const [
      todayTotal,
      todayCompleted,
      all,
      isNew,
      confirmed,
      packing,
      shipping,
      completed,
      needsAction,
      skuUnmapped,
      stockShortage,
      latest,
    ] = await Promise.all([
      inRange(),
      inRange({ status: 'completed' }),
      count(notDraft),
      count(tabWhere('new')),
      count(tabWhere('confirmed')),
      count(tabWhere('packing')),
      count(tabWhere('shipping')),
      count(tabWhere('completed')),
      count(tabWhere('needs_action')),
      count({ exceptionCode: 'sku_unmapped' }),
      count({ exceptionCode: 'stock_shortage' }),
      this.orders.findOne({
        where: {
          ...live(),
          exceptionCode: Not(IsNull()),
        } as never,
        order: { createdAt: 'DESC' },
      }),
    ]);
    return {
      today: { total: todayTotal, completed: todayCompleted },
      awaitingConfirmation: isNew,
      inFulfillment: { packing, shipping },
      needsAction: { total: needsAction, skuUnmapped, stockShortage },
      tabCounts: {
        all,
        new: isNew,
        confirmed,
        packing,
        shipping,
        completed,
        needsAction,
      },
      latestException: latest
        ? {
            orderId: latest.id,
            code: latest.code,
            exceptionCode: latest.exceptionCode!,
            externalSku: null,
            channelName: latest.channel,
          }
        : null,
    };
  }

  /** CSV of the filtered orders (UTF-8 with BOM), at most 10,000 rows (else 422 S020) */
  async exportCsv(query: OrderSummaryReqDto): Promise<string> {
    const where = buildOrderWhere(query);
    const total = await this.orders.count({ where });
    if (total > EXPORT_LIMIT) {
      throw new UnprocessableEntityException({
        errorCode: SalesErrorCode.EXPORT_TOO_LARGE,
        message: `More than ${EXPORT_LIMIT} orders match: narrow the date range`,
      });
    }
    const rows = await this.orders.find({
      where,
      order: { createdAt: 'DESC' },
      take: EXPORT_LIMIT,
    });
    const lines = [CSV_COLUMNS.join(',')];
    for (const o of rows) {
      lines.push(
        [
          o.code,
          o.createdAt.toISOString(),
          o.channel,
          o.customerName,
          o.customerPhone,
          o.status,
          o.fulfillmentStatus,
          o.paymentStatus,
          o.subtotal,
          o.discountAmount,
          o.shippingFee,
          o.totalAmount,
          o.paidAmount,
          o.itemCount,
          o.externalOrderCode,
          o.note,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return `${BOM}${lines.join('\r\n')}\r\n`;
  }
}
