import { Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { HealthController } from './health.controller';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [PblAuthModule.forRemoteJwks()],
  controllers: [HealthController],
})
export class AppModule {}
