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
  /** Expiry of the access token, seconds since epoch */
  exp: number;
};

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
}
