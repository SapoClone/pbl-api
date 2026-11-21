import { Injectable } from '@nestjs/common';
import { EventEnvelope, PlatformEventEnvelope } from '@pbl/common';
import {
  AccountLoggedInPayload,
  AccountSessionsRevokedPayload,
  INTEGRATION_CONNECTION_DISCONNECTED,
  INVENTORY_PURCHASE_ORDER_APPROVED,
  IntegrationConnectionEventPayload,
  MembershipEventPayload,
  OrderCompletedPayload,
  PLATFORM_ACCOUNT_LOGGED_IN,
  PLATFORM_ACCOUNT_SESSIONS_REVOKED,
  PLATFORM_ADMIN_CREATED,
  PLATFORM_ADMIN_UPDATED,
  PLATFORM_MEMBERSHIP_GRANTED,
  PLATFORM_MEMBERSHIP_ROLE_CHANGED,
  PLATFORM_PLAN_CHANGED,
  PLATFORM_SETTINGS_CHANGED,
  PLATFORM_SUBSCRIPTION_CHANGED,
  PLATFORM_SUPPORT_SESSION_ENDED,
  PLATFORM_SUPPORT_SESSION_STARTED,
  PLATFORM_TENANT_CREATED,
  PLATFORM_TENANT_STATUS_CHANGED,
  PLATFORM_TENANT_UPDATED,
  PlanChangedPayload,
  PlatformActor,
  PlatformAdminEventPayload,
  PlatformSettingsChangedPayload,
  PurchaseOrderApprovedPayload,
  SALES_ORDER_COMPLETED,
  SubscriptionChangedPayload,
  SupportSessionEndedPayload,
  SupportSessionStartedPayload,
  TenantEventPayload,
  TenantStatusChangedPayload,
} from '@pbl/contracts';
import { OnEvent } from '@pbl/events';
import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';
import { AdminAuditEntry, AuditWriter } from './audit-writer.service';

type Actor = AdminAuditEntry['actor'];

/** The audit actor of an event payload's actor (`account` and `staff` are store members) */
function actorOf(
  actor:
    | { type?: string; id?: string | null; name?: string | null }
    | null
    | undefined,
): Actor {
  if (!actor) return { type: 'system' };
  const type =
    actor.type === 'platform_admin'
      ? 'platform_admin'
      : actor.type === 'account' || actor.type === 'staff'
        ? 'member'
        : actor.type === 'member'
          ? 'member'
          : actor.id
            ? 'member'
            : 'system';
  return { type, id: actor.id ?? null, name: actor.name ?? null };
}

/** A uuid derived from a key: the same key gives the same row id, so one logical action stays one row */
function uuidOf(key: string): string {
  const h = createHash('sha1').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Turns the events of other services into audit log rows (`AuditWriter`). A store event is written in the event's
 * store; a platform-scope event (`tenantId` null: settings, admins, sessions revoked) writes a platform-scope row.
 * The row id is the event's id, so a redelivered event writes nothing twice.
 */
@Injectable()
export class AuditHandler {
  constructor(private readonly writer: AuditWriter) {}

  // ---- store members (existing behaviour)

  @OnEvent(PLATFORM_ACCOUNT_LOGGED_IN.type)
  onLogin(
    event: EventEnvelope<AccountLoggedInPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { accountId, role, method } = event.payload;
    const how =
      method === 'switch_tenant' ? 'switched to the store' : 'signed in';
    return this.write(
      manager,
      event,
      {
        scope: 'tenant',
        tenantId: event.tenantId,
        actor: { type: 'member', id: accountId },
        action: 'account.logged_in',
        target: { type: 'account', id: accountId },
        result: 'success',
        data: { ...event.payload },
      },
      `Account ${accountId} ${how} as ${role}`,
    );
  }

  @OnEvent(PLATFORM_MEMBERSHIP_GRANTED.type)
  onGranted(
    event: EventEnvelope<MembershipEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { accountId, email, role, changedBy } = event.payload;
    return this.write(
      manager,
      event,
      {
        scope: 'tenant',
        tenantId: event.tenantId,
        actor: { type: 'member', id: changedBy },
        action: 'membership.granted',
        target: { type: 'account', id: accountId, name: email },
        result: 'success',
        data: { ...event.payload },
      },
      `${email} was given the ${role} role`,
    );
  }

  @OnEvent(PLATFORM_MEMBERSHIP_ROLE_CHANGED.type)
  onRoleChanged(
    event: EventEnvelope<MembershipEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { accountId, email, role, previousRole, changedBy } = event.payload;
    return this.write(
      manager,
      event,
      {
        scope: 'tenant',
        tenantId: event.tenantId,
        actor: { type: 'member', id: changedBy },
        action: 'membership.role_changed',
        target: { type: 'account', id: accountId, name: email },
        result: 'success',
        data: { ...event.payload },
      },
      `${email} changed from ${previousRole} to ${role}`,
    );
  }

  // ---- stores (platform admin or owner)

  @OnEvent(PLATFORM_TENANT_CREATED.type)
  onTenantCreated(
    event: EventEnvelope<TenantEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { id, code, name, actor } = event.payload;
    return this.write(
      manager,
      event,
      {
        scope: 'tenant',
        tenantId: event.tenantId,
        actor: actorOf(actor),
        action: 'tenant.created',
        target: { type: 'tenant', id, name: code },
        result: 'success',
        data: { ...event.payload, tenantName: name },
      },
      `Store ${code} (${name}) was created`,
    );
  }

  @OnEvent(PLATFORM_TENANT_UPDATED.type)
  onTenantUpdated(
    event: EventEnvelope<TenantEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { id, code, name, actor, changes } = event.payload;
    const fields = Object.keys(changes ?? {}).join(', ');
    return this.write(
      manager,
      event,
      {
        scope: 'tenant',
        tenantId: event.tenantId,
        actor: actorOf(actor),
        action: 'tenant.updated',
        target: { type: 'tenant', id, name: code },
        result: 'success',
        data: { ...event.payload, tenantName: name },
      },
      `Store ${code} was edited${fields ? ` (${fields})` : ''}`,
    );
  }

  @OnEvent(PLATFORM_TENANT_STATUS_CHANGED.type)
  onTenantStatusChanged(
    event: EventEnvelope<TenantStatusChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { tenantId, tenantName, tenantCode, from, to, reason, changedBy } =
      event.payload;
    return this.write(
      manager,
      event,
      {
        scope: 'tenant',
        tenantId: event.tenantId,
        actor: actorOf(changedBy),
        action: 'tenant.status_changed',
        target: { type: 'tenant', id: tenantId, name: tenantCode ?? null },
        result: 'success',
        data: { ...event.payload, ...(tenantName ? { tenantName } : {}) },
      },
      `Store changed from ${from} to ${to}${reason ? `: ${reason}` : ''}`,
    );
  }

  // ---- subscriptions and plans

  @OnEvent(PLATFORM_SUBSCRIPTION_CHANGED.type)
  onSubscriptionChanged(
    event: EventEnvelope<SubscriptionChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    // a first plan (store creation is audited as tenant.created), a past-due notice and a resync are not plan changes
    if (
      p.eventType === 'created' ||
      p.eventType === 'past_due' ||
      p.eventType === 'resync'
    ) {
      return Promise.resolve();
    }
    return this.write(
      manager,
      event,
      {
        scope: 'tenant',
        tenantId: event.tenantId,
        actor: actorOf(p.actor),
        action: 'subscription.plan_changed',
        target: {
          type: 'subscription',
          id: p.subscriptionId,
          name: p.tenantCode ?? null,
        },
        result: 'success',
        data: {
          eventType: p.eventType,
          fromPlan: p.fromPlan,
          toPlan: p.toPlan,
          expiresAt: p.expiresAt,
          ...(p.tenantName ? { tenantName: p.tenantName } : {}),
        },
      },
      `Plan ${p.fromPlan ?? '-'} -> ${p.toPlan} (${p.eventType})`,
    );
  }

  /**
   * Platform emits this once per store on the plan (catalog needs it per store), so the row id comes from the plan and
   * its update time: the first copy writes the one platform-scope row, the others hit the same id.
   */
  @OnEvent(PLATFORM_PLAN_CHANGED.type)
  onPlanChanged(
    event: EventEnvelope<PlanChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    // only an admin's edit; the resync script re-announces plans with a system actor and no changes
    if (p.actor?.type !== 'platform_admin' || !p.changes) {
      return Promise.resolve();
    }
    return this.writer.recordIn(
      manager,
      {
        occurredAt: new Date(event.occurredAt),
        scope: 'platform',
        tenantId: null,
        actor: actorOf(p.actor),
        action: 'plan.updated',
        target: { type: 'plan', id: p.planId, name: p.code },
        result: 'success',
        data: { changes: p.changes, status: p.status, quotas: p.quotas },
      },
      {
        id: uuidOf(`plan:${p.planId}:${p.updatedAt}`),
        eventType: event.type,
        summary: `Plan ${p.code} was edited`,
      },
    );
  }

  // ---- platform scope (tenantId null)

  @OnEvent(PLATFORM_ADMIN_CREATED.type)
  onAdminCreated(
    event: PlatformEventEnvelope<PlatformAdminEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    return this.onAdminEvent(event, manager, 'admin.created');
  }

  @OnEvent(PLATFORM_ADMIN_UPDATED.type)
  onAdminUpdated(
    event: PlatformEventEnvelope<PlatformAdminEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    return this.onAdminEvent(event, manager, 'admin.updated');
  }

  @OnEvent(PLATFORM_SETTINGS_CHANGED.type)
  onSettingsChanged(
    event: PlatformEventEnvelope<PlatformSettingsChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { actor, keys, changes } = event.payload;
    return this.writer.recordIn(
      manager,
      {
        occurredAt: new Date(event.occurredAt),
        scope: 'platform',
        tenantId: null,
        actor: actorOf(actor),
        action: 'settings.changed',
        target: { type: 'setting', id: keys[0] ?? null, name: keys.join(', ') },
        result: 'success',
        data: { keys, changes },
      },
      {
        id: event.id,
        eventType: event.type,
        summary: `Settings changed: ${keys.join(', ')}`,
      },
    );
  }

  @OnEvent(PLATFORM_ACCOUNT_SESSIONS_REVOKED.type)
  onSessionsRevoked(
    event: PlatformEventEnvelope<AccountSessionsRevokedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { actor, target, revokedCount } = event.payload;
    return this.writer.recordIn(
      manager,
      {
        occurredAt: new Date(event.occurredAt),
        scope: 'platform',
        tenantId: null,
        actor: actorOf(actor),
        action: 'account.sessions_revoked',
        target: { type: 'account', id: target.id, name: target.name },
        result: 'success',
        data: { revokedCount, email: target.email },
      },
      {
        id: event.id,
        eventType: event.type,
        summary: `Sessions of ${target.email} were revoked (${revokedCount})`,
      },
    );
  }

  // ---- support sessions (tenant-scoped: the store being looked at)

  @OnEvent(PLATFORM_SUPPORT_SESSION_STARTED.type)
  onSupportSessionStarted(
    event: EventEnvelope<SupportSessionStartedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    return this.write(
      manager,
      event,
      {
        scope: 'tenant',
        tenantId: event.tenantId,
        actor: { type: 'platform_admin', id: p.adminId, name: p.adminName },
        action: 'support_session.started',
        target: { type: 'support_session', id: p.sessionId, name: p.code },
        result: 'success',
        data: {
          reason: p.reason,
          expiresAt: p.expiresAt,
          tenantName: p.tenantName,
        },
      },
      `Support session ${p.code} started: ${p.reason}`,
    );
  }

  @OnEvent(PLATFORM_SUPPORT_SESSION_ENDED.type)
  onSupportSessionEnded(
    event: EventEnvelope<SupportSessionEndedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    // an expiry is the system's doing; an admin ending it is theirs
    const actor: Actor =
      p.endedBy === 'admin'
        ? { type: 'platform_admin', id: p.adminId, name: p.adminName }
        : { type: 'system' };
    return this.write(
      manager,
      event,
      {
        scope: 'tenant',
        tenantId: event.tenantId,
        actor,
        action: 'support_session.ended',
        target: { type: 'support_session', id: p.sessionId, name: p.code },
        result: 'success',
        data: { endedBy: p.endedBy, endedAt: p.endedAt, adminId: p.adminId },
      },
      `Support session ${p.code} ended (${p.endedBy})`,
    );
  }

  // ---- integration

  @OnEvent(INTEGRATION_CONNECTION_DISCONNECTED.type)
  onConnectionDisconnected(
    event: EventEnvelope<IntegrationConnectionEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    // an admin names themselves in the payload; a store member is the request's actor on the envelope
    const actor = p.actor
      ? actorOf(p.actor)
      : actorOf(event.actor as PlatformActor | null);
    return this.write(
      manager,
      event,
      {
        scope: 'tenant',
        tenantId: event.tenantId,
        actor,
        action: 'integration.disconnected',
        target: { type: 'integration', id: p.connectionId, name: p.shopName },
        result: 'success',
        data: {
          provider: p.provider,
          reason: p.reason ?? null,
          branchId: p.branchId,
        },
      },
      `${p.provider} connection ${p.shopName} was disconnected${p.reason ? `: ${p.reason}` : ''}`,
    );
  }

  // ---- sales and inventory (existing behaviour)

  @OnEvent(SALES_ORDER_COMPLETED.type)
  onOrderCompleted(
    event: EventEnvelope<OrderCompletedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { code, totalAmount, createdBy } = event.payload;
    return this.write(
      manager,
      event,
      {
        scope: 'tenant',
        tenantId: event.tenantId,
        actor: actorOf(createdBy ? { id: createdBy, type: 'member' } : null),
        action: 'order.completed',
        target: { type: 'order', id: event.payload.orderId, name: code },
        result: 'success',
        data: { ...event.payload },
      },
      `Order ${code} completed for ${totalAmount} VND`,
    );
  }

  @OnEvent(INVENTORY_PURCHASE_ORDER_APPROVED.type)
  onPurchaseOrderApproved(
    event: EventEnvelope<PurchaseOrderApprovedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { code, totalAmount } = event.payload;
    return this.write(
      manager,
      event,
      {
        scope: 'tenant',
        tenantId: event.tenantId,
        actor: { type: 'system' },
        action: 'purchase_order.approved',
        target: { type: 'purchase_order', name: code },
        result: 'success',
        data: { ...event.payload },
      },
      `Purchase order ${code} approved for ${totalAmount} VND`,
    );
  }

  // ---- helpers

  private onAdminEvent(
    event: PlatformEventEnvelope<PlatformAdminEventPayload>,
    manager: EntityManager,
    action: 'admin.created' | 'admin.updated',
  ): Promise<void> {
    const { actor, target, changes } = event.payload;
    return this.writer.recordIn(
      manager,
      {
        occurredAt: new Date(event.occurredAt),
        scope: 'platform',
        tenantId: null,
        actor: actorOf(actor),
        action,
        target: { type: 'admin', id: target.id, name: target.name },
        result: 'success',
        data: {
          email: target.email,
          role: target.role,
          status: target.status,
          ...(changes ? { changes } : {}),
        },
      },
      {
        id: event.id,
        eventType: event.type,
        summary:
          action === 'admin.created'
            ? `Admin ${target.email} was created`
            : `Admin ${target.email} was edited`,
      },
    );
  }

  /** A store-scope row: the event id is the row id, the event's time its time */
  private write(
    manager: EntityManager,
    event: EventEnvelope,
    entry: AdminAuditEntry,
    summary: string,
  ): Promise<void> {
    return this.writer.recordIn(
      manager,
      { ...entry, occurredAt: new Date(event.occurredAt) },
      { id: event.id, eventType: event.type, summary },
    );
  }
}
