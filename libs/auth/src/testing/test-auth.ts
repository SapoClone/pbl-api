import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'crypto';
import { AccessTokenSubjectType, PblAuthOptions } from '../auth.types';

export interface TestTokenClaims {
  sub?: string;
  /** Default `account`; `platform_admin` makes a platform-admin token (no store, no permissions) */
  subjectType?: AccessTokenSubjectType;
  /** The store; omit for a token without one */
  tid?: string;
  roles?: string[];
  /** Permission codes; default `['*']` when roles contain 'owner', else none */
  permissions?: string[];
  /** Branch ids; default `['*']` (every branch) */
  branches?: string[];
}

/**
 * For tests of an app's routes with the real AuthGuard: a throwaway RSA key, the
 * options that make PblAuthModule trust it, and a function that signs tokens the
 * way platform does. Not part of the library's public API (`@pbl/auth/testing`) and
 * excluded from its build. Issuer and audience are the defaults of
 * `PblAuthModule.forRemoteJwks()` (`platform`, `pbl6`).
 *
 *   const auth = createTestAuth();
 *   PblAuthModule.forRootAsync({ useFactory: () => auth.options })
 *   request(app).get('/x').set('Authorization', `Bearer ${auth.token({ tid, roles: ['cashier'] })}`)
 */
export function createTestAuth() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const publicPem = publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const privatePem = privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const jwt = new JwtService();

  const options: PblAuthOptions = {
    issuer: 'platform',
    audience: 'pbl6',
    tenant: 'required',
    keyResolver: { getPublicKey: async () => publicPem },
  };

  return {
    options,
    /** `Bearer <token>`, ready for an Authorization header */
    bearer(roles: string[], tid?: string): string {
      return `Bearer ${this.token({ roles, tid })}`;
    },
    /** `Bearer <token>` for a role holding exactly these permissions (and branches) */
    bearerWithPermissions(
      role: string,
      permissions: string[],
      tid?: string,
      branches?: string[],
    ): string {
      return `Bearer ${this.token({ roles: [role], permissions, tid, branches })}`;
    },
    /** `Bearer <token>` for a platform admin of this role: no store, no permissions (ADR-0022) */
    adminBearer(role: 'super_admin' | 'admin' = 'admin'): string {
      return `Bearer ${this.token({ subjectType: 'platform_admin', roles: [role] })}`;
    },
    token(claims: TestTokenClaims = {}): string {
      const roles = claims.roles ?? [];
      return jwt.sign(
        {
          sub: claims.sub ?? 'account-1',
          sid: 'session-1',
          sub_type: claims.subjectType ?? 'account',
          ...(claims.tid ? { tid: claims.tid } : {}),
          roles,
          perms: claims.permissions ?? (roles.includes('owner') ? ['*'] : []),
          branches: claims.branches ?? ['*'],
        },
        {
          privateKey: privatePem,
          algorithm: 'RS256',
          keyid: 'test-key',
          issuer: 'platform',
          audience: 'pbl6',
          expiresIn: '1h',
        },
      );
    },
  };
}
