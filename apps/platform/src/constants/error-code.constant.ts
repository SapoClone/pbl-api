export enum ErrorCode {
  // Common Validation
  V000 = 'common.validation.error',

  // Validation
  V001 = 'user.validation.is_empty',
  V002 = 'user.validation.is_invalid',

  // Error
  E001 = 'user.error.username_or_email_exists',
  E002 = 'user.error.not_found',
  E003 = 'user.error.email_exists',
  E010 = 'user.error.account_locked',
  E015 = 'user.error.current_password_wrong',

  // Platform admin (ADR-0022)
  A001 = 'admin.error.wrong_credentials',
  A003 = 'admin.error.account_locked',
  A010 = 'admin.error.email_taken',
  A011 = 'admin.error.protected_admin',

  // Tenant
  T001 = 'tenant.error.subdomain_exists',
  T002 = 'tenant.error.member_exists',
  T003 = 'tenant.error.owner_role_locked',
  T004 = 'tenant.error.cannot_remove_self',
  T005 = 'tenant.error.owner_protected',
  T006 = 'tenant.error.already_suspended',
  T007 = 'tenant.error.not_suspended',
  T008 = 'tenant.error.owner_account_disabled',
  T009 = 'tenant.error.store_limit',
  T010 = 'tenant.error.member_blocked',
  T023 = 'tenant.error.branch_not_found',

  // Plan and subscription (platform admin)
  P001 = 'plan.error.not_active',
  P002 = 'plan.error.code_exists',
  P003 = 'plan.error.not_found',
  S010 = 'subscription.error.quota_exceeded',
  S011 = 'subscription.error.same_plan_same_period',
  S012 = 'subscription.error.payment_overlaps',
  S013 = 'subscription.error.payment_not_allowed',
  S014 = 'subscription.error.payment_note_required',

  // Plan limit reached (409): the store must move to a bigger plan
  Q001 = 'quota.error.limit_reached',

  // Role
  R001 = 'role.error.name_exists',
  R002 = 'role.error.owner_immutable',
  R003 = 'role.error.unknown_permission',
  R004 = 'role.error.seeded_not_deletable',
  R005 = 'role.error.in_use',
  R006 = 'role.error.not_found',
  R007 = 'role.error.unknown_for_member',
  R008 = 'role.error.owner_not_assignable',

  // Branch
  B001 = 'branch.error.code_exists',
  B002 = 'branch.error.last_branch',
  B004 = 'branch.error.not_inactive',
  // deactivate or delete refused: `details.reasons` lists every reason of every service
  B005 = 'branch.error.blocked',
  B006 = 'branch.error.invoice_prefix_exists',
  B007 = 'branch.error.code_immutable',
  B008 = 'branch.error.scope_restricted',
  // a service that owns branch data could not be asked: fail closed (503)
  B009 = 'branch.error.service_unavailable',

  // Staff schedule
  S001 = 'schedule.error.overlap',
}
