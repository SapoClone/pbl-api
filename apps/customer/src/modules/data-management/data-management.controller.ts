import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthUser,
  CurrentUser,
  RequirePermission,
  hasPermission,
} from '@pbl/auth';
import { rethrowCustomerHttpError } from '../../presentation/customer-http-error';
import {
  CreateExportJobDto,
  CreateImportJobDto,
  MergeCustomersDto,
} from './data-management.dto';
import { DataManagementService } from './data-management.service';

@ApiTags('customer-data-management')
@ApiBearerAuth()
@Controller(['', 'api'])
export class DataManagementController {
  constructor(private readonly dataManagementService: DataManagementService) {}

  @Get('v1/customers/duplicates')
  @RequirePermission('customers.view')
  @ApiOperation({
    summary: 'Detect duplicate customer profiles within the tenant',
  })
  async findDuplicates(@CurrentUser() user: AuthUser) {
    try {
      return await this.dataManagementService.findDuplicates(user.tenantId!);
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Post('v1/customers/merge')
  @RequirePermission('customers.update')
  @ApiOperation({
    summary:
      'Merge source customer into target customer with atomic loyalty ledger transfer',
  })
  async mergeCustomers(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: MergeCustomersDto,
  ) {
    try {
      return await this.dataManagementService.mergeCustomers(
        user.tenantId!,
        user.id ?? 'system',
        dto,
        idempotencyKey,
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Post('v1/customers/import-jobs')
  @RequirePermission('customers.create')
  @ApiOperation({
    summary: 'Create a customer CSV/batch import job with row-level validation',
  })
  async createImportJob(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateImportJobDto,
  ) {
    try {
      return await this.dataManagementService.createImportJob(
        user.tenantId!,
        user.id ?? 'system',
        dto,
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Get('v1/customers/import-jobs/:id')
  @RequirePermission('customers.view')
  @ApiOperation({ summary: 'Get customer import job status and row errors' })
  async getImportJob(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.dataManagementService.getImportJob(user.tenantId!, id);
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Post('v1/customers/export-jobs')
  @RequirePermission('customers.view')
  @ApiOperation({
    summary:
      'Create a formula-injection-safe customer CSV export job with phones masked unless the caller holds customers.update',
  })
  async createExportJob(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateExportJobDto,
  ) {
    try {
      return await this.dataManagementService.createExportJob(
        user.tenantId!,
        user.id ?? 'system',
        dto,
        hasPermission(user, 'customers.update'),
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Get('v1/customers/export-jobs/:id')
  @RequirePermission('customers.view')
  @ApiOperation({ summary: 'Get customer export job status and CSV output' })
  async getExportJob(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.dataManagementService.getExportJob(
        user.tenantId!,
        id,
        user.id ?? 'system',
        hasPermission(user, 'customers.update'),
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }
}
