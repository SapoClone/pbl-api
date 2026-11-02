import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessTokenModule } from '../auth/access-token.module';
import { AuthModule } from '../auth/auth.module';
import { AdminAuthController } from './admin-auth.controller';
import { PlatformAdminEntity } from './entities/platform-admin.entity';
import { PlatformAdminAuthService } from './platform-admin-auth.service';

/** The platform admin identity (ADR-0022). */
@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformAdminEntity]),
    AccessTokenModule,
    AuthModule, // RefreshTokenService
  ],
  controllers: [AdminAuthController],
  providers: [PlatformAdminAuthService],
  exports: [PlatformAdminAuthService],
})
export class PlatformAdminModule {}
