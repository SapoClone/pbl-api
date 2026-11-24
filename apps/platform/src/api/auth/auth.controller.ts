import { Client, ClientInfo } from '@/decorators/client-info.decorator';
import { ApiAuth, ApiPublic } from '@/decorators/http.decorators';
import { Body, Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@pbl/auth';
import { plainToInstance } from 'class-transformer';
import { AuthService } from './auth.service';
import { ForgotPasswordReqDto } from './dto/forgot-password.req.dto';
import { LoginReqDto } from './dto/login.req.dto';
import { LoginResDto } from './dto/login.res.dto';
import { MessageResDto } from './dto/message.res.dto';
import { RefreshReqDto } from './dto/refresh.req.dto';
import { RefreshResDto } from './dto/refresh.res.dto';
import { RegisterReqDto } from './dto/register.req.dto';
import { RegisterResDto } from './dto/register.res.dto';
import { ResetPasswordReqDto } from './dto/reset-password.req.dto';
import { SwitchTenantReqDto } from './dto/switch-tenant.req.dto';
import { PasswordResetService } from './password-reset.service';

@ApiTags('auth')
@Controller({
  path: 'auth',
  version: '1',
})
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

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

  @ApiPublic({ summary: 'Register an account' })
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

  @ApiPublic({
    type: MessageResDto,
    summary: 'Request a password reset link by email',
    description:
      'Always 200 with the same body, whether or not the email has an account',
    errorResponses: [422, 500],
  })
  @Post('forgot-password')
  async forgotPassword(
    @Body() dto: ForgotPasswordReqDto,
  ): Promise<MessageResDto> {
    await this.passwordResetService.requestReset(dto.email);
    return plainToInstance(MessageResDto, {
      message:
        'If an account exists for this email, a password reset link has been sent',
    });
  }

  @ApiPublic({
    type: MessageResDto,
    summary: 'Set a new password with the token from the reset email',
    description:
      'An invalid, expired or used token answers 400 E014. Ends every session of the account',
    errorResponses: [400, 422, 500],
  })
  @Post('reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordReqDto,
  ): Promise<MessageResDto> {
    await this.passwordResetService.resetPassword(dto.token, dto.password);
    return plainToInstance(MessageResDto, {
      message: 'Your password has been reset. Sign in with the new password',
    });
  }

  @ApiPublic({ summary: 'Verify an email address (not implemented yet)' })
  @Get('verify/email')
  async verifyEmail() {
    return 'verify-email';
  }

  @ApiPublic({ summary: 'Resend the email verification (not implemented yet)' })
  @Post('verify/email/resend')
  async resendVerifyEmail() {
    return 'resend-verify-email';
  }
}
