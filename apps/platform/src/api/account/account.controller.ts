import { ApiAuth } from '@/decorators/http.decorators';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@pbl/auth';
import { SessionResDto } from '../auth/dto/session.res.dto';
import { AccountService } from './account.service';
import { AccountResDto } from './dto/account.res.dto';
import { ChangePasswordReqDto } from './dto/change-password.req.dto';
import { UpdateAccountReqDto } from './dto/update-account.req.dto';

@ApiTags('accounts')
@Controller({ path: 'accounts', version: '1' })
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @ApiAuth({ type: AccountResDto, summary: 'Get my account' })
  @Get('me')
  getMe(@CurrentUser('id') accountId: string): Promise<AccountResDto> {
    return this.accountService.getMe(accountId);
  }

  @ApiAuth({ type: AccountResDto, summary: 'Update my account' })
  @Patch('me')
  updateMe(
    @CurrentUser('id') accountId: string,
    @Body() dto: UpdateAccountReqDto,
  ): Promise<AccountResDto> {
    return this.accountService.updateMe(accountId, dto);
  }

  @ApiAuth({
    summary: 'Change my password (ends my other sessions)',
    statusCode: HttpStatus.NO_CONTENT,
    errorResponses: [400, 401, 422, 500],
  })
  @Post('me/change-password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordReqDto,
  ): Promise<void> {
    return this.accountService.changePassword(user.id, user.sessionId, dto);
  }

  @ApiAuth({
    type: SessionResDto,
    summary: 'My active sessions (one per login)',
  })
  @Get('me/sessions')
  async listSessions(
    @CurrentUser() user: AuthUser,
  ): Promise<{ data: SessionResDto[] }> {
    return {
      data: await this.accountService.listSessions(user.id, user.sessionId),
    };
  }

  @ApiAuth({
    summary: 'End one of my sessions',
    statusCode: HttpStatus.NO_CONTENT,
  })
  @ApiParam({ name: 'id', type: 'String' })
  @Delete('me/sessions/:id')
  revokeSession(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.accountService.revokeSession(accountId, id);
  }
}
