import { Client, ClientInfo } from '@/decorators/client-info.decorator';
import { ApiAuth, ApiPublic } from '@/decorators/http.decorators';
import { Body, Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePlatformAdmin } from '@pbl/auth';
import { RefreshReqDto } from '../auth/dto/refresh.req.dto';
import { RefreshResDto } from '../auth/dto/refresh.res.dto';
import { AdminLoginReqDto } from './dto/admin-login.req.dto';
import { AdminLoginResDto } from './dto/admin-login.res.dto';
import { AdminMeResDto } from './dto/admin.res.dto';
import { PlatformAdminAuthService } from './platform-admin-auth.service';

/** Platform-admin auth (ADR-0022): sign-in and refresh are public, the rest need an admin token. */
@ApiTags('admin-auth')
@RequirePlatformAdmin()
@Controller({ path: 'admin', version: '1' })
export class AdminAuthController {
  constructor(private readonly authService: PlatformAdminAuthService) {}

  @ApiPublic({ type: AdminLoginResDto, summary: 'Platform admin sign-in' })
  @Post('auth/login')
  login(
    @Body() dto: AdminLoginReqDto,
    @Client() client?: ClientInfo,
  ): Promise<AdminLoginResDto> {
    return this.authService.signIn(dto, client);
  }

  @ApiPublic({
    type: RefreshResDto,
    summary: 'Refresh a platform admin token (an account token is refused)',
  })
  @Post('auth/refresh')
  refresh(@Body() dto: RefreshReqDto): Promise<RefreshResDto> {
    return this.authService.refresh(dto);
  }

  @ApiAuth({
    summary: 'Platform admin sign-out',
    statusCode: HttpStatus.NO_CONTENT,
    errorResponses: [401, 403, 500],
  })
  @Post('auth/logout')
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.authService.logout(user);
  }

  @ApiAuth({ type: AdminMeResDto, summary: 'The signed-in platform admin' })
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<AdminMeResDto> {
    return this.authService.me(user);
  }
}
