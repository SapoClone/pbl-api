import { ApiPublic } from '@/decorators/http.decorators';
import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AccessTokenService, PublicJwk } from './access-token.service';

/**
 * Public keys that verify platform-issued access tokens (RFC 7517). Served
 * outside the /api prefix at the conventional path; consumed by KrakenD and
 * the other services (ADR-0004).
 */
@ApiTags('auth')
@Controller('.well-known')
export class JwksController {
  constructor(private readonly accessTokenService: AccessTokenService) {}

  @ApiPublic({ summary: 'JSON Web Key Set for access-token verification' })
  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  getJwks(): { keys: PublicJwk[] } {
    return this.accessTokenService.getJwks();
  }
}
