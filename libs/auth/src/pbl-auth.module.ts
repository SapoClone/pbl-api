import { DynamicModule, Module, ModuleMetadata } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AccessTokenVerifier } from './access-token.verifier';
import { PBL_AUTH_OPTIONS } from './auth.constants';
import { AuthGuard } from './auth.guard';
import { PblAuthOptions } from './auth.types';
import { JwksKeyResolver } from './jwks-key-resolver';

interface PblAuthAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory: (...args: any[]) => PblAuthOptions | Promise<PblAuthOptions>;
}

/**
 * Registers the global AuthGuard and AccessTokenVerifier (ADR-0004,
 * ADR-0006). Import exactly once per app.
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
        AccessTokenVerifier,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [AccessTokenVerifier],
    };
  }

  /**
   * For every service except platform: verify against platform's JWKS.
   * Env: AUTH_JWKS_URL (required), AUTH_JWT_ISSUER (default "platform"),
   * AUTH_JWT_AUDIENCE (default "pbl6").
   */
  static forRemoteJwks(): DynamicModule {
    return PblAuthModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        issuer: config.get<string>('AUTH_JWT_ISSUER') || 'platform',
        audience: config.get<string>('AUTH_JWT_AUDIENCE') || 'pbl6',
        keyResolver: new JwksKeyResolver(
          config.getOrThrow<string>('AUTH_JWKS_URL'),
        ),
      }),
    });
  }
}
