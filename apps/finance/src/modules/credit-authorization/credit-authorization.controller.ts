import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public, RequirePermission } from '@pbl/auth';
import { rethrowFinanceHttpError } from '../../presentation/finance-http-error';
import { assertInternalToken } from '../../presentation/internal-auth';
import {
  CommitCreditAuthorizationDto,
  CreateCreditAuthorizationDto,
  ReleaseCreditAuthorizationDto,
  UpdateCustomerCreditLimitDto,
} from './credit-authorization.dto';
import { CreditAuthorizationService } from './credit-authorization.service';

@ApiTags('finance-credit-authorization')
@ApiBearerAuth()
@Controller(['', 'api'])
export class CreditAuthorizationController {
  constructor(private readonly creditAuthService: CreditAuthorizationService) {}

  /**
   * Internal routes are not routed by the gateway and never trust a bearer or
   * a tenant header on their own: the `x-internal-token` check (mandatory,
   * constant time) comes first, only then `x-tenant-id` is honoured.
   */
  private resolveS2STenant(
    tenantIdHeader: string | undefined,
    internalCallHeader: string | undefined,
    internalTokenHeader: string | undefined,
  ): { tenantId: string; actorId: string } {
    assertInternalToken(internalTokenHeader);
    if (!internalCallHeader) {
      throw new ForbiddenException('Missing x-internal-call header');
    }
    if (!tenantIdHeader) {
      throw new ForbiddenException('Missing x-tenant-id header');
    }
    return {
      tenantId: tenantIdHeader,
      actorId: `s2s:${internalCallHeader}`,
    };
  }

  @Get('v1/finance/customers/:id/credit-profile')
  @RequirePermission('finance.view')
  @ApiOperation({
    summary:
      'Get customer credit limit, posted debt, held credit exposure, and available credit',
  })
  async getCreditProfile(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.creditAuthService.getCreditProfile(id, user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Put('v1/finance/customers/:id/credit-limit')
  @RequirePermission('finance.approve')
  @ApiOperation({ summary: 'Update a customer credit limit' })
  async updateCreditLimit(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCustomerCreditLimitDto,
  ) {
    try {
      return await this.creditAuthService.updateCreditLimit(
        id,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  // ---- Internal S2S Credit Authorization Endpoints (Section 23.8) ----

  @Public()
  @Post('internal/v1/finance/credit-authorizations')
  @ApiOperation({
    summary:
      'Internal S2S: Atomically authorize customer credit exposure and create a HELD credit hold',
  })
  async createAuthorization(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-internal-call') internalCallHeader: string | undefined,
    @Headers('x-internal-token') internalTokenHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateCreditAuthorizationDto,
  ) {
    const { tenantId, actorId } = this.resolveS2STenant(
      tenantIdHeader,
      internalCallHeader,
      internalTokenHeader,
    );
    try {
      return await this.creditAuthService.authorizeCredit(
        actorId,
        idempotencyKey,
        dto,
        tenantId,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Public()
  @Get('internal/v1/finance/credit-authorizations/by-key/:key')
  @ApiOperation({
    summary:
      'Internal S2S: Recover credit authorization outcome by original idempotency key',
  })
  async getAuthorizationByKey(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-internal-call') internalCallHeader: string | undefined,
    @Headers('x-internal-token') internalTokenHeader: string | undefined,
    @Param('key') key: string,
  ) {
    const { tenantId } = this.resolveS2STenant(
      tenantIdHeader,
      internalCallHeader,
      internalTokenHeader,
    );
    try {
      return await this.creditAuthService.getAuthorizationByIdempotencyKey(
        key,
        tenantId,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Public()
  @Get('internal/v1/finance/credit-authorizations/:id')
  @ApiOperation({ summary: 'Internal S2S: Get credit authorization by ID' })
  async getAuthorization(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-internal-call') internalCallHeader: string | undefined,
    @Headers('x-internal-token') internalTokenHeader: string | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const { tenantId } = this.resolveS2STenant(
      tenantIdHeader,
      internalCallHeader,
      internalTokenHeader,
    );
    try {
      return await this.creditAuthService.getAuthorizationById(id, tenantId);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Public()
  @Post('internal/v1/finance/credit-authorizations/:id/commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Internal S2S: Commit HELD credit authorization into an authoritative CustomerReceivable and balanced journal',
  })
  async commitAuthorization(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-internal-call') internalCallHeader: string | undefined,
    @Headers('x-internal-token') internalTokenHeader: string | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CommitCreditAuthorizationDto,
  ) {
    const { tenantId, actorId } = this.resolveS2STenant(
      tenantIdHeader,
      internalCallHeader,
      internalTokenHeader,
    );
    try {
      return await this.creditAuthService.commitAuthorization(
        id,
        actorId,
        dto,
        tenantId,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Public()
  @Post('internal/v1/finance/credit-authorizations/:id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Internal S2S: Release HELD credit authorization and restore available credit',
  })
  async releaseAuthorization(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-internal-call') internalCallHeader: string | undefined,
    @Headers('x-internal-token') internalTokenHeader: string | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReleaseCreditAuthorizationDto,
  ) {
    const { tenantId, actorId } = this.resolveS2STenant(
      tenantIdHeader,
      internalCallHeader,
      internalTokenHeader,
    );
    try {
      return await this.creditAuthService.releaseAuthorization(
        id,
        actorId,
        dto,
        tenantId,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }
}
