import { Uuid } from '@/common/types/common.type';

/** Who is calling, derived from a verified access token (request['user']). */
export type AuthUser = {
  id: Uuid;
  sessionId: Uuid;
  subjectType: AccessTokenSubjectType;
  /** Expiry of the access token, seconds since epoch */
  exp: number;
};

export type AccessTokenSubjectType =
  | 'account'
  | 'staff'
  | 'platform_admin'
  | 'service';

/** Claims carried by an access token on the wire (see ADR-0004). */
export type AccessTokenClaims = {
  sub: string;
  sid: string;
  sub_type: AccessTokenSubjectType;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
};
