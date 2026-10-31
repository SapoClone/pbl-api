import { AllConfigType } from '@/config/config.type';
import { CacheKey } from '@/constants/cache.constant';
import { createCacheKey } from '@/utils/cache.util';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthUser, PblAuthModule } from '@pbl/auth';
import { Cache } from 'cache-manager';
import { AccountEntity } from '../account/entities/account.entity';
import { MembershipModule } from '../tenant/membership.module';
import { AccessTokenModule } from './access-token.module';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { JwksController } from './jwks.controller';
import { RefreshTokenService } from './refresh-token.service';
import { SessionService } from './session.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccountEntity, RefreshTokenEntity]),
    JwtModule.register({}),
    AccessTokenModule,
    MembershipModule,
    // Global guard + verifier shared by all services (ADR-0006). Platform
    // resolves keys locally instead of fetching its own JWKS, and keeps the
    // Redis logout deny-list for instant revocation (ADR-0004 §7).
    PblAuthModule.forRootAsync({
      imports: [AccessTokenModule],
      inject: [ConfigService, AccessTokenService, CACHE_MANAGER],
      useFactory: (
        config: ConfigService<AllConfigType>,
        accessTokenService: AccessTokenService,
        cacheManager: Cache,
      ) => ({
        issuer: config.getOrThrow('auth.issuer', { infer: true }),
        audience: config.getOrThrow('auth.audience', { infer: true }),
        keyResolver: accessTokenService,
        // Register, create store and switch run before a store is chosen;
        // tenant routes use @CurrentTenant()/@RequirePermission() (ADR-0008, ADR-0012).
        tenant: 'optional',
        isSessionRevoked: async (user: AuthUser) =>
          Boolean(
            await cacheManager.store.get<boolean>(
              createCacheKey(CacheKey.SESSION_BLACKLIST, user.sessionId),
            ),
          ),
      }),
    }),
  ],
  controllers: [AuthController, JwksController],
  providers: [AuthService, RefreshTokenService, SessionService],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
