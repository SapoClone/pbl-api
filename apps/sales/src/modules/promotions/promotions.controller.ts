import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import { BranchScope } from '../../presentation/access';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import { CreateCouponDto, CreatePromotionDto } from './promotions.dto';
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
}
