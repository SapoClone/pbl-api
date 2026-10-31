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

  // Tenant
  T001 = 'tenant.error.subdomain_exists',
  T002 = 'tenant.error.member_exists',
  T003 = 'tenant.error.owner_role_locked',
  T004 = 'tenant.error.cannot_remove_self',
  T005 = 'tenant.error.owner_protected',
  T023 = 'tenant.error.branch_not_found',

  // Branch
  B001 = 'branch.error.code_exists',
  B002 = 'branch.error.last_branch',

  // Staff schedule
  S001 = 'schedule.error.overlap',
}
