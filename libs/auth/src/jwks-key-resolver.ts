import { JwksClient } from 'jwks-rsa';
import { KeyResolver } from './auth.types';

/**
 * Resolves verification keys from platform's published JWKS
 * (GET /.well-known/jwks.json). Keys are cached; an unknown kid triggers a
 * refetch (rate-limited), so key rotation needs no redeploy.
 */
export class JwksKeyResolver implements KeyResolver {
  private readonly client: JwksClient;

  constructor(jwksUri: string) {
    this.client = new JwksClient({
      jwksUri,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      timeout: 5000,
    });
  }

  async getPublicKey(kid: string): Promise<string> {
    const key = await this.client.getSigningKey(kid);
    return key.getPublicKey();
  }
}
