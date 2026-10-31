import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantContext,
  TenantScopedRepository,
} from '@pbl/common';
import { SALES_ORDER_COMPLETED } from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { createHash, randomUUID } from 'crypto';
import { EntityManager, QueryFailedError } from 'typeorm';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import {
  CodeSequenceService,
  ORDER_CODE_START,
  orderCode,
} from '../common/code-sequence.service';
import { SalesErrorCode } from '../common/errors';
import { InventoryClient } from '../inventory/inventory.client';
import { RegisterEntity } from '../registers/register.entity';
import { ShiftEntity } from '../shifts/shift.entity';
import {
  CreateOrderReqDto,
  OrderFieldsReqDto,
  OrderLineReqDto,
  PaymentReqDto,
  ShippingReqDto,
  UpdateOrderReqDto,
} from './dto/create-order.req.dto';
import { ListOrdersReqDto } from './dto/list-orders.req.dto';
import { OrderRes, toOrderRes } from './dto/order.res';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderPaymentEntity } from './entities/order-payment.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';
import { OrderEntity } from './entities/order.entity';
import {
  applyShipping,
  computeMoney,
  OrderStatus,
  paymentStatusOf,
  planPayments,
  shippingOf,
} from './order-calc';
import { completedPayload, HistoryInput, historyRows } from './order-events';
import { buildOrderWhere } from './order-filters';

export { SalesErrorCode };

/** The order id derives from the key, so a racing retry can hit the primary key first */
const ORDER_PRIMARY_KEY = 'PK_orders_id';
const IDEMPOTENCY_INDEX = 'UQ_orders_tenant_idempotency_key';

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

export interface CreateOrderResult {
  order: OrderRes;
  /** True when the same Idempotency-Key had already created this order */
  replayed: boolean;
}

/** What identifies a request: the same key with another body is a client bug */
export function hashRequest(dto: CreateOrderReqDto): string {
  const identity: Record<string, unknown> = {
    branchId: dto.branchId,
    paymentMethod: dto.paymentMethod,
    customerName: dto.customerName ?? null,
    items: dto.items.map((i) => [i.sku, i.name, i.quantity, i.unitPrice]),
  };
  // new fields count only when sent, so a legacy body hashes as it always did
  for (const key of [
    'orderStatus',
    'source',
    'channel',
    'customerId',
    'customerPhone',
    'registerId',
    'shiftId',
    'shipping',
    'discountAmount',
    'payments',
    'note',
  ] as const) {
    if (dto[key] !== undefined) identity[key] = dto[key];
  }
  const withVariants = dto.items.some((i) => i.variantId !== undefined);
  if (withVariants)
    identity['variants'] = dto.items.map((i) => i.variantId ?? null);
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

/** A stable UUID for the order of this tenant and key (the hold is keyed by it) */
function orderIdFor(tenantId: string, idempotencyKey: string): string {
  const h = createHash('sha256')
    .update(`${tenantId}:${idempotencyKey}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Another request with the same Idempotency-Key committed first */
class IdempotencyRace extends Error {}

export function outOfStock(shortages: unknown[]): ConflictException {
  return new ConflictException({
    errorCode: SalesErrorCode.OUT_OF_STOCK,
    message: 'Not enough stock for this order',
    details: shortages,
  });
}

export function versionConflict(): ConflictException {
  return new ConflictException({
    errorCode: SalesErrorCode.VERSION_CONFLICT,
    message: 'The order changed since it was read; reload and retry',
  });
}

/** Everything an order write needs, from a create request or a merged draft edit */
interface Spec extends OrderFieldsReqDto {
  items: OrderLineReqDto[];
  paymentMethod?: string;
}

/**
 * Sells at the counter and takes orders: the order, its lines, payments, status
 * history and (for a completed order) the `sales.order.completed` event commit in
 * one transaction. Every read and write is scoped to the token's store by
 * TenantScopedRepository (ADR-0008). Creating is idempotent per `Idempotency-Key`,
 * so a client that retries on a bad network never sells twice.
 */
@Injectable()
export class OrdersService {
  constructor(
    @InjectTenantScopedRepository(OrderEntity)
    private readonly orders: TenantScopedRepository<OrderEntity>,
    @InjectTenantScopedRepository(BranchProjectionEntity)
    private readonly branches: TenantScopedRepository<BranchProjectionEntity>,
    private readonly outbox: EventOutbox,
    private readonly inventory: InventoryClient,
    private readonly codes: CodeSequenceService,
    @InjectTenantScopedRepository(RegisterEntity)
    private readonly registers: TenantScopedRepository<RegisterEntity>,
    @InjectTenantScopedRepository(ShiftEntity)
    private readonly shifts: TenantScopedRepository<ShiftEntity>,
  ) {}

  async create(
    accountId: string,
    idempotencyKey: string,
    dto: CreateOrderReqDto,
  ): Promise<CreateOrderResult> {
    const requestHash = hashRequest(dto);
    const earlier = await this.findByKey(idempotencyKey);
    if (earlier) return this.replay(earlier, requestHash);

    await this.assertActiveBranch(dto.branchId);

    const orderStatus: OrderStatus = dto.orderStatus ?? 'completed';
    const counter = await this.resolveCounter(
      dto.branchId,
      dto.registerId,
      dto.shiftId,
      dto.source,
      orderStatus,
    );
    const fields = this.fields(dto, orderStatus, counter);

    // The order id is the reservation key, so it exists before the order does. It
    // derives from the Idempotency-Key: a concurrent retry asks for the same hold
    // (inventory is idempotent per order) instead of taking a second one.
    const orderId = orderIdFor(TenantContext.require(), idempotencyKey);
    if (orderStatus !== 'draft') {
      await this.reserve(orderId, dto.branchId, dto.items);
    }
    const items = this.buildItems(orderId, dto.items);
    const plan = this.planOf(dto, orderStatus, fields.totalAmount ?? 0);
    const order = Object.assign(new OrderEntity(), fields);
    order.id = orderId;
    order.branchId = dto.branchId;
    order.createdBy = accountId;
    order.createdAt = new Date();
    order.idempotencyKey = idempotencyKey;
    order.requestHash = requestHash;
    order.version = 1;
    order.externalOrderCode = null;
    order.trackingCode = null;
    order.cancelReason = null;

    try {
      const saved = await this.orders.transaction(async (orders, em) => {
        // The code counter row serialises concurrent creates; a request that waited
        // for it finds the winner's order here (save() would silently UPDATE it).
        const code = await this.codes.next(em, 'order', ORDER_CODE_START);
        if (await orders.findOne({ where: { id: orderId } })) {
          throw new IdempotencyRace();
        }
        order.code = orderCode(code);
        const row = await orders.save(order);
        const lines = await TenantScopedRepository.forEntity(
          em,
          OrderItemEntity,
        ).save(items);
        const paid = await this.savePayments(em, orderId, accountId, plan.rows);
        const history: HistoryInput[] = [
          { statusType: 'order', from: null, to: orderStatus },
        ];
        if (row.paymentStatus && row.paymentStatus !== 'unpaid') {
          history.push({
            statusType: 'payment',
            from: null,
            to: row.paymentStatus,
          });
        }
        await TenantScopedRepository.forEntity(
          em,
          OrderStatusHistoryEntity,
        ).save(historyRows(orderId, accountId, history));
        if (orderStatus === 'completed') {
          await this.outbox.add(
            em,
            SALES_ORDER_COMPLETED,
            completedPayload(row, lines, accountId),
          );
        }
        row.items = lines;
        row.payments = paid;
        return row;
      });
      return { order: toOrderRes(saved), replayed: false };
    } catch (error) {
      // Two requests with the same key raced past the lookup; the index decided.
      // They share one hold, which belongs to the winner: nothing to give back.
      if (error instanceof IdempotencyRace || this.isKeyViolation(error)) {
        const winner = await this.findByKey(idempotencyKey);
        if (winner) return this.replay(winner, requestHash);
      }
      if (orderStatus !== 'draft') {
        await this.releaseUnlessCreated(orderId, idempotencyKey);
      }
      throw error;
    }
  }

  /**
   * Edits a draft. `orderStatus: confirmed | completed` finalises it: stock is held
   * as for a new order and, when completed, the event is written.
   */
  async update(
    accountId: string,
    id: string,
    dto: UpdateOrderReqDto,
  ): Promise<OrderRes> {
    const order = await this.orders.findOne({
      where: { id },
      relations: { items: true, payments: true },
    });
    if (!order) throw new NotFoundException();
    if (order.status !== 'draft') {
      throw new BadRequestException({
        errorCode: SalesErrorCode.NOT_A_DRAFT,
        message: `Only a draft can be edited (this order is ${order.status})`,
      });
    }
    if (dto.version !== undefined && dto.version !== order.version) {
      throw versionConflict();
    }
    const orderStatus: OrderStatus = dto.orderStatus ?? 'draft';
    const keepPayments = dto.payments === undefined && order.payments?.length;
    const spec: Spec = {
      source: dto.source ?? (order.source as 'pos' | 'manual'),
      channel: dto.channel ?? order.channel,
      customerId: dto.customerId ?? order.customerId ?? undefined,
      customerName: dto.customerName ?? order.customerName ?? undefined,
      customerPhone: dto.customerPhone ?? order.customerPhone ?? undefined,
      shipping: dto.shipping ?? shippingOf(order) ?? undefined,
      discountAmount: dto.discountAmount ?? order.discountAmount,
      note: dto.note ?? order.note ?? undefined,
      payments:
        dto.payments ??
        (keepPayments
          ? (order.payments!.map((p) => ({
              method: p.method,
              amount: p.amount,
            })) as PaymentReqDto[])
          : undefined),
      paymentMethod: dto.paymentMethod ?? order.paymentMethod,
      items:
        dto.items ??
        (order.items ?? []).map((i) => ({
          sku: i.sku,
          name: i.name,
          variantId: i.variantId ?? undefined,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
    };
    const counter = await this.resolveCounter(
      order.branchId,
      dto.registerId ?? order.registerId ?? undefined,
      dto.shiftId ?? order.shiftId ?? undefined,
      spec.source,
      orderStatus,
    );
    const fields = this.fields(spec, orderStatus, counter);
    const plan = this.planOf(spec, orderStatus, fields.totalAmount ?? 0);
    const reserveNow = orderStatus !== 'draft';
    if (reserveNow) await this.reserve(order.id, order.branchId, spec.items);

    try {
      await this.orders.transaction(async (orders, em) => {
        const changes = {
          ...fields,
          updatedAt: new Date(),
          version: () => '"version" + 1',
        };
        const res = await orders.update(
          { id, status: 'draft', version: order.version },
          changes as never,
        );
        if (!res.affected) throw versionConflict();
        const lines = this.buildItems(id, spec.items);
        if (dto.items) {
          await TenantScopedRepository.forEntity(em, OrderItemEntity).delete({
            orderId: id,
          });
          await TenantScopedRepository.forEntity(em, OrderItemEntity).save(
            lines,
          );
        }
        if (dto.payments !== undefined || !keepPayments) {
          await TenantScopedRepository.forEntity(em, OrderPaymentEntity).delete(
            { orderId: id },
          );
          await this.savePayments(em, id, accountId, plan.rows);
        }
        const history: HistoryInput[] = [];
        if (orderStatus !== 'draft') {
          history.push({ statusType: 'order', from: 'draft', to: orderStatus });
        }
        if (fields.paymentStatus !== order.paymentStatus) {
          history.push({
            statusType: 'payment',
            from: order.paymentStatus,
            to: fields.paymentStatus!,
          });
        }
        if (history.length) {
          await TenantScopedRepository.forEntity(
            em,
            OrderStatusHistoryEntity,
          ).save(historyRows(id, accountId, history));
        }
        if (orderStatus === 'completed') {
          const saved = Object.assign(new OrderEntity(), order, fields);
          await this.outbox.add(
            em,
            SALES_ORDER_COMPLETED,
            completedPayload(saved, lines, accountId),
          );
        }
      });
    } catch (error) {
      if (reserveNow) await this.releaseIfNotHeld(id);
      throw error;
    }
    return this.get(id);
  }

  async list(query: ListOrdersReqDto): Promise<Page<OrderRes>> {
    const [rows, total] = await this.orders.findAndCount({
      where: buildOrderWhere(query),
      order: { [query.sort ?? 'createdAt']: query.order ?? 'DESC' },
      take: query.limit,
      skip: (query.page - 1) * query.limit,
    });
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    return {
      data: rows.map(toOrderRes),
      pagination: {
        limit: query.limit,
        currentPage: query.page,
        ...(query.page < totalPages ? { nextPage: query.page + 1 } : {}),
        totalRecords: total,
        totalPages,
      },
    };
  }

  async get(id: string): Promise<OrderRes> {
    const order = await this.orders.findOne({
      where: { id },
      relations: { items: true, payments: true },
    });
    if (!order) {
      // also another store's order: never revealed (api-conventions §6)
      throw new NotFoundException();
    }
    return toOrderRes(order);
  }

  /** Columns of the order for a spec: totals computed here, never taken from the client */
  private fields(
    spec: Spec,
    orderStatus: OrderStatus,
    counter: { registerId: string | null; shiftId: string | null },
  ): Partial<OrderEntity> {
    const money = computeMoney(
      spec.items,
      spec.discountAmount ?? 0,
      spec.shipping,
    );
    const plan = this.planOf(spec, orderStatus, money.totalAmount);
    const probe = new OrderEntity();
    applyShipping(probe, spec.shipping);
    const completed = orderStatus === 'completed';
    return {
      status: orderStatus,
      fulfillmentStatus: completed ? 'delivered' : 'unfulfilled',
      paymentStatus: paymentStatusOf(money.totalAmount, plan.paidAmount),
      exceptionCode: null,
      source: spec.source ?? 'pos',
      channel: spec.channel ?? 'pos',
      customerId: spec.customerId ?? null,
      customerName: spec.customerName ?? null,
      customerPhone: spec.customerPhone ?? null,
      shippingRecipient: probe.shippingRecipient,
      shippingPhone: probe.shippingPhone,
      shippingAddressLine: probe.shippingAddressLine,
      shippingWard: probe.shippingWard,
      shippingDistrict: probe.shippingDistrict,
      shippingProvince: probe.shippingProvince,
      shippingProviderCode: probe.shippingProviderCode,
      shippingFeePayer: money.feePayer,
      subtotal: money.subtotal,
      discountAmount: money.discountAmount,
      shippingFee: money.shippingFee,
      totalAmount: money.totalAmount,
      itemCount: spec.items.reduce((sum, i) => sum + i.quantity, 0),
      paymentMethod: plan.method,
      paidAmount: plan.paidAmount,
      changeAmount: plan.changeAmount,
      note: spec.note ?? null,
      registerId: counter.registerId,
      shiftId: counter.shiftId,
      stockReserved: orderStatus !== 'draft',
      completedAt: completed ? new Date() : null,
    };
  }

  private planOf(spec: Spec, orderStatus: OrderStatus, total: number) {
    const planInput = {
      orderStatus,
      totalAmount: total,
      source: spec.source,
      paymentMethod: spec.paymentMethod,
      payments: spec.payments,
    };
    const plan = planPayments(planInput);
    const cod =
      spec.payments?.some((p) => p.method === 'cod') ||
      (spec.paymentMethod === 'cod' &&
        (spec.source !== undefined || orderStatus !== 'completed'));
    if (
      cod &&
      !spec.customerId &&
      !spec.customerName &&
      !spec.shipping?.recipientName
    ) {
      throw new BadRequestException({
        errorCode: SalesErrorCode.CUSTOMER_REQUIRED_FOR_COD,
        message: 'A customer is required for cash on delivery',
      });
    }
    return plan;
  }

  private buildItems(orderId: string, lines: OrderLineReqDto[]) {
    return lines.map((line) => {
      const item = new OrderItemEntity();
      item.id = randomUUID();
      item.orderId = orderId;
      item.variantId = line.variantId ?? null;
      item.sku = line.sku;
      item.name = line.name;
      item.quantity = line.quantity;
      item.unitPrice = line.unitPrice;
      item.lineTotal = line.quantity * line.unitPrice;
      return item;
    });
  }

  private async savePayments(
    em: EntityManager,
    orderId: string,
    accountId: string,
    rows: { method: string; amount: number }[],
  ): Promise<OrderPaymentEntity[]> {
    if (rows.length === 0) return [];
    const now = new Date();
    return TenantScopedRepository.forEntity(em, OrderPaymentEntity).save(
      rows.map((r) =>
        Object.assign(new OrderPaymentEntity(), {
          id: randomUUID(),
          orderId,
          method: r.method,
          amount: r.amount,
          paidAt: now,
          note: null,
          createdBy: accountId,
          createdAt: now,
        }),
      ),
    );
  }

  /** Holds the stock of the lines under the order id, or refuses with the shortages */
  private async reserve(
    orderId: string,
    branchId: string,
    lines: { sku: string; quantity: number }[],
  ): Promise<void> {
    const shortages = await this.inventory.reserve(
      orderId,
      branchId,
      lines.map(({ sku, quantity }) => ({ sku, quantity })),
    );
    if (shortages) throw outOfStock(shortages);
  }

  /**
   * The register and shift an order belongs to. A shift must be open (S010); a
   * register alone picks up its open shift, and a `pos` checkout needs one.
   * Without either (the legacy counter sale) the order belongs to no shift.
   */
  private async resolveCounter(
    branchId: string,
    registerId: string | undefined,
    shiftId: string | undefined,
    source: string | undefined,
    orderStatus: OrderStatus,
  ): Promise<{ registerId: string | null; shiftId: string | null }> {
    if (!registerId && !shiftId) return { registerId: null, shiftId: null };
    if (shiftId) {
      const shift = await this.shifts.findOne({ where: { id: shiftId } });
      if (
        !shift ||
        shift.status !== 'open' ||
        shift.branchId !== branchId ||
        (registerId && shift.registerId !== registerId)
      ) {
        throw this.shiftNotOpen();
      }
      return { registerId: shift.registerId, shiftId: shift.id };
    }
    const register = await this.registers.findOne({
      where: { id: registerId! },
    });
    if (
      !register ||
      register.status !== 'active' ||
      register.branchId !== branchId
    ) {
      throw new BadRequestException({
        errorCode: SalesErrorCode.UNKNOWN_REGISTER,
        message: 'The register does not exist in this branch or is not active',
      });
    }
    const open = await this.shifts.findOne({
      where: { registerId: register.id, status: 'open' },
    });
    if (!open && source === 'pos' && orderStatus === 'completed') {
      throw this.shiftNotOpen();
    }
    return { registerId: register.id, shiftId: open?.id ?? null };
  }

  private shiftNotOpen(): BadRequestException {
    return new BadRequestException({
      errorCode: SalesErrorCode.SHIFT_NOT_OPEN,
      message: 'The shift is not open for this register',
    });
  }

  /**
   * Gives the stock back after a failure, but only when the order is known not to
   * exist: an error after COMMIT (a dropped connection) must not free stock that a
   * stored order has sold. When that cannot be told, the hold expires by itself.
   */
  private async releaseUnlessCreated(
    orderId: string,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      if (await this.findByKey(idempotencyKey)) return;
      await this.inventory.release(orderId);
    } catch {
      // the hold expires after its time to live
    }
  }

  /** A failed finalise: give the hold back unless a concurrent request got the order to hold it */
  private async releaseIfNotHeld(orderId: string): Promise<void> {
    try {
      const current = await this.orders.findOne({ where: { id: orderId } });
      if (current && !current.stockReserved) {
        await this.inventory.release(orderId);
      }
    } catch {
      // the hold expires after its time to live
    }
  }

  private findByKey(idempotencyKey: string): Promise<OrderEntity | null> {
    return this.orders.findOne({
      where: { idempotencyKey },
      relations: { items: true, payments: true },
    });
  }

  /** The first result for this key, or a conflict when the request is not the same */
  private replay(order: OrderEntity, requestHash: string): CreateOrderResult {
    if (order.requestHash !== requestHash) {
      throw new ConflictException({
        errorCode: SalesErrorCode.IDEMPOTENCY_KEY_REUSED,
        message: 'The Idempotency-Key was already used for a different request',
      });
    }
    return { order: toOrderRes(order), replayed: true };
  }

  private isKeyViolation(error: unknown): boolean {
    const driver = (error as QueryFailedError)?.driverError as
      | { code?: string; constraint?: string }
      | undefined;
    return (
      error instanceof QueryFailedError &&
      driver?.code === '23505' &&
      (driver?.constraint === IDEMPOTENCY_INDEX ||
        driver?.constraint === ORDER_PRIMARY_KEY)
    );
  }

  /** A bare branch id from the request is checked against the projection, with the tenant */
  private async assertActiveBranch(branchId: string): Promise<void> {
    const branch = await this.branches.findOne({ where: { branchId } });
    if (!branch || branch.status !== 'active') {
      throw new BadRequestException({
        errorCode: SalesErrorCode.UNKNOWN_BRANCH,
        message: 'The branch does not exist in this store or is not active',
      });
    }
  }
}

export type { ShippingReqDto };
