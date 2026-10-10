import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenService } from './access-token.service';

/**
 * Holds the signing key. Separate from AuthModule so PblAuthModule's factory
 * can inject AccessTokenService as platform's local KeyResolver.
 */
@Module({
  imports: [JwtModule.register({})],
  providers: [AccessTokenService],
  exports: [AccessTokenService],
})
export class AccessTokenModule {}
