import { Injectable } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import {
  MembershipEventPayload,
  OrderCompletedPayload,
  PLATFORM_MEMBERSHIP_GRANTED,
  SALES_ORDER_COMPLETED,
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
}
