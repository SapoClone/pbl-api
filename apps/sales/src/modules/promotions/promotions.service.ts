import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { toMoney } from '../../common/money';
import {
  SalesDomainError,
  SalesDomainErrorCode,
  calculateItemDiscount,
  parseVndAmount,
  vndNumber,
} from '../../domain/sales-domain';
import { getSchemaPrefix } from '../../infrastructure/persistence/sales-code.generator';
import {
  CouponEntity,
  CouponUsageEntity,
  PromotionEntity,
} from '../../infrastructure/persistence/sales.entities';
import {
  BranchScope,
  assertBranchAllowed,
  branchAllowed,
} from '../../presentation/access';
import { CreateCouponDto, CreatePromotionDto } from './promotions.dto';

export interface EvaluatedCouponResult {
  couponId: string;
  promotionId: string;
  couponCode: string;
  discountAmountVnd: number;
}

@Injectable()
export class PromotionsService {
  constructor(private readonly dataSource: DataSource) {}

  async createPromotion(
    dto: CreatePromotionDto,
    scope: BranchScope,
  ): Promise<PromotionEntity> {
    if (dto.branchId) {
      assertBranchAllowed(
        scope,
        dto.branchId,
        'VALIDATION_ERROR',
        'Branch not found',
      );
    }
    const tenantId = TenantContext.require();
    if (
      dto.discountType === 'FIXED' &&
      !Number.isSafeInteger(dto.discountValue)
    ) {
      throw new SalesDomainError(
        SalesDomainErrorCode.VALIDATION_ERROR,
        'A fixed promotion discount must be a whole number of VND',
        422,
      );
    }
    if (dto.discountType === 'PERCENT' && dto.discountValue > 100) {
      throw new SalesDomainError(
        SalesDomainErrorCode.INVALID_DISCOUNT,
        'Percentage promotion discount cannot exceed 100%',
        422,
      );
    }

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const normalizedCode = dto.code.trim().toUpperCase();
      const existing = await em.getRepository(PromotionEntity).findOne({
        where: { tenantId, code: normalizedCode },
      });
      if (existing) {
        throw new SalesDomainError(
          SalesDomainErrorCode.VALIDATION_ERROR,
          `Promotion code ${normalizedCode} already exists`,
          409,
        );
      }

      const promo = em.create(PromotionEntity, {
        id: randomUUID(),
        tenantId,
        code: normalizedCode,
        name: dto.name.trim(),
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        minOrderAmount: dto.minOrderAmount ?? 0,
        maxDiscountAmount: dto.maxDiscountAmount ?? null,
        branchId: dto.branchId ?? null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        status: 'ACTIVE',
        createdAt: new Date(),
      });
      return em.save(PromotionEntity, promo);
    });
  }

  async listPromotions(scope: BranchScope): Promise<PromotionEntity[]> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      // store-wide promotions (no branch) plus those of the caller's branches
      return em.getRepository(PromotionEntity).find({
        where:
          scope === null
            ? { tenantId }
            : [
                { tenantId, branchId: IsNull() },
                { tenantId, branchId: In([...scope]) },
              ],
        order: { createdAt: 'DESC' },
      });
    });
  }

  async createCoupon(
    dto: CreateCouponDto,
    scope: BranchScope,
  ): Promise<CouponEntity> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const promotion = await em.getRepository(PromotionEntity).findOne({
        where: { id: dto.promotionId, tenantId },
      });
      if (
        !promotion ||
        (promotion.branchId && !branchAllowed(scope, promotion.branchId))
      ) {
        throw new SalesDomainError(
          SalesDomainErrorCode.VALIDATION_ERROR,
          'Promotion not found',
          404,
        );
      }

      const normalizedCode = dto.code.trim().toUpperCase();
      const existing = await em.getRepository(CouponEntity).findOne({
        where: { tenantId, code: normalizedCode },
      });
      if (existing) {
        throw new SalesDomainError(
          SalesDomainErrorCode.VALIDATION_ERROR,
          `Coupon code ${normalizedCode} already exists`,
          409,
        );
      }

      const coupon = em.create(CouponEntity, {
        id: randomUUID(),
        tenantId,
        promotionId: promotion.id,
        code: normalizedCode,
        maxUses: dto.maxUses ?? null,
        maxUsesPerCustomer: dto.maxUsesPerCustomer ?? null,
        usedCount: 0,
        status: 'ACTIVE',
        createdAt: new Date(),
      });
      return em.save(CouponEntity, coupon);
    });
  }

  async listCoupons(): Promise<CouponEntity[]> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return em.getRepository(CouponEntity).find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      });
    });
  }

  async previewCouponDiscount(
    couponCode: string,
    afterOrderDiscountVnd: number,
    branchId: string,
    customerId?: string | null,
  ): Promise<EvaluatedCouponResult> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return this.evaluateCoupon(
        em,
        tenantId,
        couponCode,
        afterOrderDiscountVnd,
        branchId,
        customerId ?? null,
        false,
      );
    });
  }

  async redeemCouponWithinTransaction(
    em: EntityManager,
    tenantId: string,
    couponCode: string,
    afterOrderDiscountVnd: number,
    branchId: string,
    customerId: string | null,
    orderId: string,
  ): Promise<EvaluatedCouponResult> {
    const prefix = getSchemaPrefix(this.dataSource);
    const normalizedCode = couponCode.trim().toUpperCase();

    // Idempotency guard: if this orderId already claimed the coupon, return existing claim
    const existingClaim: Array<{
      coupon_id: string;
      promotion_id: string;
      discount_amount: string | number;
    }> = await em.query(
      `SELECT cu.coupon_id, c.promotion_id, cu.discount_amount
       FROM ${prefix}"coupon_usages" cu
       JOIN ${prefix}"coupons" c ON c.tenant_id = cu.tenant_id AND c.id = cu.coupon_id
       WHERE cu.tenant_id = $1 AND cu.order_id = $2 AND c.code = $3
       LIMIT 1`,
      [tenantId, orderId, normalizedCode],
    );
    if (existingClaim.length > 0) {
      return {
        couponId: existingClaim[0].coupon_id,
        promotionId: existingClaim[0].promotion_id,
        couponCode: normalizedCode,
        discountAmountVnd: toMoney(existingClaim[0].discount_amount),
      };
    }

    const evaluated = await this.evaluateCoupon(
      em,
      tenantId,
      couponCode,
      afterOrderDiscountVnd,
      branchId,
      customerId,
      true,
    );

    await em.query(
      `UPDATE ${prefix}"coupons" SET used_count = used_count + 1 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, evaluated.couponId],
    );

    const usage = em.create(CouponUsageEntity, {
      id: randomUUID(),
      tenantId,
      couponId: evaluated.couponId,
      orderId,
      customerId,
      discountAmount: evaluated.discountAmountVnd,
      createdAt: new Date(),
    });
    await em.save(CouponUsageEntity, usage);
    return evaluated;
  }

  async releaseCouponClaimWithinTransaction(
    em: EntityManager,
    tenantId: string,
    orderId: string,
  ): Promise<void> {
    const prefix = getSchemaPrefix(this.dataSource);
    const deleted: Array<{ coupon_id: string }> = await em.query(
      `DELETE FROM ${prefix}"coupon_usages"
       WHERE tenant_id = $1 AND order_id = $2
       RETURNING coupon_id`,
      [tenantId, orderId],
    );
    for (const row of deleted) {
      await em.query(
        `UPDATE ${prefix}"coupons"
         SET used_count = GREATEST(0, used_count - 1)
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, row.coupon_id],
      );
    }
  }

  private async evaluateCoupon(
    em: EntityManager,
    tenantId: string,
    couponCode: string,
    afterOrderDiscountVnd: number,
    branchId: string,
    customerId: string | null,
    lockForUpdate: boolean,
  ): Promise<EvaluatedCouponResult> {
    const prefix = getSchemaPrefix(this.dataSource);
    const normalizedCode = couponCode.trim().toUpperCase();
    const lockClause = lockForUpdate ? 'FOR UPDATE' : '';
    const rows: Array<{
      id: string;
      promotion_id: string;
      code: string;
      max_uses: number | null;
      max_uses_per_customer: number | null;
      used_count: number;
      status: string;
    }> = await em.query(
      `SELECT id, promotion_id, code, max_uses, max_uses_per_customer, used_count, status
       FROM ${prefix}"coupons"
       WHERE tenant_id = $1 AND code = $2
       ${lockClause}`,
      [tenantId, normalizedCode],
    );
    const coupon = rows[0];
    if (!coupon || coupon.status !== 'ACTIVE') {
      throw new SalesDomainError(
        SalesDomainErrorCode.COUPON_INVALID,
        `Coupon ${normalizedCode} is invalid or inactive`,
        409,
        { couponCode: normalizedCode },
      );
    }

    if (
      coupon.max_uses !== null &&
      Number(coupon.used_count) >= Number(coupon.max_uses)
    ) {
      throw new SalesDomainError(
        SalesDomainErrorCode.COUPON_USAGE_LIMIT_EXCEEDED,
        `Coupon ${normalizedCode} usage limit has been reached`,
        409,
        {
          couponCode: normalizedCode,
          usedCount: Number(coupon.used_count),
          maxUses: Number(coupon.max_uses),
        },
      );
    }

    if (coupon.max_uses_per_customer !== null && customerId) {
      const custRows: Array<{ cnt: string }> = await em.query(
        `SELECT COUNT(*)::text AS cnt
         FROM ${prefix}"coupon_usages"
         WHERE tenant_id = $1 AND coupon_id = $2 AND customer_id = $3`,
        [tenantId, coupon.id, customerId],
      );
      const custCount = Number(custRows[0]?.cnt ?? 0);
      if (custCount >= Number(coupon.max_uses_per_customer)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.COUPON_USAGE_LIMIT_EXCEEDED,
          `Customer has already reached the maximum redemptions for coupon ${normalizedCode}`,
          409,
          { couponCode: normalizedCode, customerId },
        );
      }
    }

    const promotion = await em.getRepository(PromotionEntity).findOne({
      where: { id: coupon.promotion_id, tenantId },
    });
    if (!promotion || promotion.status !== 'ACTIVE') {
      throw new SalesDomainError(
        SalesDomainErrorCode.COUPON_INVALID,
        `Promotion for coupon ${normalizedCode} is not active`,
        409,
      );
    }

    if (promotion.branchId && promotion.branchId !== branchId) {
      throw new SalesDomainError(
        SalesDomainErrorCode.COUPON_INVALID,
        `Coupon ${normalizedCode} is not valid for branch ${branchId}`,
        409,
      );
    }

    const now = new Date();
    if (promotion.startsAt && now < promotion.startsAt) {
      throw new SalesDomainError(
        SalesDomainErrorCode.COUPON_INVALID,
        `Coupon ${normalizedCode} has not started yet`,
        409,
      );
    }
    if (promotion.endsAt && now > promotion.endsAt) {
      throw new SalesDomainError(
        SalesDomainErrorCode.COUPON_INVALID,
        `Coupon ${normalizedCode} has expired`,
        409,
      );
    }

    const baseVnd = parseVndAmount(afterOrderDiscountVnd, true);
    const minOrderVnd = parseVndAmount(promotion.minOrderAmount, true);
    if (baseVnd < minOrderVnd) {
      throw new SalesDomainError(
        SalesDomainErrorCode.COUPON_INVALID,
        `Minimum order amount of ${minOrderVnd} VND not met for coupon ${normalizedCode}`,
        409,
        {
          minOrderAmount: vndNumber(minOrderVnd),
          currentAmount: vndNumber(baseVnd),
        },
      );
    }

    let discountVnd = calculateItemDiscount(
      baseVnd,
      promotion.discountType as 'FIXED' | 'PERCENT',
      promotion.discountValue,
    );

    if (promotion.maxDiscountAmount !== null) {
      const capVnd = parseVndAmount(promotion.maxDiscountAmount, true);
      if (discountVnd > capVnd) {
        discountVnd = capVnd;
      }
    }

    if (discountVnd > baseVnd) {
      discountVnd = baseVnd;
    }

    return {
      couponId: coupon.id,
      promotionId: promotion.id,
      couponCode: normalizedCode,
      discountAmountVnd: vndNumber(discountVnd),
    };
  }
}
