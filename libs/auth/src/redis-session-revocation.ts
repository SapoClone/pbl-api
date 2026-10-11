import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { sessionDenyListKey } from './auth.constants';
import { AuthUser } from './auth.types';

export interface RedisSessionRevocationEnv {
  host?: string;
  port?: string;
  password?: string;
  tls?: string;
}

/**
 * Reads the logout deny-list platform writes to Redis (ADR-0004 §7).
 * Store errors propagate: an outage must never read as "not revoked".
 */
export class RedisSessionRevocation {
  constructor(private readonly redis: Redis) {}

  /** null when no host is configured (no revocation check) */
  static fromEnv(
    env: RedisSessionRevocationEnv,
  ): RedisSessionRevocation | null {
    if (!env.host) return null;
    const redis = new Redis({
      host: env.host,
      port: Number(env.port) || 6379,
      password: env.password || undefined,
      tls: env.tls === 'true' ? {} : undefined,
      lazyConnect: false,
      maxRetriesPerRequest: 1,
    });
    // Without a listener ioredis prints "Unhandled error event"; commands
    // still reject while the store is down.
    const logger = new Logger('RedisSessionRevocation');
    redis.on('error', (err) => logger.warn(`Redis error: ${err.message}`));
    return new RedisSessionRevocation(redis);
  }

  async isSessionRevoked(user: AuthUser): Promise<boolean> {
    return (await this.redis.exists(sessionDenyListKey(user.sessionId))) === 1;
  }

  /** Closes the connection; call on application shutdown */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}
