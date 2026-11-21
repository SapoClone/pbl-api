/**
 * The fixed list of audit action codes and target types (v1.2 doc section 5). To add one, see
 * docs/guides/audit-log.md. The web maps a code to its label; the API returns codes only.
 */
export const AUDIT_ACTIONS = [
  'tenant.updated',
  'tenant.status_changed',
  'subscription.plan_changed',
  'account.sessions_revoked',
  'settings.changed',
  'admin.created',
  'admin.updated',
  'support_session.started',
  'support_session.ended',
  'announcement.sent',
  'integration.disconnected',
  // extension: an admin's edit of a plan (one platform-scope row per edit, not one per store on the plan)
  'plan.updated',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_TARGET_TYPES = [
  'tenant',
  'subscription',
  'account',
  'admin',
  'setting',
  'support_session',
  'announcement',
  'integration',
  'plan',
] as const;
