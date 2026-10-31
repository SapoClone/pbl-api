import { Client, ClientInfo } from '@/decorators/client-info.decorator';
import { ApiAuth, ApiPublic } from '@/decorators/http.decorators';
import { Body, Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@pbl/auth';
import { AuthService } from './auth.service';
import { LoginReqDto } from './dto/login.req.dto';
import { LoginResDto } from './dto/login.res.dto';
import { RefreshReqDto } from './dto/refresh.req.dto';
import { RefreshResDto } from './dto/refresh.res.dto';
import { RegisterReqDto } from './dto/register.req.dto';
import { RegisterResDto } from './dto/register.res.dto';
import { SwitchTenantReqDto } from './dto/switch-tenant.req.dto';

@ApiTags('auth')
@Controller({
  path: 'auth',
  version: '1',
})
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiPublic({
    type: LoginResDto,
    summary: 'Sign in',
  })
  @Post('email/login')
  async signIn(
    @Body() userLogin: LoginReqDto,
    @Client() client?: ClientInfo,
  ): Promise<LoginResDto> {
    return await this.authService.signIn(userLogin, client);
  }

  @ApiPublic()
  @Post('email/register')
  async register(@Body() dto: RegisterReqDto): Promise<RegisterResDto> {
    return await this.authService.register(dto);
  }

  @ApiAuth({
    summary: 'Logout',
    errorResponses: [400, 401, 403, 500],
  })
  @Post('logout')
  async logout(@CurrentUser() userToken: AuthUser): Promise<void> {
    await this.authService.logout(userToken);
  }

  @ApiAuth({
    summary: 'Sign out of every device (all sessions of the caller)',
    statusCode: HttpStatus.NO_CONTENT,
    errorResponses: [401, 403, 500],
  })
  @Post('logout-all')
  async logoutAll(@CurrentUser() userToken: AuthUser): Promise<void> {
    await this.authService.logoutAll(userToken);
  }

  @ApiPublic({
    type: RefreshResDto,
    summary: 'Refresh token',
  })
  @Post('refresh')
  async refresh(@Body() dto: RefreshReqDto): Promise<RefreshResDto> {
    return await this.authService.refreshToken(dto);
  }

  @ApiAuth({
    type: LoginResDto,
    summary: 'Switch to another store (new token pair)',
    errorResponses: [401, 404, 422],
  })
  @Post('switch-tenant')
  async switchTenant(
    @CurrentUser() user: AuthUser,
    @Body() dto: SwitchTenantReqDto,
    @Client() client?: ClientInfo,
  ): Promise<LoginResDto> {
    return await this.authService.switchTenant(user, dto.tenantId, client);
  }

  @ApiPublic()
  @Post('forgot-password')
  async forgotPassword() {
    return 'forgot-password';
  }

  @ApiPublic()
  @Post('verify/forgot-password')
  async verifyForgotPassword() {
    return 'verify-forgot-password';
  }

  @ApiPublic()
  @Post('reset-password')
  async resetPassword() {
    return 'reset-password';
  }

  @ApiPublic()
  @Get('verify/email')
  async verifyEmail() {
    return 'verify-email';
  }

  @ApiPublic()
  @Post('verify/email/resend')
  async resendVerifyEmail() {
    return 'resend-verify-email';
  }
}
