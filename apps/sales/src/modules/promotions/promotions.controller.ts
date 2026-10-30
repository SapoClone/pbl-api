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
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import { CreateCouponDto, CreatePromotionDto } from './promotions.dto';
import { PromotionsService } from './promotions.service';

@ApiTags('promotions-coupons')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('api/v1')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Post('promotions')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Create a promotion rule' })
  createPromotion(@Body() dto: CreatePromotionDto) {
    return this.promotionsService.createPromotion(dto);
  }

  @Get('promotions')
  @ApiOperation({ summary: 'List promotions for current tenant' })
  listPromotions() {
    return this.promotionsService.listPromotions();
  }

  @Post('coupons')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Create a coupon code linked to a promotion' })
  createCoupon(@Body() dto: CreateCouponDto) {
    return this.promotionsService.createCoupon(dto);
  }

  @Get('coupons')
  @ApiOperation({ summary: 'List coupons for current tenant' })
  listCoupons() {
    return this.promotionsService.listCoupons();
  }
}
