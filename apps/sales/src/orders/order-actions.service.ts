import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantScopedRepository,
} from '@pbl/common';
import { SALES_ORDER_COMPLETED } from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import { assertBranchInScope, BranchScope } from '../common/branch-scope';
import { SalesErrorCode } from '../common/errors';
import { InventoryClient } from '../inventory/inventory.client';
import {
  AddPaymentReqDto,
  CancelReqDto,
  ShipReqDto,
} from './dto/create-order.req.dto';
import {
  OrderRes,
  PaymentRes,
  toOrderRes,
  toPaymentRes,
} from './dto/order.res';
import { OrderPaymentEntity } from './entities/order-payment.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';
import { OrderEntity } from './entities/order.entity';
import { paymentStatusOf } from './order-calc';
import { completedPayload, HistoryInput, historyRows } from './order-events';
import { outOfStock, versionConflict } from './orders.service';

export interface HistoryRes {
  at: string;
  statusType: string;
  from: string | null;
  to: string;
  actor: { type: 'account' | 'system'; id: string | null; name: string | null };
  note: string | null;
}

export interface AddPaymentRes {
  payment: PaymentRes;
  paymentStatus: string;
  paidAmount: number;
  dueAmount: number;
}

export interface PrintRes {
  type: string;
  paper: string;
  storeName: string | null;
  branch: { id: string; name: string | null };
  code: string;
  createdAt: string;
  cashier: { id: string; name: string | null };
  customer: OrderRes['customer'];
  shipping: OrderRes['shipping'];
  note: string | null;
  lines: OrderRes['items'];
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  changeAmount: number;
  payments: PaymentRes[];
  qrPayload: string | null;
}

const HISTORY_CAP = 200;

/**
 * The stepper of an order: confirm, pack, ship, complete, cancel, plus payments,
 * history and print data. Each action checks the state machine (S015) and the
 * optional `version` (409), writes the change with a guarded UPDATE (`WHERE
 * version = x`), bumps the version and appends the status history, all in one
 * transaction. Stock is held by `confirm` and given back by `cancel` through the
 * inventory internal command.
 */
@Injectable()
export class OrderActionsService {
  constructor(
    @InjectTenantScopedRepository(OrderEntity)
    private readonly orders: TenantScopedRepository<OrderEntity>,
    @InjectTenantScopedRepository(OrderStatusHistoryEntity)
    private readonly history: TenantScopedRepository<OrderStatusHistoryEntity>,
    @InjectTenantScopedRepository(BranchProjectionEntity)
    private readonly branches: TenantScopedRepository<BranchProjectionEntity>,
    private readonly outbox: EventOutbox,
    private readonly inventory: InventoryClient,
  ) {}

  /** draft | new -> confirmed, holding the stock (409 S004 with the shortages) */
  async confirm(
    accountId: string,
    id: string,
    version?: number,
    scope: BranchScope = null,
  ): Promise<OrderRes> {
    const order = await this.load(id, version, scope);
    this.requireStatus(order, 'confirm', ['draft', 'new']);
    if (!order.stockReserved) {
      const shortages = await this.inventory.reserve(
        order.id,
        order.branchId,
        (order.items ?? []).map(({ sku, quantity }) => ({ sku, quantity })),
      );
      if (shortages) throw outOfStock(shortages);
    }
    try {
      await this.persist(order, accountId, {
        changes: { status: 'confirmed', stockReserved: true },
        history: [{ statusType: 'order', from: order.status, to: 'confirmed' }],
      });
    } catch (error) {
      await this.releaseIfNotHeld(order);
      throw error;
    }
    return this.reload(id);
  }

  /** confirmed + unfulfilled -> packing */
  async pack(
    accountId: string,
    id: string,
    version?: number,
    scope: BranchScope = null,
  ): Promise<OrderRes> {
    const order = await this.load(id, version, scope);
    this.requireStatus(order, 'pack', ['confirmed']);
    this.requireFulfillment(order, 'pack', ['unfulfilled']);
    await this.persist(order, accountId, {
      changes: { fulfillmentStatus: 'packing' },
      history: [
        {
          statusType: 'fulfillment',
          from: order.fulfillmentStatus,
          to: 'packing',
        },
      ],
    });
    return this.reload(id);
  }

  /** confirmed + packing -> shipping */
  async ship(
    accountId: string,
    id: string,
    dto: ShipReqDto,
    scope: BranchScope = null,
  ): Promise<OrderRes> {
    const order = await this.load(id, dto.version, scope);
    this.requireStatus(order, 'ship', ['confirmed']);
    this.requireFulfillment(order, 'ship', ['packing']);
    await this.persist(order, accountId, {
      changes: {
        fulfillmentStatus: 'shipping',
        ...(dto.shippingProviderCode
          ? { shippingProviderCode: dto.shippingProviderCode }
          : {}),
        ...(dto.trackingCode ? { trackingCode: dto.trackingCode } : {}),
      },
      history: [
        {
          statusType: 'fulfillment',
          from: order.fulfillmentStatus,
          to: 'shipping',
        },
      ],
    });
    return this.reload(id);
  }

  /** confirmed -> completed (fulfillment delivered); writes `sales.order.completed` */
  async complete(
    accountId: string,
    id: string,
    version?: number,
    scope: BranchScope = null,
  ): Promise<OrderRes> {
    const order = await this.load(id, version, scope);
    this.requireStatus(order, 'complete', ['confirmed']);
    const history: HistoryInput[] = [
      { statusType: 'order', from: order.status, to: 'completed' },
    ];
    if (order.fulfillmentStatus !== 'delivered') {
      history.push({
        statusType: 'fulfillment',
        from: order.fulfillmentStatus,
        to: 'delivered',
      });
    }
    await this.persist(order, accountId, {
      changes: {
        status: 'completed',
        fulfillmentStatus: 'delivered',
        completedAt: new Date(),
      },
      history,
      inTransaction: async (em) => {
        const completed = Object.assign(new OrderEntity(), order, {
          status: 'completed',
        });
        await this.outbox.add(
          em,
          SALES_ORDER_COMPLETED,
          completedPayload(completed, order.items ?? [], order.createdBy),
        );
      },
    });
    return this.reload(id);
  }

  /** draft | new | confirmed (before shipping) -> cancelled; gives the stock back */
  async cancel(
    accountId: string,
    id: string,
    dto: CancelReqDto,
    scope: BranchScope = null,
  ): Promise<OrderRes> {
    const order = await this.load(id, dto.version, scope);
    if (
      order.status === 'confirmed' &&
      ['shipping', 'delivered'].includes(order.fulfillmentStatus)
    ) {
      throw new BadRequestException({
        errorCode: SalesErrorCode.CANCEL_NOT_ALLOWED,
        message: 'The order is already shipped; use a return instead',
      });
    }
    this.requireStatus(order, 'cancel', ['draft', 'new', 'confirmed']);
    await this.persist(order, accountId, {
      changes: {
        status: 'cancelled',
        cancelReason: dto.reason,
        stockReserved: false,
      },
      history: [
        {
          statusType: 'order',
          from: order.status,
          to: 'cancelled',
          note: dto.reason,
        },
      ],
    });
    // after the commit: a hold left behind expires, a released one is not sold twice
    if (order.stockReserved) await this.inventory.release(order.id);
    return this.reload(id);
  }

  /** Records a payment (or, negative, a refund) and moves `paymentStatus` */
  async addPayment(
    accountId: string,
    id: string,
    dto: AddPaymentReqDto,
    scope: BranchScope = null,
  ): Promise<AddPaymentRes> {
    const order = await this.load(id, dto.version, scope);
    if (dto.amount === 0) {
      throw new BadRequestException({
        errorCode: SalesErrorCode.PAYMENT_EXCEEDS_DUE,
        message: 'The amount cannot be zero',
      });
    }
    if (order.status === 'cancelled' && dto.amount > 0) {
      throw new BadRequestException({
        errorCode: SalesErrorCode.TRANSITION_NOT_ALLOWED,
        message: 'A cancelled order only accepts refunds',
      });
    }
    const paid = order.paidAmount + dto.amount;
    if (paid > order.totalAmount || paid < 0) {
      throw new BadRequestException({
        errorCode: SalesErrorCode.PAYMENT_EXCEEDS_DUE,
        message:
          dto.amount > 0
            ? 'The amount exceeds what is due'
            : 'The refund exceeds what was paid',
      });
    }
    const paymentStatus = paymentStatusOf(
      order.totalAmount,
      paid,
      dto.amount < 0,
    );
    const payment = Object.assign(new OrderPaymentEntity(), {
      id: randomUUID(),
      orderId: id,
      method: dto.method,
      amount: dto.amount,
      paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      note: dto.note ?? null,
      createdBy: accountId,
      createdAt: new Date(),
    });
    const history: HistoryInput[] =
      paymentStatus !== order.paymentStatus
        ? [
            {
              statusType: 'payment',
              from: order.paymentStatus,
              to: paymentStatus,
            },
          ]
        : [];
    await this.persist(order, accountId, {
      changes: { paidAmount: paid, paymentStatus },
      history,
      inTransaction: async (em) => {
        await TenantScopedRepository.forEntity(em, OrderPaymentEntity).save(
          payment,
        );
      },
    });
    return {
      payment: toPaymentRes(payment),
      paymentStatus,
      paidAmount: paid,
      dueAmount: Math.max(0, order.totalAmount - paid),
    };
  }

  /** Status changes, newest first, at most 200 */
  async getHistory(
    id: string,
    scope: BranchScope = null,
  ): Promise<{ data: HistoryRes[] }> {
    const order = await this.orders.findOne({
      where: { id },
      select: { id: true, branchId: true },
    });
    if (!order) throw new NotFoundException();
    assertBranchInScope(scope, order.branchId);
    const rows = await this.history.find({
      where: { orderId: id },
      order: { createdAt: 'DESC' },
      take: HISTORY_CAP,
    });
    return {
      data: rows.map((r) => ({
        at: r.createdAt.toISOString(),
        statusType: r.statusType,
        from: r.oldStatus,
        to: r.newStatus,
        actor: r.changedBy
          ? { type: 'account', id: r.changedBy, name: null }
          : { type: 'system', id: null, name: 'Hệ thống' },
        note: r.note,
      })),
    };
  }

  /** Data for the client to render a receipt or a packing slip (no server-side PDF) */
  async print(
    id: string,
    type = 'receipt',
    paper = '80mm',
    scope: BranchScope = null,
  ): Promise<PrintRes> {
    const order = await this.orders.findOne({
      where: { id },
      relations: { items: true, payments: true },
    });
    if (!order) throw new NotFoundException();
    assertBranchInScope(scope, order.branchId);
    const res = toOrderRes(order);
    const branch = await this.branches.findOne({
      where: { branchId: order.branchId },
    });
    return {
      type,
      paper,
      // the store's name lives in platform; the client prints its own header
      storeName: null,
      branch: { id: order.branchId, name: branch?.name ?? null },
      code: res.code,
      createdAt: res.createdAt,
      cashier: { id: res.createdBy, name: null },
      customer: res.customer,
      shipping: res.shipping,
      note: res.note,
      lines: res.items,
      subtotal: res.subtotal,
      discountAmount: res.discountAmount,
      shippingFee: res.shippingFee,
      totalAmount: res.totalAmount,
      paidAmount: res.paidAmount,
      dueAmount: res.dueAmount,
      changeAmount: res.changeAmount,
      payments: res.payments,
      qrPayload: null,
    };
  }

  private async load(
    id: string,
    version?: number,
    scope: BranchScope = null,
  ): Promise<OrderEntity> {
    const order = await this.orders.findOne({
      where: { id },
      relations: { items: true },
    });
    if (!order) throw new NotFoundException();
    assertBranchInScope(scope, order.branchId);
    if (version !== undefined && version !== order.version) {
      throw versionConflict();
    }
    return order;
  }

  private async reload(id: string): Promise<OrderRes> {
    const order = await this.orders.findOne({
      where: { id },
      relations: { items: true, payments: true },
    });
    if (!order) throw new NotFoundException();
    return toOrderRes(order);
  }

  private requireStatus(
    order: OrderEntity,
    action: string,
    from: string[],
  ): void {
    if (!from.includes(order.status)) {
      throw this.notAllowed(action, order.status);
    }
  }

  private requireFulfillment(
    order: OrderEntity,
    action: string,
    from: string[],
  ): void {
    if (!from.includes(order.fulfillmentStatus)) {
      throw this.notAllowed(action, order.fulfillmentStatus);
    }
  }

  private notAllowed(action: string, current: string): BadRequestException {
    return new BadRequestException({
      errorCode: SalesErrorCode.TRANSITION_NOT_ALLOWED,
      message: `Cannot ${action} an order that is ${current}`,
    });
  }

  /**
   * One guarded write: UPDATE ... WHERE id AND version = the one that was read
   * (zero rows means someone else changed the order: 409), the version bump, the
   * history rows and anything else that must commit with it.
   */
  private async persist(
    order: OrderEntity,
    accountId: string,
    work: {
      changes: Partial<OrderEntity>;
      history: HistoryInput[];
      inTransaction?: (em: EntityManager) => Promise<void>;
    },
  ): Promise<void> {
    await this.orders.transaction(async (orders, em) => {
      const res = await orders.update(
        { id: order.id, version: order.version },
        {
          ...work.changes,
          updatedAt: new Date(),
          version: () => '"version" + 1',
        } as never,
      );
      if (!res.affected) throw versionConflict();
      if (work.history.length) {
        await TenantScopedRepository.forEntity(
          em,
          OrderStatusHistoryEntity,
        ).save(historyRows(order.id, accountId, work.history));
      }
      if (work.inTransaction) await work.inTransaction(em);
    });
  }

  private async releaseIfNotHeld(order: OrderEntity): Promise<void> {
    if (order.stockReserved) return;
    try {
      const current = await this.orders.findOne({ where: { id: order.id } });
      if (current && !current.stockReserved) {
        await this.inventory.release(order.id);
      }
    } catch {
      // the hold expires after its time to live
    }
  }
}
