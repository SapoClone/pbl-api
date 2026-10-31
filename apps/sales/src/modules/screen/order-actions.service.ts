import { Injectable } from '@nestjs/common';
import {
  SALES_ORDER_PACKING,
  SALES_ORDER_SHIPPED,
  SALES_PAYMENT_CONFIRMED,
  SALES_TENDER_RECORDED,
  SalesOrderLifecycleEventPayload,
  SalesOrderShippedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { toMoney } from '../../common/money';
import {
  effectiveAmounts,
  toScreenMethod,
  toStoredMethod,
} from '../../common/order-views';
import { inTenantTx } from '../../common/tenant-tx';
import {
  SalesDomainError,
  SalesDomainErrorCode,
  formatQtyMillis,
  parseQtyMillis,
} from '../../domain/sales-domain';
import {
  getSchemaPrefix,
  nextTenantDocumentCode,
} from '../../infrastructure/persistence/sales-code.generator';
import {
  FulfillmentItemEntity,
  OrderFulfillmentEntity,
  OrderStatusHistoryEntity,
  OrderTenderEntity,
} from '../../infrastructure/persistence/sales.entities';
import { OrderItemEntity } from '../../orders/entities/order-item.entity';
import { OrderEntity } from '../../orders/entities/order.entity';
import { BranchScope, branchAllowed } from '../../presentation/access';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { ReturnsService } from '../returns/returns.service';
import { emitOrderCompleted } from './order-completion';
import { OrderQueryService } from './order-query.service';
import { OrderReturnDto, RecordPaymentDto, ShipOrderDto } from './screen.dto';

function notFound(id: string): SalesDomainError {
  return new SalesDomainError(
    SalesDomainErrorCode.ORDER_NOT_FOUND,
    `Order ${id} not found`,
    404,
  );
}

function assertVersion(order: OrderEntity, version: number): void {
  if (Number(order.version ?? 1) !== version) {
    throw new SalesDomainError(
      SalesDomainErrorCode.RESOURCE_VERSION_CONFLICT,
      `Order ${order.code} version mismatch (expected ${version}, actual ${order.version})`,
      409,
    );
  }
}

function invalidTransition(
  order: OrderEntity,
  action: string,
): SalesDomainError {
  return new SalesDomainError(
    SalesDomainErrorCode.ORDER_INVALID_STATE,
    `Cannot ${action} order ${order.code} in status ${order.orderStatus}/${order.fulfillmentStage ?? order.fulfillmentStatus}`,
    409,
  );
}

/**
 * Stepper transitions, payments and returns of the screen contract, built on the
 * M3 tables: nothing here renames a status, `PACKING` and `SHIPPING` are
 * stored beside the M3 fulfilment status (`orders.fulfillment_stage`).
 */
@Injectable()
export class OrderActionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
    private readonly fulfillment: FulfillmentService,
    private readonly returns: ReturnsService,
    private readonly query: OrderQueryService,
  ) {}

  private async lock(
    em: EntityManager,
    tenantId: string,
    id: string,
    scope: BranchScope,
  ): Promise<OrderEntity> {
    const order = await em.getRepository(OrderEntity).findOne({
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!order || !branchAllowed(scope, order.branchId)) throw notFound(id);
    return order;
  }

  private async history(
    em: EntityManager,
    order: OrderEntity,
    change: {
      fromFulfillment?: string;
      toFulfillment?: string;
      fromPayment?: string;
      toPayment?: string;
      fromOrder?: string;
      toOrder?: string;
      reason: string;
    },
    actorId: string,
    now: Date,
  ): Promise<void> {
    const fo = change.fromOrder ?? order.orderStatus ?? 'CONFIRMED';
    const ff =
      change.fromFulfillment ?? order.fulfillmentStatus ?? 'UNFULFILLED';
    const fp = change.fromPayment ?? order.paymentStatus ?? 'UNPAID';
    await em.save(
      OrderStatusHistoryEntity,
      em.create(OrderStatusHistoryEntity, {
        id: randomUUID(),
        tenantId: order.tenantId,
        orderId: order.id,
        fromOrderStatus: fo,
        toOrderStatus: change.toOrder ?? fo,
        fromPaymentStatus: fp,
        toPaymentStatus: change.toPayment ?? fp,
        fromFulfillmentStatus: ff,
        toFulfillmentStatus: change.toFulfillment ?? ff,
        reason: change.reason,
        actorId,
        createdAt: now,
      }),
    );
  }

  private lifecycle(
    order: OrderEntity,
    actorId: string,
    now: Date,
    fulfillmentStatus: string,
  ): SalesOrderLifecycleEventPayload {
    const amounts = effectiveAmounts({
      totalAmount: order.totalAmount,
      grandTotal: order.grandTotal,
      subtotal: order.subtotal,
    });
    return {
      orderId: order.id,
      code: order.code,
      branchId: order.branchId,
      customerId: order.customerId ?? null,
      channelType: order.channelType ?? 'POS',
      orderStatus: order.orderStatus ?? 'CONFIRMED',
      paymentStatus: order.paymentStatus ?? 'UNPAID',
      fulfillmentStatus,
      subtotal: amounts.subtotal,
      discountTotal:
        (order.itemDiscountTotal ?? 0) +
        (order.orderDiscountTotal ?? 0) +
        (order.promotionDiscountTotal ?? 0),
      taxTotal: order.taxTotal ?? 0,
      grandTotal: order.grandTotal || order.totalAmount,
      actorId,
      occurredAt: now.toISOString(),
    };
  }

  /** `confirmed` and still in the warehouse: `unfulfilled` becomes `packing` */
  async pack(id: string, actorId: string, scope: BranchScope, version: number) {
    await inTenantTx(this.dataSource, async (em, tenantId) => {
      const order = await this.lock(em, tenantId, id, scope);
      assertVersion(order, version);
      if (
        order.orderStatus !== 'CONFIRMED' ||
        (order.fulfillmentStage !== null &&
          order.fulfillmentStage !== undefined) ||
        order.fulfillmentStatus === 'FULFILLED' ||
        order.fulfillmentStatus === 'RETURNED'
      ) {
        throw invalidTransition(order, 'pack');
      }
      const now = new Date();
      await this.history(
        em,
        order,
        { toFulfillment: 'PACKING', reason: 'PACK' },
        actorId,
        now,
      );
      order.fulfillmentStage = 'PACKING';
      order.version = Number(order.version ?? 1) + 1;
      order.updatedAt = now;
      await em.save(OrderEntity, order);
      await this.outbox.add(
        em,
        SALES_ORDER_PACKING,
        this.lifecycle(order, actorId, now, 'PACKING'),
      );
    });
    return this.view(id, scope);
  }

  /**
   * `packing` becomes `shipping`: the order's fulfilment row is created already
   * shipped, carrying the provider and the tracking code (a null code: the provider assigns one).
   */
  async ship(
    id: string,
    actorId: string,
    scope: BranchScope,
    dto: ShipOrderDto,
  ) {
    await inTenantTx(this.dataSource, async (em, tenantId) => {
      const order = await this.lock(em, tenantId, id, scope);
      assertVersion(order, dto.version);
      if (
        order.orderStatus !== 'CONFIRMED' ||
        order.fulfillmentStage !== 'PACKING'
      ) {
        throw invalidTransition(order, 'ship');
      }
      let providerCode: string | null = null;
      if (dto.shippingProviderId) {
        const rows = await em.query(
          `SELECT code FROM ${getSchemaPrefix(em)}"shipping_providers" WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.shippingProviderId],
        );
        if (rows.length === 0) {
          throw new SalesDomainError(
            SalesDomainErrorCode.VALIDATION_ERROR,
            `Shipping provider ${dto.shippingProviderId} not found`,
            422,
          );
        }
        providerCode = rows[0].code as string;
      }
      const now = new Date();
      await this.createFulfillmentRow(em, order, actorId, now, {
        type: 'DELIVERY',
        status: 'SHIPPED',
        carrierCode: providerCode,
        trackingNumber: dto.trackingCode ?? null,
      });
      await this.history(
        em,
        order,
        { toFulfillment: 'SHIPPING', reason: 'SHIP' },
        actorId,
        now,
      );
      order.fulfillmentStage = 'SHIPPING';
      order.version = Number(order.version ?? 1) + 1;
      order.updatedAt = now;
      await em.save(OrderEntity, order);
      await this.outbox.add(em, SALES_ORDER_SHIPPED, {
        ...this.lifecycle(order, actorId, now, 'SHIPPING'),
        shippingProviderId: dto.shippingProviderId ?? null,
        trackingCode: dto.trackingCode ?? null,
      } satisfies SalesOrderShippedPayload);
    });
    return this.view(id, scope);
  }

  /**
   * Delivery: every open fulfilment of the order is confirmed (stock committed,
   * `FULFILLED`); the order completes when it is paid, else it stays `confirmed`
   * and completes with its last payment. Counter and pickup orders may complete
   * from `confirmed`, a fulfilment is made for them.
   */
  async complete(
    id: string,
    actorId: string,
    scope: BranchScope,
    version: number,
  ) {
    const open = await inTenantTx(this.dataSource, async (em, tenantId) => {
      const order = await this.lock(em, tenantId, id, scope);
      assertVersion(order, version);
      if (
        order.orderStatus !== 'CONFIRMED' ||
        order.fulfillmentStatus === 'FULFILLED' ||
        order.fulfillmentStatus === 'RETURNED'
      ) {
        throw invalidTransition(order, 'complete');
      }
      let rows: { id: string }[] = await em.query(
        `SELECT id FROM ${getSchemaPrefix(em)}"order_fulfillments"
         WHERE tenant_id = $1 AND order_id = $2 AND status IN ('PENDING', 'SHIPPED')
         ORDER BY created_at ASC`,
        [tenantId, id],
      );
      if (rows.length === 0) {
        if (order.fulfillmentStage === 'SHIPPING')
          throw invalidTransition(order, 'complete');
        const created = await this.createFulfillmentRow(
          em,
          order,
          actorId,
          new Date(),
          {
            type: 'POS_PICKUP',
            status: 'PENDING',
            carrierCode: null,
            trackingNumber: null,
          },
        );
        rows = [{ id: created.id }];
      }
      return rows.map((r) => r.id);
    });
    for (const fulfillmentId of open) {
      await this.fulfillment.confirmFulfillment(fulfillmentId, actorId, scope);
    }
    return this.view(id, scope);
  }

  private async createFulfillmentRow(
    em: EntityManager,
    order: OrderEntity,
    actorId: string,
    now: Date,
    input: {
      type: 'DELIVERY' | 'POS_PICKUP';
      status: 'PENDING' | 'SHIPPED';
      carrierCode: string | null;
      trackingNumber: string | null;
    },
  ): Promise<OrderFulfillmentEntity> {
    const code = await nextTenantDocumentCode(em, order.tenantId, 'VD');
    const row = em.create(OrderFulfillmentEntity, {
      id: randomUUID(),
      tenantId: order.tenantId,
      code,
      orderId: order.id,
      branchId: order.branchId,
      warehouseId: order.warehouseId ?? null,
      reservationId: order.reservationId ?? null,
      fulfillmentType: input.type,
      status: input.status,
      carrierCode: input.carrierCode,
      trackingNumber: input.trackingNumber,
      shippedAt: input.status === 'SHIPPED' ? now : null,
      confirmedAt: null,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    });
    await em.save(OrderFulfillmentEntity, row);
    const items = await em.getRepository(OrderItemEntity).find({
      where: { orderId: order.id, tenantId: order.tenantId },
    });
    await em.save(
      FulfillmentItemEntity,
      items.map((oi) =>
        em.create(FulfillmentItemEntity, {
          id: randomUUID(),
          tenantId: order.tenantId,
          fulfillmentId: row.id,
          orderItemId: oi.id,
          skuCode: oi.sku,
          qty: formatQtyMillis(parseQtyMillis(oi.qty ?? oi.quantity)),
        }),
      ),
    );
    return row;
  }

  /**
   * A payment (`amount` > 0) or a refund (`amount` < 0) against the order. The
   * `Idempotency-Key` makes a retry return the first result. Reaching the total
   * pays the order; a paid order whose goods are delivered completes.
   */
  async recordPayment(
    id: string,
    actorId: string,
    scope: BranchScope,
    key: string,
    dto: RecordPaymentDto,
  ) {
    const method = toStoredMethod(dto.method);
    if (!method) {
      throw new SalesDomainError(
        SalesDomainErrorCode.VALIDATION_ERROR,
        `Unknown payment method ${dto.method}`,
        422,
      );
    }
    const tenderKey = `pay:${id}:${key}`.slice(0, 128);
    const out = await inTenantTx(this.dataSource, async (em, tenantId) => {
      const order = await this.lock(em, tenantId, id, scope);

      const existing = await em.getRepository(OrderTenderEntity).findOne({
        where: { tenantId, idempotencyKey: tenderKey },
      });
      if (existing) {
        return { order, tender: existing, replayed: true };
      }

      if (order.orderStatus === 'CANCELLED' || order.orderStatus === 'DRAFT') {
        throw invalidTransition(order, 'record a payment for');
      }
      const amounts = effectiveAmounts({
        totalAmount: order.totalAmount,
        grandTotal: order.grandTotal,
        subtotal: order.subtotal,
        paidAmount: order.paidAmount,
        paymentStatus: order.paymentStatus,
      });
      const refund = dto.amount < 0;
      const value = Math.abs(dto.amount);
      const paid = amounts.paidAmount;
      if (refund ? value > paid : value > amounts.totalAmount - paid) {
        throw new SalesDomainError(
          SalesDomainErrorCode.PAYMENT_EXCEEDS_DUE,
          refund
            ? `Refund ${value} exceeds what was paid (${paid})`
            : `Payment ${value} exceeds what is due (${amounts.totalAmount - paid})`,
          409,
        );
      }

      const now = new Date();
      const nextPaid = refund ? paid - value : paid + value;
      const nextStatus = refund
        ? nextPaid === 0
          ? 'REFUNDED'
          : 'PARTIALLY_REFUNDED'
        : nextPaid >= amounts.totalAmount
          ? 'PAID'
          : 'PARTIALLY_PAID';

      const shift = order.shiftId
        ? await em.query(
            `SELECT id FROM ${getSchemaPrefix(em)}"pos_shifts" WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'`,
            [tenantId, order.shiftId],
          )
        : [];
      const cash = method === 'CASH' && shift.length > 0;

      const tender = em.create(OrderTenderEntity, {
        id: randomUUID(),
        tenantId,
        orderId: id,
        checkoutId: null,
        shiftId: cash ? order.shiftId! : null,
        idempotencyKey: tenderKey,
        method,
        amount: value,
        tenderedCash: method === 'CASH' && !refund ? value : 0,
        changeDue: 0,
        status: 'CONFIRMED',
        externalRef: null,
        confirmedBy: actorId,
        confirmedAt: now,
        kind: refund ? 'REFUND' : 'PAYMENT',
        note: dto.note ?? null,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : now,
        createdAt: now,
      });
      await em.save(OrderTenderEntity, tender);

      if (cash) {
        await em.query(
          refund
            ? `UPDATE ${getSchemaPrefix(em)}"pos_shifts"
               SET cash_refunds_total = cash_refunds_total + $3::bigint,
                   expected_cash = expected_cash - $3::bigint, version = version + 1
               WHERE tenant_id = $1 AND id = $2`
            : `UPDATE ${getSchemaPrefix(em)}"pos_shifts"
               SET cash_sales_total = cash_sales_total + $3::bigint,
                   expected_cash = expected_cash + $3::bigint, version = version + 1
               WHERE tenant_id = $1 AND id = $2`,
          [tenantId, order.shiftId, value],
        );
      }

      const previousPayment = order.paymentStatus ?? 'UNPAID';
      order.paidAmount = nextPaid;
      if (refund) order.refundedAmount = (order.refundedAmount ?? 0) + value;
      order.paymentStatus = nextStatus;
      let completes = false;
      if (
        nextStatus === 'PAID' &&
        order.orderStatus === 'CONFIRMED' &&
        order.fulfillmentStatus === 'FULFILLED'
      ) {
        completes = true;
        order.orderStatus = 'COMPLETED';
        order.status = 'completed';
        order.completedAt = now;
      }
      await this.history(
        em,
        order,
        {
          fromPayment: previousPayment,
          toPayment: nextStatus,
          fromOrder: completes ? 'CONFIRMED' : undefined,
          toOrder: completes ? 'COMPLETED' : undefined,
          reason: refund ? 'REFUND_RECORDED' : 'PAYMENT_RECORDED',
        },
        actorId,
        now,
      );
      order.version = Number(order.version ?? 1) + 1;
      order.updatedAt = now;
      await em.save(OrderEntity, order);

      if (!refund) {
        await this.outbox.add(em, SALES_TENDER_RECORDED, {
          orderId: id,
          checkoutId: null,
          shiftId: tender.shiftId,
          totalConfirmed: value,
          totalCashSales: cash ? value : 0,
          totalChangeDue: 0,
          occurredAt: now.toISOString(),
        });
        if (nextStatus === 'PAID') {
          await this.outbox.add(em, SALES_PAYMENT_CONFIRMED, {
            orderId: id,
            checkoutId: null,
            amount: nextPaid,
            paymentStatus: nextStatus,
            occurredAt: now.toISOString(),
          });
        }
      }
      if (completes)
        await emitOrderCompleted(em, this.outbox, order, actorId, now);
      return { order, tender, replayed: false };
    });

    const { order, tender } = out;
    const total = order.totalAmount;
    const paidAmount = effectiveAmounts({
      totalAmount: total,
      grandTotal: order.grandTotal,
      paidAmount: order.paidAmount,
      paymentStatus: order.paymentStatus,
    }).paidAmount;
    return {
      replayed: out.replayed,
      body: {
        payment: {
          id: tender.id,
          method: toScreenMethod(tender.method),
          amount:
            tender.kind === 'REFUND'
              ? -toMoney(tender.amount)
              : toMoney(tender.amount),
          status: 'paid',
          paidAt: new Date(
            tender.paidAt ?? tender.confirmedAt ?? tender.createdAt,
          ).toISOString(),
        },
        paymentStatus: (await this.view(id, scope))?.paymentStatus,
        paidAmount,
        dueAmount:
          order.orderStatus === 'CANCELLED' ||
          order.paymentStatus === 'REFUNDED'
            ? 0
            : Math.max(0, total - paidAmount),
      },
    };
  }

  /**
   * One return per call against a completed order. `autoApprove` and
   * `autoReceive` (stock back on the shelf) are turned on only for a caller who
   * may approve and receive; otherwise the return waits for those steps.
   */
  async createReturn(
    id: string,
    actorId: string,
    scope: BranchScope,
    dto: OrderReturnDto,
    can: { approve: boolean; receive: boolean },
  ) {
    const restock = dto.restock !== false;
    const created = await this.returns.createReturn(actorId, scope, {
      orderId: id,
      note: dto.reason,
      autoApprove: can.approve,
      autoReceive: restock && can.approve && can.receive,
      items: dto.items.map((i) => ({
        orderItemId: i.orderItemId,
        returnQty: i.quantity,
        disposition: restock ? 'RESTOCK' : 'NO_PHYSICAL_RETURN',
        reason: dto.reason,
      })),
    });
    const refundAmount = toMoney(created.totalRefundAmount);
    if (dto.refund) {
      if (dto.refund.amount > refundAmount) {
        throw new SalesDomainError(
          SalesDomainErrorCode.REFUND_AMOUNT_EXCEEDED,
          `Refund ${dto.refund.amount} exceeds the return's refund ${refundAmount}`,
          409,
        );
      }
      if (can.approve) {
        await this.returns.createRefundRequest(
          created.id,
          actorId,
          scope,
          undefined,
          {
            amount: dto.refund.amount,
            method: toStoredMethod(dto.refund.method) as
              | 'CASH'
              | 'BANK_TRANSFER'
              | 'CARD'
              | 'E_WALLET',
          },
        );
      }
    }
    return {
      id: created.id,
      orderId: created.orderId,
      status: created.status,
      items: created.items.map((i) => ({
        orderItemId: i.orderItemId,
        quantity: Number(i.returnQty),
        refundAmount: toMoney(i.refundAmount),
      })),
      refundAmount,
      createdAt: new Date(created.createdAt).toISOString(),
    };
  }

  private view(id: string, scope: BranchScope) {
    return this.query.detail(id, scope);
  }
}
