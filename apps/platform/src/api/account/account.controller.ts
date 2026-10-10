import { ApiAuth } from '@/decorators/http.decorators';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@pbl/auth';
import { AccountService } from './account.service';
import { AccountResDto } from './dto/account.res.dto';
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
}
