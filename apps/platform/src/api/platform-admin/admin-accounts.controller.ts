import { ApiAuth } from '@/decorators/http.decorators';
import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { RequirePlatformAdmin } from '@pbl/auth';
import {
  AdminAccountDetail,
  AdminAccountsService,
} from './admin-accounts.service';
import {
  ListAdminAccountSessionsReqDto,
  ListAdminAccountsReqDto,
} from './dto/admin-account.req.dto';

/** People across every store, for the platform admin (contract 04, screens 07 and 08). Every route needs an admin token. */
@ApiTags('admin-accounts')
@RequirePlatformAdmin()
@Controller({ path: 'admin/accounts', version: '1' })
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  @ApiAuth({ summary: 'Accounts with their stores and roles' })
  @Get()
  list(@Query() query: ListAdminAccountsReqDto) {
    return this.accounts.list(query);
  }

  @ApiAuth({ summary: 'One account with its stores and live session count' })
  @ApiParam({ name: 'id', type: 'String' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminAccountDetail> {
    return this.accounts.get(id);
  }

  @ApiAuth({ summary: 'The live logins of an account' })
  @ApiParam({ name: 'id', type: 'String' })
  @Get(':id/sessions')
  sessions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListAdminAccountSessionsReqDto,
  ) {
    return this.accounts.sessionsOf(id, query);
  }

  @ApiAuth({
    summary: 'End every live session of an account',
    statusCode: HttpStatus.OK,
  })
  @ApiParam({ name: 'id', type: 'String' })
  @Post(':id/revoke-sessions')
  revokeSessions(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.revokeSessions(id);
  }
}
