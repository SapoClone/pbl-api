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
  OrderFulfillmentStatus,
  OrderPaymentStatus,
  SalesDomainError,
  SalesDomainErrorCode,
  assertCanCancelOrder,
  formatQtyMillis,
  formatVnd,
  parseQtyMillis,
  parseVndAmount,
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
        const grandTotalInt = Number(parseVndAmount(quote.grandTotal, true));
        const itemCount = quote.lines.reduce(
          (sum, l) => sum + Math.max(1, Math.round(Number(l.qty))),
          0,
        );

        if (quote.couponCode) {
          const subtotalVnd = parseVndAmount(quote.subtotal, true);
          const itemDiscVnd = parseVndAmount(quote.itemDiscountTotal, true);
          const orderDiscVnd = parseVndAmount(quote.orderDiscountTotal, true);
          const afterOrderDisc = formatVnd(
            subtotalVnd - itemDiscVnd - orderDiscVnd,
          );
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
          paidAmount: '0.00',
          refundedAmount: '0.00',
          totalAmount: grandTotalInt,
          itemCount,
          note: dto.note ?? null,
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
            unitPrice: Number(parseVndAmount(line.unitPrice, true)),
            lineGross: line.lineGross,
            itemDiscountType: line.itemDiscountType,
            itemDiscountValue: line.itemDiscountValue,
            itemDiscountAmount: line.itemDiscountAmount,
            allocatedOrderDiscount: line.allocatedOrderDiscount,
            lineNet: line.lineNet,
            taxRate: line.taxRate,
            taxAmount: line.taxAmount,
            lineTotal: Number(parseVndAmount(line.lineTotal, true)),
            unitCostSnapshot: line.unitCostSnapshot,
            returnedQty: '0.000',
            refundedAmount: '0.00',
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

    if (dto.autoConfirm && dto.warehouseId) {
      const confirmed = await this.confirmOrder(
        createdOrderId,
        actorId,
        scope,
        {
          warehouseId: dto.warehouseId,
        },
      );
      return { ...confirmed, replayed: false };
    }

    const details = await this.getOrderDetails(createdOrderId, scope);
    return { ...details, replayed: false };
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

      if (
        dto.expectedVersion !== undefined &&
        Number(order.version ?? 1) !== dto.expectedVersion
      ) {
        throw new SalesDomainError(
          SalesDomainErrorCode.RESOURCE_VERSION_CONFLICT,
          `Order ${order.code} version mismatch (expected ${dto.expectedVersion}, actual ${order.version})`,
          409,
        );
      }

      if (order.orderStatus !== 'DRAFT' && order.orderStatus !== 'PENDING') {
        throw new SalesDomainError(
          SalesDomainErrorCode.ORDER_INVALID_STATE,
          `Order ${order.code} in status ${order.orderStatus} cannot be edited`,
          409,
        );
      }

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
            unitPrice: Number(parseVndAmount(line.unitPrice, true)),
            lineGross: line.lineGross,
            itemDiscountType: line.itemDiscountType,
            itemDiscountValue: line.itemDiscountValue,
            itemDiscountAmount: line.itemDiscountAmount,
            allocatedOrderDiscount: line.allocatedOrderDiscount,
            lineNet: line.lineNet,
            taxRate: line.taxRate,
            taxAmount: line.taxAmount,
            lineTotal: Number(parseVndAmount(line.lineTotal, true)),
            unitCostSnapshot: line.unitCostSnapshot,
            returnedQty: '0.000',
            refundedAmount: '0.00',
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
        order.totalAmount = Number(parseVndAmount(nextQuote.grandTotal, true));
        order.itemCount = nextQuote.lines.reduce(
          (sum, l) => sum + Math.max(1, Math.round(Number(l.qty))),
          0,
        );
      }

      order.version = Number(order.version ?? 1) + 1;
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

    if (order.orderStatus !== 'DRAFT' && order.orderStatus !== 'PENDING') {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_INVALID_STATE,
        `Cannot confirm order in status ${order.orderStatus}`,
        409,
      );
    }

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
      const prev = qtyBySku.get(item.sku) ?? 0n;
      const itemMillis = parseQtyMillis(
        item.baseQty ?? item.qty ?? item.quantity,
      );
      qtyBySku.set(item.sku, prev + itemMillis);
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

      const prevOrderStatus = locked.orderStatus ?? 'PENDING';
      const prevFulfillmentStatus = locked.fulfillmentStatus ?? 'UNFULFILLED';
      locked.warehouseId = warehouseId;
      locked.status = 'confirmed';
      locked.orderStatus = 'CONFIRMED';
      locked.fulfillmentStatus = 'RESERVED';
      locked.reservationId = reservationId;
      locked.version = Number(locked.version ?? 1) + 1;
      locked.updatedAt = new Date();
      await em.save(OrderEntity, locked);

      const history = em.create(OrderStatusHistoryEntity, {
        id: randomUUID(),
        tenantId,
        orderId,
        fromOrderStatus: prevOrderStatus,
        toOrderStatus: 'CONFIRMED',
        fromPaymentStatus: locked.paymentStatus ?? 'UNPAID',
        toPaymentStatus: locked.paymentStatus ?? 'UNPAID',
        fromFulfillmentStatus: prevFulfillmentStatus,
        toFulfillmentStatus: 'RESERVED',
        reason: 'ORDER_CONFIRMED_AND_RESERVED',
        actorId,
        createdAt: new Date(),
      });
      await em.save(OrderStatusHistoryEntity, history);

      const totalDiscountVnd = formatVnd(
        parseVndAmount(locked.itemDiscountTotal, true) +
          parseVndAmount(locked.orderDiscountTotal, true) +
          parseVndAmount(locked.promotionDiscountTotal, true),
      );
      await this.outbox.add(em, SALES_ORDER_CONFIRMED, {
        orderId,
        code: locked.code,
        branchId: locked.branchId,
        channelType: locked.channelType ?? 'MANUAL',
        orderStatus: 'CONFIRMED',
        paymentStatus: locked.paymentStatus ?? 'UNPAID',
        fulfillmentStatus: 'RESERVED',
        subtotal: locked.subtotal ?? '0.00',
        discountTotal: totalDiscountVnd,
        taxTotal: locked.taxTotal ?? '0.00',
        grandTotal: locked.grandTotal ?? '0.00',
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

      assertCanCancelOrder({
        orderStatus: (locked.orderStatus ??
          'COMPLETED') as CommercialOrderStatus,
        fulfillmentStatus: (locked.fulfillmentStatus ??
          'FULFILLED') as OrderFulfillmentStatus,
      });

      await this.promotionsService.releaseCouponClaimWithinTransaction(
        em,
        tenantId,
        orderId,
      );

      const prevOrderStatus = locked.orderStatus ?? 'PENDING';
      const prevFulfillmentStatus = locked.fulfillmentStatus ?? 'UNFULFILLED';
      const now = new Date();

      locked.status = 'cancelled';
      locked.orderStatus = 'CANCELLED';
      locked.fulfillmentStatus = 'UNFULFILLED';
      locked.cancelReason = dto.reason ?? 'CANCELLED_BY_USER';
      locked.cancelledAt = now;
      locked.version = Number(locked.version ?? 1) + 1;
      locked.updatedAt = now;
      await em.save(OrderEntity, locked);

      const history = em.create(OrderStatusHistoryEntity, {
        id: randomUUID(),
        tenantId,
        orderId,
        fromOrderStatus: prevOrderStatus,
        toOrderStatus: 'CANCELLED',
        fromPaymentStatus: locked.paymentStatus ?? 'UNPAID',
        toPaymentStatus: locked.paymentStatus ?? 'UNPAID',
        fromFulfillmentStatus: prevFulfillmentStatus,
        toFulfillmentStatus: 'UNFULFILLED',
        reason: dto.reason ?? 'ORDER_CANCELLED',
        actorId,
        createdAt: now,
      });
      await em.save(OrderStatusHistoryEntity, history);

      const totalDiscountVnd = formatVnd(
        parseVndAmount(locked.itemDiscountTotal, true) +
          parseVndAmount(locked.orderDiscountTotal, true) +
          parseVndAmount(locked.promotionDiscountTotal, true),
      );
      await this.outbox.add(em, SALES_ORDER_CANCELLED, {
        orderId,
        code: locked.code,
        branchId: locked.branchId,
        channelType: locked.channelType ?? 'MANUAL',
        orderStatus: 'CANCELLED',
        paymentStatus: locked.paymentStatus ?? 'UNPAID',
        fulfillmentStatus: 'UNFULFILLED',
        subtotal: locked.subtotal ?? '0.00',
        discountTotal: totalDiscountVnd,
        taxTotal: locked.taxTotal ?? '0.00',
        grandTotal: locked.grandTotal ?? '0.00',
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
