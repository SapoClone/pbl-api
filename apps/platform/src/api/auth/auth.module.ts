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
import { UserEntity } from '../user/entities/user.entity';
import { UserModule } from '../user/user.module';
import { AccessTokenModule } from './access-token.module';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { JwksController } from './jwks.controller';
import { RefreshTokenService } from './refresh-token.service';

@Module({
  imports: [
    UserModule,
    TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity]),
    JwtModule.register({}),
    AccessTokenModule,
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
  providers: [AuthService, RefreshTokenService],
})
export class AuthModule {}
