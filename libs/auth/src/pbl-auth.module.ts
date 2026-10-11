import {
  DynamicModule,
  Module,
  ModuleMetadata,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessTokenVerifier } from './access-token.verifier';
import { PBL_AUTH_OPTIONS } from './auth.constants';
import { AuthGuard } from './auth.guard';
import { PblAuthOptions } from './auth.types';
import { JwksKeyResolver } from './jwks-key-resolver';
import { RedisSessionRevocation } from './redis-session-revocation';
import { TenantContextInterceptor } from './tenant-context.interceptor';

const SESSION_REVOCATION = Symbol('SESSION_REVOCATION');

/** Closes the deny-list Redis connection when the app shuts down */
class SessionRevocationShutdown implements OnApplicationShutdown {
  constructor(private readonly revocation: RedisSessionRevocation | null) {}

  async onApplicationShutdown() {
    await this.revocation?.close();
  }
}

interface PblAuthAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory: (...args: any[]) => PblAuthOptions | Promise<PblAuthOptions>;
  extraProviders?: ModuleMetadata['providers'];
}

/**
 * Registers the global AuthGuard, AccessTokenVerifier and
 * TenantContextInterceptor (ADR-0004, ADR-0006, ADR-0008): handlers run in
 * TenantContext with the verified token's tenant. Import exactly once per app.
 */
@Module({})
export class PblAuthModule {
  static forRootAsync(options: PblAuthAsyncOptions): DynamicModule {
    return {
      module: PblAuthModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: PBL_AUTH_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        ...(options.extraProviders ?? []),
        AccessTokenVerifier,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
      ],
      exports: [AccessTokenVerifier],
    };
  }

  /**
   * For every service except platform: verify against platform's JWKS.
   * Env: AUTH_JWKS_URL (required), AUTH_JWT_ISSUER (default "platform"),
   * AUTH_JWT_AUDIENCE (default "pbl6"). Tenant mode: required (ADR-0008).
   * Logout deny-list (ADR-0004 §7): when REDIS_HOST is set, sessions on the
   * platform's Redis deny-list are rejected (REDIS_PORT, REDIS_PASSWORD,
   * REDIS_TLS_ENABLED optional). Without REDIS_HOST there is no check.
   */
  static forRemoteJwks(): DynamicModule {
    return PblAuthModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, SESSION_REVOCATION],
      extraProviders: [
        {
          provide: SESSION_REVOCATION,
          inject: [ConfigService],
          useFactory: (config: ConfigService) =>
            RedisSessionRevocation.fromEnv({
              host: config.get<string>('REDIS_HOST'),
              port: config.get<string>('REDIS_PORT'),
              password: config.get<string>('REDIS_PASSWORD'),
              tls: config.get<string>('REDIS_TLS_ENABLED'),
            }),
        },
        {
          provide: SessionRevocationShutdown,
          inject: [SESSION_REVOCATION],
          useFactory: (revocation: RedisSessionRevocation | null) =>
            new SessionRevocationShutdown(revocation),
        },
      ],
      useFactory: (
        config: ConfigService,
        revocation: RedisSessionRevocation | null,
      ) => ({
        issuer: config.get<string>('AUTH_JWT_ISSUER') || 'platform',
        audience: config.get<string>('AUTH_JWT_AUDIENCE') || 'pbl6',
        tenant: 'required',
        keyResolver: new JwksKeyResolver(
          config.getOrThrow<string>('AUTH_JWKS_URL'),
        ),
        isSessionRevoked: revocation
          ? (user) => revocation.isSessionRevoked(user)
          : undefined,
      }),
    });
  }
}
