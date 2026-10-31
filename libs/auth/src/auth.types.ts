export type AccessTokenSubjectType =
  | 'account'
  | 'staff'
  | 'platform_admin'
  | 'service';

/** Claims carried by a platform-issued access token on the wire (ADR-0004). */
export type AccessTokenClaims = {
  sub: string;
  sid: string;
  sub_type: AccessTokenSubjectType;
  tid?: string;
  roles?: string[];
  /** Permission codes in the selected store; `['*']` = all (ADR-0012) */
  perms?: string[];
  /** Branch ids the member may act in; `['*']` = all */
  branches?: string[];
  iss: string;
  aud: string;
  iat: number;
  exp: number;
};

/** Who is calling, derived from a verified access token (request['user']). */
export type AuthUser = {
  id: string;
  sessionId: string;
  subjectType: AccessTokenSubjectType;
  /** Selected store (`tid` claim); absent until the caller selects one */
  tenantId?: string;
  /** Roles in the selected store (`roles` claim); [] without a store */
  roles: string[];
  /** Permission codes (`perms` claim); `['*']` = every permission */
  permissions: string[];
  /** Branch ids the member may act in (`branches` claim); `['*']` = every branch */
  branches: string[];
  /** Expiry of the access token, seconds since epoch */
  exp: number;
};

/**
 * `required`: protected routes need a token with `tid` unless marked
 * @TenantOptional(). `optional`: only @CurrentTenant()/@RequireRoles() need
 * one (platform, where account-level routes run before a store is chosen).
 */
export type TenantMode = 'required' | 'optional';

/** Finds the public key (PEM) that verifies tokens signed with `kid`. */
export interface KeyResolver {
  getPublicKey(kid: string): Promise<string>;
}

export interface PblAuthOptions {
  /** Expected "iss" claim — platform's AUTH_JWT_ISSUER */
  issuer: string;
  /** Expected "aud" claim — platform's AUTH_JWT_AUDIENCE */
  audience: string;
  keyResolver: KeyResolver;
  /**
   * Optional instant revocation (ADR-0004 §7), e.g. a logout deny-list.
   * Errors propagate: a failing store is an outage, not an unauthenticated
   * caller.
   */
  isSessionRevoked?: (user: AuthUser) => Promise<boolean>;
  /** Default 'required' (ADR-0008) */
  tenant?: TenantMode;
}
