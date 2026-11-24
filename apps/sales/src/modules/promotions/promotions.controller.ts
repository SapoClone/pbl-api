import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import { BranchScope } from '../../presentation/access';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import {
  CreateCouponDto,
  CreatePromotionDto,
  EvaluateCouponDto,
  UpdateCouponDto,
  UpdatePromotionDto,
} from './promotions.dto';
import { PromotionsService } from './promotions.service';

@ApiTags('promotions-coupons')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@Controller('api/v1')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Post('promotions')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('orders.approve')
  @ApiOperation({ summary: 'Create a promotion rule' })
  createPromotion(
    @Body() dto: CreatePromotionDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.promotionsService.createPromotion(dto, scope);
  }

  @Get('promotions')
  @RequirePermission('orders.view')
  @ApiOperation({ summary: 'List promotions for current tenant' })
  listPromotions(@AllowedBranches() scope: BranchScope) {
    return this.promotionsService.listPromotions(scope);
  }

  @Patch('promotions/:id')
  @RequirePermission('orders.approve')
  @ApiOperation({
    summary: 'Edit a promotion (partial update; the code is immutable)',
  })
  updatePromotion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromotionDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.promotionsService.updatePromotion(id, dto, scope);
  }

  @Post('coupons')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('orders.approve')
  @ApiOperation({ summary: 'Create a coupon code linked to a promotion' })
  createCoupon(
    @Body() dto: CreateCouponDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.promotionsService.createCoupon(dto, scope);
  }

  @Get('coupons')
  @RequirePermission('orders.view')
  @ApiOperation({ summary: 'List coupons for current tenant' })
  listCoupons() {
    return this.promotionsService.listCoupons();
  }

  @Patch('coupons/:id')
  @RequirePermission('orders.approve')
  @ApiOperation({
    summary: 'Edit a coupon: usage limits and status (the code is immutable)',
  })
  updateCoupon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.promotionsService.updateCoupon(id, dto, scope);
  }

  @Post('coupons/evaluate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.view', 'pos.view', 'pos.create')
  @ApiOperation({
    summary:
      'Preview the discount of a coupon for an order amount (read-only: no use is consumed). ' +
      'Applies the checkout rules; a coupon that does not qualify answers a coded 409',
  })
  evaluateCoupon(
    @Body() dto: EvaluateCouponDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.promotionsService.evaluateCouponPreview(dto, scope);
  }
}
