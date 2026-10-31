import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { SALES_FULFILLMENT_COMPLETED } from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  SalesDomainError,
  SalesDomainErrorCode,
  formatQtyMillis,
  parseQtyMillis,
} from '../../domain/sales-domain';
import { nextTenantDocumentCode } from '../../infrastructure/persistence/sales-code.generator';
import {
  FulfillmentItemEntity,
  OrderFulfillmentEntity,
  OrderStatusHistoryEntity,
} from '../../infrastructure/persistence/sales.entities';
import { InventoryClient } from '../../inventory/inventory.client';
import { OrderItemEntity } from '../../orders/entities/order-item.entity';
import { OrderEntity } from '../../orders/entities/order.entity';
import { CreateFulfillmentDto } from './fulfillment.dto';

@Injectable()
export class FulfillmentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inventoryClient: InventoryClient,
    private readonly outbox: EventOutbox,
  ) {}

  async createFulfillment(
    orderId: string,
    actorId: string,
    dto: CreateFulfillmentDto,
  ) {
    const tenantId = TenantContext.require();

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const order = await em.getRepository(OrderEntity).findOne({
        where: { id: orderId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        throw new SalesDomainError(
          SalesDomainErrorCode.ORDER_NOT_FOUND,
          `Order ${orderId} not found`,
          404,
        );
      }
      if (order.orderStatus === 'CANCELLED' || order.orderStatus === 'DRAFT') {
        throw new SalesDomainError(
          SalesDomainErrorCode.FULFILLMENT_INVALID_STATE,
          `Cannot create fulfillment for order in status ${order.orderStatus}`,
          409,
        );
      }

      const orderItems = await em.getRepository(OrderItemEntity).find({
        where: { orderId, tenantId },
      });
      const itemMap = new Map(orderItems.map((i) => [i.id, i]));

      const fulfillmentId = randomUUID();
      const code = await nextTenantDocumentCode(em, tenantId, 'VD');
      const now = new Date();

      const fulfillment = em.create(OrderFulfillmentEntity, {
        id: fulfillmentId,
        tenantId,
        code,
        orderId: order.id,
        branchId: order.branchId,
        warehouseId: dto.warehouseId ?? order.warehouseId ?? null,
        reservationId: order.reservationId ?? null,
        fulfillmentType: dto.fulfillmentType ?? 'DELIVERY',
        status: 'PENDING',
        carrierCode: dto.carrierCode ?? null,
        trackingNumber: dto.trackingNumber ?? null,
        shippedAt: null,
        confirmedAt: null,
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      });
      await em.save(OrderFulfillmentEntity, fulfillment);

      const lineInputs =
        dto.items && dto.items.length > 0
          ? dto.items
          : orderItems.map((oi) => ({
              orderItemId: oi.id,
              qty: Number(oi.qty ?? oi.quantity),
            }));

      const fulfillmentItems: FulfillmentItemEntity[] = lineInputs.map((li) => {
        const orig = itemMap.get(li.orderItemId);
        if (!orig) {
          throw new SalesDomainError(
            SalesDomainErrorCode.VALIDATION_ERROR,
            `Order item ${li.orderItemId} does not belong to order ${order.code}`,
            422,
          );
        }
        return em.create(FulfillmentItemEntity, {
          id: randomUUID(),
          tenantId,
          fulfillmentId,
          orderItemId: orig.id,
          skuCode: orig.sku,
          qty: formatQtyMillis(parseQtyMillis(li.qty)),
        });
      });
      await em.save(FulfillmentItemEntity, fulfillmentItems);

      return {
        ...fulfillment,
        items: fulfillmentItems,
      };
    });
  }

  async listOrderFulfillments(orderId: string) {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const fulfillments = await em.getRepository(OrderFulfillmentEntity).find({
        where: { tenantId, orderId },
        order: { createdAt: 'ASC' },
      });
      const result = [];
      for (const f of fulfillments) {
        const items = await em.getRepository(FulfillmentItemEntity).find({
          where: { tenantId, fulfillmentId: f.id },
        });
        result.push({ ...f, items });
      }
      return result;
    });
  }

  async confirmFulfillment(fulfillmentId: string, actorId: string) {
    const tenantId = TenantContext.require();

    const { fulfillment, order } = await this.dataSource.transaction(
      async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        const f = await em.getRepository(OrderFulfillmentEntity).findOne({
          where: { id: fulfillmentId, tenantId },
        });
        if (!f) {
          throw new SalesDomainError(
            SalesDomainErrorCode.FULFILLMENT_NOT_FOUND,
            `Fulfillment ${fulfillmentId} not found`,
            404,
          );
        }
        const o = await em.getRepository(OrderEntity).findOne({
          where: { id: f.orderId, tenantId },
        });
        return { fulfillment: f, order: o };
      },
    );

    if (
      fulfillment.status === 'COMPLETED' ||
      fulfillment.status === 'DELIVERED'
    ) {
      const items = await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        return em.getRepository(FulfillmentItemEntity).find({
          where: { tenantId, fulfillmentId },
        });
      });
      return { ...fulfillment, items };
    }

    if (fulfillment.status === 'CANCELLED') {
      throw new SalesDomainError(
        SalesDomainErrorCode.FULFILLMENT_INVALID_STATE,
        'Cannot confirm a CANCELLED fulfillment',
        409,
      );
    }

    const reservationId =
      fulfillment.reservationId ?? order?.reservationId ?? null;
    if (reservationId && order?.fulfillmentStatus === 'RESERVED') {
      await this.inventoryClient.commitWarehouseReservation(reservationId);
    }

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const lockedF = await em.getRepository(OrderFulfillmentEntity).findOne({
        where: { id: fulfillmentId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedF) {
        throw new SalesDomainError(
          SalesDomainErrorCode.FULFILLMENT_NOT_FOUND,
          `Fulfillment ${fulfillmentId} not found`,
          404,
        );
      }

      const now = new Date();
      lockedF.status = 'COMPLETED';
      lockedF.shippedAt = lockedF.shippedAt ?? now;
      lockedF.confirmedAt = now;
      lockedF.updatedAt = now;
      await em.save(OrderFulfillmentEntity, lockedF);

      const lockedOrder = await em.getRepository(OrderEntity).findOne({
        where: { id: lockedF.orderId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (lockedOrder) {
        const prevOrderStatus = lockedOrder.orderStatus ?? 'CONFIRMED';
        const prevFulfillmentStatus =
          lockedOrder.fulfillmentStatus ?? 'RESERVED';
        lockedOrder.fulfillmentStatus = 'FULFILLED';
        if (lockedOrder.paymentStatus === 'PAID') {
          lockedOrder.orderStatus = 'COMPLETED';
          lockedOrder.status = 'completed';
          lockedOrder.completedAt = now;
        }
        lockedOrder.version = Number(lockedOrder.version ?? 1) + 1;
        lockedOrder.updatedAt = now;
        await em.save(OrderEntity, lockedOrder);

        const history = em.create(OrderStatusHistoryEntity, {
          id: randomUUID(),
          tenantId,
          orderId: lockedOrder.id,
          fromOrderStatus: prevOrderStatus,
          toOrderStatus: lockedOrder.orderStatus ?? prevOrderStatus,
          fromPaymentStatus: lockedOrder.paymentStatus ?? 'UNPAID',
          toPaymentStatus: lockedOrder.paymentStatus ?? 'UNPAID',
          fromFulfillmentStatus: prevFulfillmentStatus,
          toFulfillmentStatus: 'FULFILLED',
          reason: `FULFILLMENT_CONFIRMED:${lockedF.code}`,
          actorId,
          createdAt: now,
        });
        await em.save(OrderStatusHistoryEntity, history);

        await this.outbox.add(em, SALES_FULFILLMENT_COMPLETED, {
          fulfillmentId: lockedF.id,
          code: lockedF.code,
          orderId: lockedOrder.id,
          branchId: lockedOrder.branchId,
          warehouseId: lockedF.warehouseId,
          status: 'COMPLETED',
          occurredAt: now.toISOString(),
        });
      }

      const items = await em.getRepository(FulfillmentItemEntity).find({
        where: { tenantId, fulfillmentId: lockedF.id },
      });
      return {
        ...lockedF,
        items,
      };
    });
  }
}
