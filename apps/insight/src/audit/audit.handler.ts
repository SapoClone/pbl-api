import { Injectable } from '@nestjs/common';
import { EventEnvelope, TenantScopedRepository } from '@pbl/common';
import {
  AccountLoggedInPayload,
  INVENTORY_PURCHASE_ORDER_APPROVED,
  MembershipEventPayload,
  OrderCompletedPayload,
  PLATFORM_ACCOUNT_LOGGED_IN,
  PLATFORM_MEMBERSHIP_GRANTED,
  PLATFORM_MEMBERSHIP_ROLE_CHANGED,
  PLATFORM_TENANT_CREATED,
  PLATFORM_TENANT_STATUS_CHANGED,
  PLATFORM_TENANT_UPDATED,
  PurchaseOrderApprovedPayload,
  SALES_ORDER_COMPLETED,
  TenantCreatedPayload,
  TenantStatusChangedPayload,
  TenantUpdatedPayload,
} from '@pbl/contracts';
import { OnEvent } from '@pbl/events';
import { EntityManager } from 'typeorm';
import { AuditLogEntity } from './audit-log.entity';

const actor = (type: string) =>
  type === 'platform_admin' ? 'a platform admin' : 'the store';

/** Turns the events of other services into audit log rows, in the event's tenant */
@Injectable()
export class AuditHandler {
  @OnEvent(PLATFORM_ACCOUNT_LOGGED_IN.type)
  onLogin(
    event: EventEnvelope<AccountLoggedInPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { accountId, role, method } = event.payload;
    const how =
      method === 'switch_tenant' ? 'switched to the store' : 'signed in';
    return this.record(
      manager,
      event,
      accountId,
      `Account ${accountId} ${how} as ${role}`,
    );
  }

  @OnEvent(PLATFORM_MEMBERSHIP_GRANTED.type)
  onGranted(
    event: EventEnvelope<MembershipEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { email, role, changedBy } = event.payload;
    return this.record(
      manager,
      event,
      changedBy,
      `${email} was given the ${role} role`,
    );
  }

  @OnEvent(PLATFORM_MEMBERSHIP_ROLE_CHANGED.type)
  onRoleChanged(
    event: EventEnvelope<MembershipEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { email, role, previousRole, changedBy } = event.payload;
    return this.record(
      manager,
      event,
      changedBy,
      `${email} changed from ${previousRole} to ${role}`,
    );
  }

  /** A store was opened, by its owner or by a platform admin (the payload says which) */
  @OnEvent(PLATFORM_TENANT_CREATED.type)
  onTenantCreated(
    event: EventEnvelope<TenantCreatedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { code, name, ownerEmail, createdBy, createdByType } = event.payload;
    return this.record(
      manager,
      event,
      createdBy,
      `Store ${code} (${name}) created for ${ownerEmail} by ${actor(createdByType)}`,
    );
  }

  /** The row keeps what changed, before and after, in `data.changes` */
  @OnEvent(PLATFORM_TENANT_UPDATED.type)
  onTenantUpdated(
    event: EventEnvelope<TenantUpdatedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { code, changes, changedBy, changedByType } = event.payload;
    return this.record(
      manager,
      event,
      changedBy,
      `Store ${code} edited by ${actor(changedByType)}: ${Object.keys(changes).join(', ')}`,
    );
  }

  @OnEvent(PLATFORM_TENANT_STATUS_CHANGED.type)
  onTenantStatusChanged(
    event: EventEnvelope<TenantStatusChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { code, from, to, reason, changedBy, changedByType } = event.payload;
    return this.record(
      manager,
      event,
      changedBy,
      `Store ${code} changed from ${from} to ${to} by ${actor(changedByType)}${reason ? `: ${reason}` : ''}`,
    );
  }

  @OnEvent(SALES_ORDER_COMPLETED.type)
  onOrderCompleted(
    event: EventEnvelope<OrderCompletedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { code, totalAmount, createdBy } = event.payload;
    return this.record(
      manager,
      event,
      createdBy,
      `Order ${code} completed for ${totalAmount} VND`,
    );
  }

  @OnEvent(INVENTORY_PURCHASE_ORDER_APPROVED.type)
  onPurchaseOrderApproved(
    event: EventEnvelope<PurchaseOrderApprovedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { code, totalAmount } = event.payload;
    return this.record(
      manager,
      event,
      null,
      `Purchase order ${code} approved for ${totalAmount} VND`,
    );
  }

  private async record(
    manager: EntityManager,
    event: EventEnvelope,
    actorId: string | null,
    summary: string,
  ): Promise<void> {
    const audit = TenantScopedRepository.forEntity(manager, AuditLogEntity);
    const row = new AuditLogEntity();
    row.id = event.id;
    row.type = event.type;
    row.actorId = actorId;
    row.summary = summary.slice(0, 300);
    row.data = event.payload as Record<string, unknown>;
    row.occurredAt = new Date(event.occurredAt);
    await audit.save(row);
  }
}
