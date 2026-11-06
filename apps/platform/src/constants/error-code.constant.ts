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

  // Tenant
  T001 = 'tenant.error.subdomain_exists',
  T002 = 'tenant.error.member_exists',
  T003 = 'tenant.error.owner_role_locked',
  T004 = 'tenant.error.cannot_remove_self',
  T005 = 'tenant.error.owner_protected',
  T006 = 'tenant.error.already_suspended',
  T007 = 'tenant.error.not_suspended',
  T008 = 'tenant.error.owner_account_disabled',
  T023 = 'tenant.error.branch_not_found',

  // Plan and subscription (platform admin)
  P001 = 'plan.error.not_active',
  P002 = 'plan.error.code_exists',
  P003 = 'plan.error.not_found',
  S010 = 'subscription.error.quota_exceeded',
  S011 = 'subscription.error.same_plan_same_period',
  S012 = 'subscription.error.payment_overlaps',

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

  // Staff schedule
  S001 = 'schedule.error.overlap',
}
