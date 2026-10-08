import { AllConfigType } from '@/config/config.type';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenSubjectType, KeyResolver } from '@pbl/auth';
import { createPrivateKey, createPublicKey, JsonWebKey } from 'crypto';

const ALGORITHM = 'RS256';
const MIN_RSA_MODULUS_BITS = 2048;

export type PublicJwk = JsonWebKey & {
  kid: string;
  alg: typeof ALGORITHM;
  use: 'sig';
};

/**
 * Signs access tokens and publishes the matching public key. Platform is the
 * only service holding the private key; verification lives in @pbl/auth,
 * which other services feed from GET /.well-known/jwks.json and platform
 * feeds directly from this class (it is platform's KeyResolver). ADR-0004.
 */
@Injectable()
export class AccessTokenService implements KeyResolver {
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

  async getPublicKey(kid: string): Promise<string> {
    if (kid !== this.keyId) {
      throw new Error(`Unknown key id "${kid}"`);
    }
    return this.publicKeyPem;
  }
}
