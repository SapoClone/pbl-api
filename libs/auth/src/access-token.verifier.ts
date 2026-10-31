import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_ALGORITHM, PBL_AUTH_OPTIONS } from './auth.constants';
import { AccessTokenClaims, AuthUser, PblAuthOptions } from './auth.types';

const OWNER_ROLE = 'owner';
const WILDCARD = '*';

/** The string elements of a claim, or undefined when it is not an array. */
const stringList = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : undefined;

/**
 * Verifies platform-issued access tokens in any service (ADR-0004): RS256
 * only, signature checked with the key for the token's kid, issuer and
 * audience enforced.
 */
@Injectable()
export class AccessTokenVerifier {
  private readonly logger = new Logger(AccessTokenVerifier.name);
  private readonly jwtService = new JwtService();

  constructor(
    @Inject(PBL_AUTH_OPTIONS) private readonly options: PblAuthOptions,
  ) {}

  async verify(token: string): Promise<AuthUser> {
    const user = await this.verifySignedClaims(token);

    if (
      this.options.isSessionRevoked &&
      (await this.options.isSessionRevoked(user))
    ) {
      throw new UnauthorizedException();
    }

    return user;
  }

  private async verifySignedClaims(token: string): Promise<AuthUser> {
    const decoded = this.safeDecode(token);
    const kid = decoded?.header?.kid;
    if (decoded?.header?.alg !== ACCESS_TOKEN_ALGORITHM || !kid) {
      throw new UnauthorizedException();
    }

    let publicKey: string;
    try {
      publicKey = await this.options.keyResolver.getPublicKey(kid);
    } catch (err) {
      // Unknown kid, or the JWKS endpoint is unreachable — log so an outage
      // is distinguishable from a bad token.
      this.logger.warn(`Cannot resolve signing key "${kid}": ${err?.message}`);
      throw new UnauthorizedException();
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwtService.verifyAsync<AccessTokenClaims>(token, {
        publicKey,
        algorithms: [ACCESS_TOKEN_ALGORITHM],
        issuer: this.options.issuer,
        audience: this.options.audience,
      });
    } catch {
      throw new UnauthorizedException();
    }

    if (!claims.sub || !claims.sid || !claims.sub_type) {
      throw new UnauthorizedException();
    }

    const roles = stringList(claims.roles) ?? [];
    const perms = stringList(claims.perms);
    const branches = stringList(claims.branches);

    return {
      id: claims.sub,
      sessionId: claims.sid,
      subjectType: claims.sub_type,
      tenantId: claims.tid || undefined,
      roles,
      permissions: perms ?? (roles.includes(OWNER_ROLE) ? [WILDCARD] : []),
      branches: branches ?? [WILDCARD],
      exp: claims.exp,
    };
  }

  private safeDecode(token: string) {
    try {
      return this.jwtService.decode(token, { complete: true });
    } catch {
      return null;
    }
  }
}
