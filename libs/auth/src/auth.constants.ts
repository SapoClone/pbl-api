export const IS_PUBLIC = 'isPublic';
export const IS_AUTH_OPTIONAL = 'isAuthOptional';
export const IS_TENANT_OPTIONAL = 'isTenantOptional';
export const REQUIRED_ROLES = 'requiredRoles';
export const PBL_AUTH_OPTIONS = Symbol('PBL_AUTH_OPTIONS');
/** The only algorithm accepted for access tokens — never taken from the token */
export const ACCESS_TOKEN_ALGORITHM = 'RS256';
/** Logout/switch deny-list written by platform; read by every service (ADR-0004 §7) */
export const SESSION_DENY_LIST_KEY_PREFIX = 'auth:session-blacklist:';
export const sessionDenyListKey = (sessionId: string) =>
  `${SESSION_DENY_LIST_KEY_PREFIX}${sessionId}`;
