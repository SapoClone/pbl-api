import { Injectable } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import {
  INTEGRATION_EXTERNAL_ORDER_MAPPING_REQUIRED,
  INTEGRATION_SYNC_JOB_FAILED,
  INVENTORY_STOCK_BELOW_MIN,
  IntegrationExternalOrderEventPayload,
  IntegrationSyncJobEventPayload,
  MembershipEventPayload,
  OrderCompletedPayload,
  PLATFORM_MEMBERSHIP_GRANTED,
  SALES_ORDER_COMPLETED,
  StockBelowMinPayload,
} from '@pbl/contracts';
import { OnEvent } from '@pbl/events';
import { EntityManager } from 'typeorm';
import { NotificationsService } from './notifications.service';

const vnd = (amount: number) =>
  `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} đ`;

/** Turns events into notifications of the event's store */
@Injectable()
export class NotificationHandler {
  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(SALES_ORDER_COMPLETED.type)
  async onOrderCompleted(
    event: EventEnvelope<OrderCompletedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const order = event.payload;
    await this.notifications.create(
      {
        id: event.id,
        type: 'order',
        title: `Đơn hàng mới ${order.code}`,
        body: `${vnd(order.totalAmount)} · ${order.itemCount} sản phẩm`,
        refType: 'order',
        refId: order.orderId,
        branchId: order.branchId,
      },
      manager,
    );
  }

  @OnEvent(PLATFORM_MEMBERSHIP_GRANTED.type)
  async onMembershipGranted(
    event: EventEnvelope<MembershipEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { accountId, email, role } = event.payload;
    await this.notifications.create(
      {
        id: event.id,
        type: 'staff',
        title: `Nhân viên mới ${email}`,
        body: `${email} được cấp vai trò ${role}`,
        refType: 'account',
        refId: accountId,
      },
      manager,
    );
  }

  // ---- attention producers: warning and critical notifications feed `GET /attention-items`

  @OnEvent(INVENTORY_STOCK_BELOW_MIN.type)
  async onStockBelowMin(
    event: EventEnvelope<StockBelowMinPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    await this.notifications.create(
      {
        id: event.id,
        type: 'low_stock',
        severity: p.available <= 0 ? 'critical' : 'warning',
        title: `Sắp hết hàng ${p.sku ?? p.variantId}`,
        body: `${p.name ?? p.sku ?? p.variantId}: còn ${p.available}, tối thiểu ${p.minQuantity}`,
        refType: 'variant',
        refId: p.variantId,
        branchId: p.branchId,
      },
      manager,
    );
  }

  @OnEvent(INTEGRATION_EXTERNAL_ORDER_MAPPING_REQUIRED.type)
  async onMappingRequired(
    event: EventEnvelope<IntegrationExternalOrderEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    await this.notifications.create(
      {
        id: event.id,
        type: 'unmapped_sku',
        severity: 'warning',
        title: `Đơn ${p.externalOrderId} cần ghép SKU`,
        body: p.reason ?? `${p.provider}: đơn sàn chưa ghép được SKU`,
        refType: 'channel_order',
        refId: p.channelOrderRefId,
      },
      manager,
    );
  }

  @OnEvent(INTEGRATION_SYNC_JOB_FAILED.type)
  async onSyncJobFailed(
    event: EventEnvelope<IntegrationSyncJobEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    await this.notifications.create(
      {
        id: event.id,
        type: 'sync_failed',
        severity: 'critical',
        title: `Đồng bộ ${p.jobType} thất bại`,
        body: p.errorMessage ?? p.provider ?? null,
        refType: 'sync_job',
        refId: p.jobId,
      },
      manager,
    );
  }
}
