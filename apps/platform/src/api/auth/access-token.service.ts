import { AllConfigType } from '@/config/config.type';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createPrivateKey, createPublicKey, JsonWebKey } from 'crypto';
import {
  AccessTokenClaims,
  AccessTokenSubjectType,
  AuthUser,
} from './types/auth-user.type';

const ALGORITHM = 'RS256';
const MIN_RSA_MODULUS_BITS = 2048;

export type PublicJwk = JsonWebKey & {
  kid: string;
  alg: typeof ALGORITHM;
  use: 'sig';
};

/**
 * Signs and verifies access tokens. Platform is the only service holding the
 * private key; every other service verifies against the public keys published
 * at GET /.well-known/jwks.json (ADR-0004).
 */
@Injectable()
export class AccessTokenService {
  private readonly privateKeyPem: string;
  private readonly publicKeyPem: string;
  private readonly publicJwk: PublicJwk;
  private readonly keyId: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly expiresIn: string;

  constructor(
    configService: ConfigService<AllConfigType>,
    private readonly jwtService: JwtService,
  ) {
    const privateKey = createPrivateKey(
      configService.getOrThrow('auth.privateKey', { infer: true }),
    );
    if (privateKey.asymmetricKeyType !== 'rsa') {
      throw new Error('AUTH_JWT_PRIVATE_KEY must be an RSA private key');
    }
    if (privateKey.asymmetricKeyDetails.modulusLength < MIN_RSA_MODULUS_BITS) {
      throw new Error(
        `AUTH_JWT_PRIVATE_KEY must be at least ${MIN_RSA_MODULUS_BITS} bits`,
      );
    }
    const publicKey = createPublicKey(privateKey);

    this.keyId = configService.getOrThrow('auth.keyId', { infer: true });
    this.issuer = configService.getOrThrow('auth.issuer', { infer: true });
    this.audience = configService.getOrThrow('auth.audience', { infer: true });
    this.expiresIn = configService.getOrThrow('auth.expires', { infer: true });
    this.privateKeyPem = privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    this.publicKeyPem = publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;
    this.publicJwk = {
      ...publicKey.export({ format: 'jwk' }),
      kid: this.keyId,
      alg: ALGORITHM,
      use: 'sig',
    };
  }

  getJwks(): { keys: PublicJwk[] } {
    return { keys: [this.publicJwk] };
  }

  async sign(data: { userId: string; sessionId: string }): Promise<string> {
    const subjectType: AccessTokenSubjectType = 'account';
    return this.jwtService.signAsync(
      { sub: data.userId, sid: data.sessionId, sub_type: subjectType },
      {
        privateKey: this.privateKeyPem,
        algorithm: ALGORITHM,
        keyid: this.keyId,
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: this.expiresIn,
      },
    );
  }

  async verify(token: string): Promise<AuthUser> {
    try {
      const decoded = this.jwtService.decode(token, { complete: true });
      if (decoded?.header?.kid !== this.keyId) {
        throw new Error('unknown kid');
      }
      const claims = await this.jwtService.verifyAsync<AccessTokenClaims>(
        token,
        {
          publicKey: this.publicKeyPem,
          // Pin the algorithm: never let the token header choose it
          algorithms: [ALGORITHM],
          issuer: this.issuer,
          audience: this.audience,
        },
      );
      return {
        id: claims.sub as AuthUser['id'],
        sessionId: claims.sid as AuthUser['sessionId'],
        subjectType: claims.sub_type,
        exp: claims.exp,
      };
    } catch {
      throw new UnauthorizedException();
    }
  }
}
