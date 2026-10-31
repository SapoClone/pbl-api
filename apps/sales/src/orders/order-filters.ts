import {
  And,
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  Not,
} from 'typeorm';
import { OrderFiltersReqDto } from './dto/list-orders.req.dto';
import { OrderEntity } from './entities/order.entity';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The store's timezone until tenants have one (api-conventions §5) */
const TZ_OFFSET = '+07:00';

/** Start of a Ho Chi Minh calendar day (YYYY-MM-DD) as an instant */
export const dayStart = (date: string): Date =>
  new Date(`${date}T00:00:00${TZ_OFFSET}`);

/** Today's date in Asia/Ho_Chi_Minh, YYYY-MM-DD */
export function todayInStore(now = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** `from`/`to` are inclusive days: [start of from, start of the day after to) */
export function dateRange(from?: string, to?: string) {
  if (!from && !to) return undefined;
  const parts = [];
  if (from) parts.push(MoreThanOrEqual(dayStart(from)));
  if (to) parts.push(LessThan(new Date(dayStart(to).getTime() + DAY_MS)));
  return parts.length === 1 ? parts[0] : And(...parts);
}

/** The tab rules; together `new`..`completed` partition the non-draft, non-cancelled orders */
export function tabWhere(tab: string): FindOptionsWhere<OrderEntity> {
  switch (tab) {
    case 'new':
      return { status: 'new' };
    case 'confirmed':
      return { status: 'confirmed', fulfillmentStatus: 'unfulfilled' };
    case 'packing':
      return { status: 'confirmed', fulfillmentStatus: 'packing' };
    case 'shipping':
      return { status: 'confirmed', fulfillmentStatus: 'shipping' };
    case 'completed':
      return { status: 'completed' };
    case 'needs_action':
      return { exceptionCode: Not(IsNull()) };
    case 'processing':
      return { status: 'confirmed' };
    default:
      return {};
  }
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/**
 * TypeORM where for the filters. Drafts are left out unless asked for with
 * `orderStatus` (they are parked invoices, not orders yet). `q` becomes an OR over
 * the searchable fields, each alternative carrying every other filter.
 */
export function buildOrderWhere(
  query: OrderFiltersReqDto,
): FindOptionsWhere<OrderEntity>[] {
  const base: FindOptionsWhere<OrderEntity> = {};
  if (query.branchId) base.branchId = query.branchId;
  if (query.customerId) base.customerId = query.customerId;
  if (query.registerId) base.registerId = query.registerId;
  if (query.channel?.length) base.channel = In(query.channel);
  if (query.paymentStatus?.length) {
    base.paymentStatus = In(query.paymentStatus);
  }
  if (query.fulfillmentStatus?.length) {
    base.fulfillmentStatus = In(query.fulfillmentStatus);
  }
  base.status = query.orderStatus?.length
    ? In(query.orderStatus)
    : Not('draft');
  const range = dateRange(query.from, query.to);
  if (range) base.createdAt = range;
  if (query.tab) Object.assign(base, tabWhere(query.tab));

  const q = query.q?.trim();
  if (!q) return [base];
  const like = ILike(`%${escapeLike(q)}%`);
  return [
    { ...base, code: like },
    { ...base, externalOrderCode: like },
    { ...base, customerName: like },
    { ...base, customerPhone: like },
    { ...base, shippingPhone: like },
  ];
}
