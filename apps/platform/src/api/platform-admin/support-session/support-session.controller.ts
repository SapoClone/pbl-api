import { ApiAuth } from '@/decorators/http.decorators';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AllowSupportToken,
  AuthUser,
  CurrentUser,
  RequirePlatformAdmin,
} from '@pbl/auth';
import type { Response } from 'express';
import {
  ListSupportSessionsReqDto,
  StartSupportSessionReqDto,
} from './support-session.req.dto';
import {
  StartedSupportSession,
  SupportSessionList,
  SupportSessionService,
  SupportSessionView,
} from './support-session.service';

/**
 * Support sessions, "Hỗ trợ kỹ thuật" (contract 04, screens 03 and 22; ADR-0025). Every route needs an admin token,
 * except that a session may be ended with its own support token.
 */
@ApiTags('admin-support-sessions')
@RequirePlatformAdmin()
@Controller({ path: 'admin/support-sessions', version: '1' })
export class SupportSessionController {
  constructor(private readonly supportSessions: SupportSessionService) {}

  @ApiAuth({
    summary:
      'Open a read-only support session on a store; answers the access token once',
    description:
      'The token lasts 60 minutes, has no refresh and refuses every request that is not GET, HEAD or OPTIONS ' +
      '(403 AUTH_READ_ONLY). It appears only in this response. A retry with the same Idempotency-Key answers the ' +
      'same session (200, Idempotency-Replayed) with a fresh token for the rest of its life.',
    statusCode: HttpStatus.CREATED,
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @Post()
  async start(
    @CurrentUser('id') adminId: string,
    @Body() dto: StartSupportSessionReqDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StartedSupportSession> {
    const { session, replayed } = await this.supportSessions.start(
      adminId,
      dto,
      idempotencyKey?.trim().slice(0, 100) || undefined,
    );
    // a response with a credential in it is never cached
    res.setHeader('Cache-Control', 'no-store');
    if (replayed) {
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(HttpStatus.OK);
    }
    return session;
  }

  @ApiAuth({ summary: 'Support sessions with the counts of the tab labels' })
  @Get()
  list(@Query() query: ListSupportSessionsReqDto): Promise<SupportSessionList> {
    return this.supportSessions.list(query);
  }

  @ApiAuth({ summary: 'One support session (never the token)' })
  @ApiParam({ name: 'id', type: 'String' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SupportSessionView> {
    return this.supportSessions.get(id);
  }

  @ApiAuth({
    summary:
      'End a support session (admin token, or the session’s own token); its token stops working at once',
    statusCode: HttpStatus.OK,
  })
  @ApiParam({ name: 'id', type: 'String' })
  @AllowSupportToken()
  @Post(':id/end')
  end(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupportSessionView> {
    return this.supportSessions.end(user, id);
  }
}
