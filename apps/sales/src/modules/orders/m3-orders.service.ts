import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  SALES_ORDER_CANCELLED,
  SALES_ORDER_CONFIRMED,
  SALES_ORDER_CREATED,
  SalesOrderLifecycleEventPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  CommercialOrderStatus,
  OrderAggregate,
  OrderFulfillmentStatus,
  OrderPaymentStatus,
  SalesDomainError,
  SalesDomainErrorCode,
  assertCanCancelOrder,
  formatQtyMillis,
  parseQtyMillis,
  validateOrderStateCombination,
} from '../../domain/sales-domain';
import {
  getSchemaPrefix,
  nextTenantDocumentCode,
} from '../../infrastructure/persistence/sales-code.generator';
import {
  OrderStatusHistoryEntity,
  OrderTenderEntity,
} from '../../infrastructure/persistence/sales.entities';
import { InventoryClient } from '../../inventory/inventory.client';
import { inventoryStockKey } from '../../inventory/stock-key';
import { OrderItemEntity } from '../../orders/entities/order-item.entity';
import { OrderEntity } from '../../orders/entities/order.entity';
import {
  BranchScope,
  assertBranchAllowed,
  branchAllowed,
  discountTierFor,
} from '../../presentation/access';
import { PosService } from '../pos/pos.service';
import { PromotionsService } from '../promotions/promotions.service';
import {
  CancelOrderDto,
  ConfirmOrderDto,
  CreateOmnichannelOrderDto,
  UpdateDraftOrderDto,
} from './m3-orders.dto';

function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The client's `version` against the stored one (409), when it sent one */
function assertVersion(
  order: { code: string; version?: number },
  version: number | undefined,
): void {
  if (version !== undefined && Number(order.version ?? 1) !== version) {
    throw new SalesDomainError(
      SalesDomainErrorCode.RESOURCE_VERSION_CONFLICT,
      `Order ${order.code} version mismatch (expected ${version}, actual ${order.version})`,
      409,
    );
  }
}

/** An order handed to the carrier is not cancelled: it comes back through a return */
function assertNotShipped(order: {
  fulfillmentStage?: string | null;
  code: string;
}): void {
  if (order.fulfillmentStage === 'SHIPPING') {
    throw new SalesDomainError(
      SalesDomainErrorCode.ORDER_INVALID_STATE,
      `Order ${order.code} is already shipped: use a return instead`,
      409,
    );
  }
}

/** What only the internal route (a trusted service) may ask for */
export interface OmnichannelOptions {
  /** `unitPriceOverride` of a line replaces the catalog price (marketplace price) */
  allowPriceOverride?: boolean;
  /** `sku_unmapped` or `stock_shortage`, stored on the order */
  exceptionCode?: string | null;
  /** A stock shortage on auto confirmation leaves the order pending and flags it, instead of a 409 */
  tolerateShortage?: boolean;
}

@Injectable()
export class M3OrdersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly posService: PosService,
    private readonly promotionsService: PromotionsService,
    private readonly inventoryClient: InventoryClient,
    private readonly outbox: EventOutbox,
  ) {}

  async createOmnichannelOrder(
    actorId: string,
    permissions: string[],
    scope: BranchScope,
    dto: CreateOmnichannelOrderDto,
    options: OmnichannelOptions = {},
  ) {
    assertBranchAllowed(
      scope,
      dto.branchId,
      'ORDER_NOT_FOUND',
      'Branch not found',
    );
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);

    // Check external marketplace idempotency first if (sourceConnectionId, externalOrderId) is provided
    if (dto.sourceConnectionId && dto.externalOrderId) {
      const existing = await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        return em.getRepository(OrderEntity).findOne({
          where: {
            tenantId,
            sourceConnectionId: dto.sourceConnectionId.trim(),
            externalOrderId: dto.externalOrderId.trim(),
          },
        });
      });
      if (existing) {
        const details = await this.getOrderDetails(existing.id, scope);
        return { ...details, replayed: true };
      }
    }

    const quote = await this.posService.resolveAndQuoteLines({
      branchId: dto.branchId,
      customerId: dto.customerId,
      lines: dto.lines,
      orderDiscountType: dto.orderDiscountType,
      orderDiscountValue: dto.orderDiscountValue,
      couponCode: dto.couponCode,
      shippingFee: dto.shippingFee,
      role: discountTierFor(permissions),
      permissions,
      allowPriceOverride: options.allowPriceOverride,
    });

    const initialStatus: CommercialOrderStatus = dto.initialStatus ?? 'PENDING';
    const paymentStatus: OrderPaymentStatus = 'UNPAID';
    const fulfillmentStatus: OrderFulfillmentStatus = 'UNFULFILLED';
    validateOrderStateCombination({
      orderStatus: initialStatus,
      paymentStatus,
      fulfillmentStatus,
    });

    let createdOrderId: string;
    try {
      createdOrderId = await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);

        const branchRows = await em.query(
          `SELECT status FROM ${prefix}"branch_projection" WHERE tenant_id = $1 AND branch_id = $2 LIMIT 1`,
          [tenantId, dto.branchId],
        );
        if (branchRows.length === 0 || branchRows[0].status !== 'active') {
          throw new SalesDomainError(
            SalesDomainErrorCode.UNKNOWN_BRANCH,
            `Branch ${dto.branchId} does not exist or is not active`,
            400,
          );
        }

        const orderId = randomUUID();
        const code = await nextTenantDocumentCode(em, tenantId, 'HD');
        const now = new Date();
        const grandTotalInt = quote.grandTotal;
        const itemCount = quote.lines.reduce(
          (sum, l) => sum + Math.max(1, Math.round(Number(l.qty))),
          0,
        );

        if (quote.couponCode) {
          const afterOrderDisc =
            quote.subtotal - quote.itemDiscountTotal - quote.orderDiscountTotal;
          await this.promotionsService.redeemCouponWithinTransaction(
            em,
            tenantId,
            quote.couponCode,
            afterOrderDisc,
            dto.branchId,
            dto.customerId ?? null,
            orderId,
          );
        }

        const order = em.create(OrderEntity, {
          id: orderId,
          tenantId,
          code,
          branchId: dto.branchId,
          warehouseId: dto.warehouseId ?? null,
          channelType: dto.channelType,
          channelId: dto.channelId ?? null,
          sourceConnectionId: dto.sourceConnectionId?.trim() ?? null,
          externalOrderId: dto.externalOrderId?.trim() ?? null,
          customerId: dto.customerId ?? null,
          customerName: dto.customerName ?? 'Omnichannel Customer',
          status: initialStatus.toLowerCase(),
          orderStatus: initialStatus,
          paymentStatus,
          fulfillmentStatus,
          paymentMethod: dto.paymentMethod ?? 'COD',
          subtotal: quote.subtotal,
          itemDiscountTotal: quote.itemDiscountTotal,
          orderDiscountType: quote.orderDiscountType,
          orderDiscountValue: quote.orderDiscountValue,
          orderDiscountTotal: quote.orderDiscountTotal,
          promotionDiscountTotal: quote.promotionDiscountTotal,
          couponCode: quote.couponCode,
          shippingFee: quote.shippingFee,
          taxTotal: quote.taxTotal,
          grandTotal: quote.grandTotal,
          paidAmount: 0,
          refundedAmount: 0,
          totalAmount: grandTotalInt,
          itemCount,
          note: dto.note ?? null,
          exceptionCode: options.exceptionCode ?? null,
          createdBy: actorId,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        await em.save(OrderEntity, order);

        const items = quote.lines.map((line) =>
          em.create(OrderItemEntity, {
            id: randomUUID(),
            tenantId,
            orderId,
            variantId: line.variantId,
            productId: line.productId,
            sku: line.skuCode,
            name: line.productName,
            variantLabel: line.variantLabel,
            unitCode: line.unitCode,
            conversionFactor: line.conversionFactor,
            quantity: Math.max(1, Math.round(Number(line.qty))),
            qty: line.qty,
            baseQty: line.baseQty,
            unitPrice: line.unitPrice,
            lineGross: line.lineGross,
            itemDiscountType: line.itemDiscountType,
            itemDiscountValue: line.itemDiscountValue,
            itemDiscountAmount: line.itemDiscountAmount,
            allocatedOrderDiscount: line.allocatedOrderDiscount,
            lineNet: line.lineNet,
            taxRate: line.taxRate,
            taxAmount: line.taxAmount,
            lineTotal: line.lineTotal,
            unitCostSnapshot: line.unitCostSnapshot,
            returnedQty: '0.000',
            refundedAmount: 0,
          }),
        );
        await em.save(OrderItemEntity, items);

        const history = em.create(OrderStatusHistoryEntity, {
          id: randomUUID(),
          tenantId,
          orderId,
          fromOrderStatus: null,
          toOrderStatus: initialStatus,
          fromPaymentStatus: null,
          toPaymentStatus: paymentStatus,
          fromFulfillmentStatus: null,
          toFulfillmentStatus: fulfillmentStatus,
          reason: `ORDER_CREATED_${dto.channelType}`,
          actorId,
          createdAt: now,
        });
        await em.save(OrderStatusHistoryEntity, history);

        await this.outbox.add(em, SALES_ORDER_CREATED, {
          orderId,
          code,
          branchId: dto.branchId,
          channelType: dto.channelType,
          orderStatus: initialStatus,
          paymentStatus,
          fulfillmentStatus,
          subtotal: quote.subtotal,
          discountTotal: quote.totalDiscount,
          taxTotal: quote.taxTotal,
          grandTotal: quote.grandTotal,
          actorId,
          occurredAt: now.toISOString(),
        } satisfies SalesOrderLifecycleEventPayload);

        return orderId;
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === '23505' &&
        dto.sourceConnectionId &&
        dto.externalOrderId
      ) {
        const raced = await this.dataSource.transaction(async (em) => {
          await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
            tenantId,
          ]);
          return em.getRepository(OrderEntity).findOne({
            where: {
              tenantId,
              sourceConnectionId: dto.sourceConnectionId!.trim(),
              externalOrderId: dto.externalOrderId!.trim(),
            },
          });
        });
        if (raced) {
          const details = await this.getOrderDetails(raced.id, scope);
          return { ...details, replayed: true };
        }
      }
      throw error;
    }

    const outcome = options.tolerateShortage
      ? { shortageDetected: false, shortages: [] as unknown[] }
      : {};
    if (dto.autoConfirm && dto.warehouseId) {
      try {
        const confirmed = await this.confirmOrder(
          createdOrderId,
          actorId,
          scope,
          {
            warehouseId: dto.warehouseId,
          },
        );
        return { ...confirmed, replayed: false, ...outcome };
      } catch (error) {
        if (
          !options.tolerateShortage ||
          !(error instanceof SalesDomainError) ||
          error.code !== SalesDomainErrorCode.INSUFFICIENT_STOCK
        ) {
          throw error;
        }
        await this.flagException(createdOrderId, 'stock_shortage');
        const pending = await this.getOrderDetails(createdOrderId, scope);
        const shortages = (error.details as { shortages?: unknown[] })
          ?.shortages;
        return {
          ...pending,
          replayed: false,
          shortageDetected: true,
          shortages: shortages ?? [],
        };
      }
    }

    const details = await this.getOrderDetails(createdOrderId, scope);
    return { ...details, replayed: false, ...outcome };
  }

  /** Marks an order that needs a human (marketplace orders the stock or the mapping cannot serve) */
  private async flagException(orderId: string, code: string): Promise<void> {
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);
    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      await em.query(
        `UPDATE ${prefix}"orders" SET exception_code = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, orderId, code],
      );
    });
  }

  async updateDraftOrder(
    orderId: string,
    actorId: string,
    permissions: string[],
    scope: BranchScope,
    dto: UpdateDraftOrderDto,
  ) {
    const tenantId = TenantContext.require();

    // Load current order first
    const current = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return em.getRepository(OrderEntity).findOne({
        where: { id: orderId, tenantId },
      });
    });

    if (!current || !branchAllowed(scope, current.branchId)) {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_NOT_FOUND,
        `Order ${orderId} not found`,
        404,
      );
    }

    if (current.orderStatus !== 'DRAFT' && current.orderStatus !== 'PENDING') {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_INVALID_STATE,
        `Order ${current.code} in status ${current.orderStatus} cannot be edited`,
        409,
      );
    }

    const nextQuote = dto.lines
      ? await this.posService.resolveAndQuoteLines({
          branchId: current.branchId,
          customerId: current.customerId,
          lines: dto.lines,
          orderDiscountType:
            dto.orderDiscountType ??
            (current.orderDiscountType as 'NONE' | 'FIXED' | 'PERCENT') ??
            'NONE',
          orderDiscountValue:
            dto.orderDiscountValue ?? Number(current.orderDiscountValue ?? 0),
          couponCode: current.couponCode,
          shippingFee: dto.shippingFee ?? Number(current.shippingFee ?? 0),
          role: discountTierFor(permissions),
          permissions,
        })
      : null;

    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const order = await em.getRepository(OrderEntity).findOne({
        where: { id: orderId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order || !branchAllowed(scope, order.branchId)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.ORDER_NOT_FOUND,
          `Order ${orderId} not found`,
          404,
        );
      }

      // `version` is the screen contract's name for `expectedVersion`
      const expectedVersion = dto.expectedVersion ?? dto.version;
      const lockedAgg = new OrderAggregate(
        order.id,
        tenantId,
        order.code,
        (order.orderStatus ?? 'DRAFT') as CommercialOrderStatus,
        (order.paymentStatus ?? 'UNPAID') as OrderPaymentStatus,
        (order.fulfillmentStatus ?? 'UNFULFILLED') as OrderFulfillmentStatus,
        Number(order.version ?? 1),
        order.warehouseId ?? null,
        order.reservationId ?? null,
      );
      lockedAgg.assertEditable(expectedVersion);

      if (dto.customerName !== undefined) order.customerName = dto.customerName;
      if (dto.note !== undefined) order.note = dto.note;

      if (nextQuote) {
        await em.getRepository(OrderItemEntity).delete({ tenantId, orderId });
        const newItems = nextQuote.lines.map((line) =>
          em.create(OrderItemEntity, {
            id: randomUUID(),
            tenantId,
            orderId,
            variantId: line.variantId,
            productId: line.productId,
            sku: line.skuCode,
            name: line.productName,
            variantLabel: line.variantLabel,
            unitCode: line.unitCode,
            conversionFactor: line.conversionFactor,
            quantity: Math.max(1, Math.round(Number(line.qty))),
            qty: line.qty,
            baseQty: line.baseQty,
            unitPrice: line.unitPrice,
            lineGross: line.lineGross,
            itemDiscountType: line.itemDiscountType,
            itemDiscountValue: line.itemDiscountValue,
            itemDiscountAmount: line.itemDiscountAmount,
            allocatedOrderDiscount: line.allocatedOrderDiscount,
            lineNet: line.lineNet,
            taxRate: line.taxRate,
            taxAmount: line.taxAmount,
            lineTotal: line.lineTotal,
            unitCostSnapshot: line.unitCostSnapshot,
            returnedQty: '0.000',
            refundedAmount: 0,
          }),
        );
        await em.save(OrderItemEntity, newItems);

        order.subtotal = nextQuote.subtotal;
        order.itemDiscountTotal = nextQuote.itemDiscountTotal;
        order.orderDiscountType = nextQuote.orderDiscountType;
        order.orderDiscountValue = nextQuote.orderDiscountValue;
        order.orderDiscountTotal = nextQuote.orderDiscountTotal;
        order.promotionDiscountTotal = nextQuote.promotionDiscountTotal;
        order.shippingFee = nextQuote.shippingFee;
        order.taxTotal = nextQuote.taxTotal;
        order.grandTotal = nextQuote.grandTotal;
        order.totalAmount = nextQuote.grandTotal;
        order.itemCount = nextQuote.lines.reduce(
          (sum, l) => sum + Math.max(1, Math.round(Number(l.qty))),
          0,
        );
      }

      order.version = lockedAgg.bumpVersion();
      order.updatedAt = new Date();
      await em.save(OrderEntity, order);
    });

    return this.getOrderDetails(orderId, scope);
  }

  async confirmOrder(
    orderId: string,
    actorId: string,
    scope: BranchScope,
    dto: ConfirmOrderDto,
  ) {
    const tenantId = TenantContext.require();

    const { order, items } = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const o = await em.getRepository(OrderEntity).findOne({
        where: { id: orderId, tenantId },
      });
      if (!o || !branchAllowed(scope, o.branchId)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.ORDER_NOT_FOUND,
          `Order ${orderId} not found`,
          404,
        );
      }
      const lineItems = await em.getRepository(OrderItemEntity).find({
        where: { orderId, tenantId },
      });
      return { order: o, items: lineItems };
    });

    if (order.orderStatus === 'CONFIRMED') {
      return this.getOrderDetails(orderId, scope);
    }

    assertVersion(order, dto.version);

    const preConfirmAgg = new OrderAggregate(
      order.id,
      tenantId,
      order.code,
      (order.orderStatus ?? 'PENDING') as CommercialOrderStatus,
      (order.paymentStatus ?? 'UNPAID') as OrderPaymentStatus,
      (order.fulfillmentStatus ?? 'UNFULFILLED') as OrderFulfillmentStatus,
      Number(order.version ?? 1),
    );
    preConfirmAgg.assertCanConfirm();

    const warehouseId = dto.warehouseId ?? order.warehouseId;
    if (!warehouseId) {
      throw new SalesDomainError(
        SalesDomainErrorCode.VALIDATION_ERROR,
        'warehouseId is required to confirm order and reserve stock',
        422,
      );
    }

    // Reserve stock in Inventory outside DB transaction
    const qtyBySku = new Map<string, bigint>();
    for (const item of items) {
      const skuKey = inventoryStockKey(item.variantId, item.sku);
      const prev = qtyBySku.get(skuKey) ?? 0n;
      const itemMillis = parseQtyMillis(
        item.baseQty ?? item.qty ?? item.quantity,
      );
      qtyBySku.set(skuKey, prev + itemMillis);
    }

    const rsvKey = deterministicUuid(`ord-confirm-rsv:${tenantId}:${orderId}`);
    const reserveResult = await this.inventoryClient.reserveWarehouseStock(
      rsvKey,
      {
        callerService: 'sales',
        sourceRefType: 'ORDER',
        sourceRefId: orderId,
        lines: Array.from(qtyBySku.entries()).map(([skuId, millis]) => ({
          warehouseId,
          skuId,
          qty: formatQtyMillis(millis),
        })),
      },
    );

    if (reserveResult.status === 'INSUFFICIENT_STOCK') {
      throw new SalesDomainError(
        SalesDomainErrorCode.INSUFFICIENT_STOCK,
        'Insufficient warehouse stock to confirm order',
        409,
        { shortages: reserveResult.shortages },
      );
    }

    const reservationId = reserveResult.reservation.reservationId;

    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const locked = await em.getRepository(OrderEntity).findOne({
        where: { id: orderId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) {
        throw new SalesDomainError(
          SalesDomainErrorCode.ORDER_NOT_FOUND,
          `Order ${orderId} not found`,
          404,
        );
      }
      if (locked.orderStatus === 'CONFIRMED') {
        return;
      }

      const aggregate = new OrderAggregate(
        locked.id,
        tenantId,
        locked.code,
        (locked.orderStatus ?? 'PENDING') as CommercialOrderStatus,
        (locked.paymentStatus ?? 'UNPAID') as OrderPaymentStatus,
        (locked.fulfillmentStatus ?? 'UNFULFILLED') as OrderFulfillmentStatus,
        Number(locked.version ?? 1),
        locked.warehouseId ?? null,
        locked.reservationId ?? null,
      );
      const transition = aggregate.confirmWithReservation(
        warehouseId,
        reservationId,
      );

      locked.warehouseId = aggregate.warehouseId;
      locked.status = aggregate.legacyStatus;
      locked.orderStatus = aggregate.orderStatus;
      locked.fulfillmentStatus = aggregate.fulfillmentStatus;
      locked.reservationId = aggregate.reservationId;
      locked.version = aggregate.version;
      locked.updatedAt = new Date();
      await em.save(OrderEntity, locked);

      const history = em.create(OrderStatusHistoryEntity, {
        id: randomUUID(),
        tenantId,
        orderId,
        fromOrderStatus: transition.fromOrderStatus,
        toOrderStatus: transition.toOrderStatus,
        fromPaymentStatus: transition.fromPaymentStatus,
        toPaymentStatus: transition.toPaymentStatus,
        fromFulfillmentStatus: transition.fromFulfillmentStatus,
        toFulfillmentStatus: transition.toFulfillmentStatus,
        reason: transition.reason,
        actorId,
        createdAt: new Date(),
      });
      await em.save(OrderStatusHistoryEntity, history);

      const totalDiscountVnd =
        (locked.itemDiscountTotal ?? 0) +
        (locked.orderDiscountTotal ?? 0) +
        (locked.promotionDiscountTotal ?? 0);
      await this.outbox.add(em, SALES_ORDER_CONFIRMED, {
        orderId,
        code: locked.code,
        branchId: locked.branchId,
        channelType: locked.channelType ?? 'MANUAL',
        orderStatus: aggregate.orderStatus,
        paymentStatus: aggregate.paymentStatus,
        fulfillmentStatus: aggregate.fulfillmentStatus,
        subtotal: locked.subtotal ?? 0,
        discountTotal: totalDiscountVnd,
        taxTotal: locked.taxTotal ?? 0,
        grandTotal: locked.grandTotal ?? 0,
        actorId,
        occurredAt: new Date().toISOString(),
      } satisfies SalesOrderLifecycleEventPayload);
    });

    return this.getOrderDetails(orderId, scope);
  }

  async cancelOrder(
    orderId: string,
    actorId: string,
    scope: BranchScope,
    dto: CancelOrderDto,
  ) {
    const tenantId = TenantContext.require();

    const order = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return em.getRepository(OrderEntity).findOne({
        where: { id: orderId, tenantId },
      });
    });

    if (!order || !branchAllowed(scope, order.branchId)) {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_NOT_FOUND,
        `Order ${orderId} not found`,
        404,
      );
    }

    if (order.orderStatus === 'CANCELLED') {
      return this.getOrderDetails(orderId, scope);
    }

    assertVersion(order, dto.version);
    assertNotShipped(order);

    assertCanCancelOrder({
      orderStatus: (order.orderStatus ?? 'COMPLETED') as CommercialOrderStatus,
      fulfillmentStatus: (order.fulfillmentStatus ??
        'FULFILLED') as OrderFulfillmentStatus,
    });

    // Release active warehouse reservation outside DB transaction first
    if (order.reservationId && order.fulfillmentStatus === 'RESERVED') {
      await this.inventoryClient.releaseWarehouseReservation(
        order.reservationId,
        dto.reason ?? 'ORDER_CANCELLED',
      );
    }

    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const locked = await em.getRepository(OrderEntity).findOne({
        where: { id: orderId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.orderStatus === 'CANCELLED') {
        return;
      }

      assertNotShipped(locked);
      const now = new Date();
      const aggregate = new OrderAggregate(
        locked.id,
        tenantId,
        locked.code,
        (locked.orderStatus ?? 'COMPLETED') as CommercialOrderStatus,
        (locked.paymentStatus ?? 'UNPAID') as OrderPaymentStatus,
        (locked.fulfillmentStatus ?? 'FULFILLED') as OrderFulfillmentStatus,
        Number(locked.version ?? 1),
        locked.warehouseId ?? null,
        locked.reservationId ?? null,
      );
      const transition = aggregate.cancel(dto.reason, now);

      await this.promotionsService.releaseCouponClaimWithinTransaction(
        em,
        tenantId,
        orderId,
      );

      locked.status = aggregate.legacyStatus;
      locked.orderStatus = aggregate.orderStatus;
      locked.fulfillmentStatus = aggregate.fulfillmentStatus;
      locked.fulfillmentStage = null;
      locked.cancelReason = aggregate.cancelReason;
      locked.cancelledAt = aggregate.cancelledAt;
      locked.version = aggregate.version;
      locked.updatedAt = now;
      await em.save(OrderEntity, locked);

      const history = em.create(OrderStatusHistoryEntity, {
        id: randomUUID(),
        tenantId,
        orderId,
        fromOrderStatus: transition.fromOrderStatus,
        toOrderStatus: transition.toOrderStatus,
        fromPaymentStatus: transition.fromPaymentStatus,
        toPaymentStatus: transition.toPaymentStatus,
        fromFulfillmentStatus: transition.fromFulfillmentStatus,
        toFulfillmentStatus: transition.toFulfillmentStatus,
        reason: transition.reason,
        actorId,
        createdAt: now,
      });
      await em.save(OrderStatusHistoryEntity, history);

      const totalDiscountVnd =
        (locked.itemDiscountTotal ?? 0) +
        (locked.orderDiscountTotal ?? 0) +
        (locked.promotionDiscountTotal ?? 0);
      await this.outbox.add(em, SALES_ORDER_CANCELLED, {
        orderId,
        code: locked.code,
        branchId: locked.branchId,
        channelType: locked.channelType ?? 'MANUAL',
        orderStatus: 'CANCELLED',
        paymentStatus: locked.paymentStatus ?? 'UNPAID',
        fulfillmentStatus: 'UNFULFILLED',
        subtotal: locked.subtotal ?? 0,
        discountTotal: totalDiscountVnd,
        taxTotal: locked.taxTotal ?? 0,
        grandTotal: locked.grandTotal ?? 0,
        actorId,
        occurredAt: now.toISOString(),
      } satisfies SalesOrderLifecycleEventPayload);
    });

    return this.getOrderDetails(orderId, scope);
  }

  async getOrderDetails(orderId: string, scope: BranchScope) {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const order = await em.getRepository(OrderEntity).findOne({
        where: { id: orderId, tenantId },
      });
      if (!order || !branchAllowed(scope, order.branchId)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.ORDER_NOT_FOUND,
          `Order ${orderId} not found`,
          404,
        );
      }

      const items = await em.getRepository(OrderItemEntity).find({
        where: { orderId, tenantId },
      });
      const tenders = await em.getRepository(OrderTenderEntity).find({
        where: { orderId, tenantId },
        order: { createdAt: 'ASC' },
      });
      const history = await em.getRepository(OrderStatusHistoryEntity).find({
        where: { orderId, tenantId },
        order: { createdAt: 'ASC' },
      });

      return {
        ...order,
        items,
        tenders,
        history,
      };
    });
  }

  async getOrderHistory(
    orderId: string,
    scope: BranchScope,
  ): Promise<OrderStatusHistoryEntity[]> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const order = await em.getRepository(OrderEntity).findOne({
        where: { id: orderId, tenantId },
      });
      if (!order || !branchAllowed(scope, order.branchId)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.ORDER_NOT_FOUND,
          `Order ${orderId} not found`,
          404,
        );
      }
      return em.getRepository(OrderStatusHistoryEntity).find({
        where: { orderId, tenantId },
        order: { createdAt: 'ASC' },
      });
    });
  }
}
