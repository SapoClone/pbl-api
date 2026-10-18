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

  // Tenant
  T001 = 'tenant.error.subdomain_exists',
  T002 = 'tenant.error.member_exists',
  T003 = 'tenant.error.owner_role_locked',

  // Branch
  B001 = 'branch.error.code_exists',
  B002 = 'branch.error.last_branch',
}
