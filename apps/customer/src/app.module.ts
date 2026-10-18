import { Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { PblHealthModule, PblLoggingModule } from '@pbl/common';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [
    PblLoggingModule.forRoot('customer'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({ service: 'customer', redisFromEnv: true }),
  ],
})
export class AppModule {}
