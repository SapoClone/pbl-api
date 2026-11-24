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
import {
  CreateCouponDto,
  CreatePromotionDto,
  EvaluateCouponDto,
  UpdateCouponDto,
  UpdatePromotionDto,
} from './promotions.dto';

export interface EvaluatedCouponResult {
  couponId: string;
  promotionId: string;
  couponCode: string;
  discountAmountVnd: number;
}

/** Everything `evaluateCoupon` knows about the coupon, its promotion and the amounts it computed */
export interface CouponEvaluation extends EvaluatedCouponResult {
  promotionCode: string;
  promotionName: string;
  discountType: string;
  discountValue: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  orderAmountVnd: number;
  finalAmountVnd: number;
}

/** What the order being priced is, for promotions limited to channels or customer groups */
export interface CouponContext {
  /** POS, WEBSITE, SHOPEE, ... (compared case-insensitively) */
  channelType?: string | null;
  /** The customer's group when the caller knows it (checkout does not resolve groups: see evaluateCoupon) */
  customerGroupId?: string | null;
}

interface PromotionRules {
  discountType: string;
  discountValue: number;
  startsAt: Date | null;
  endsAt: Date | null;
}

function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SalesDomainError(
      SalesDomainErrorCode.VALIDATION_ERROR,
      `${field} is not a valid date`,
      422,
    );
  }
  return date;
}

/** The rules create and edit share: whole-VND fixed value, percent <= 100, start not after end */
function assertPromotionRules(rules: PromotionRules): void {
  if (
    rules.discountType === 'FIXED' &&
    !Number.isSafeInteger(rules.discountValue)
  ) {
    throw new SalesDomainError(
      SalesDomainErrorCode.VALIDATION_ERROR,
      'A fixed promotion discount must be a whole number of VND',
      422,
    );
  }
  if (rules.discountType === 'PERCENT' && rules.discountValue > 100) {
    throw new SalesDomainError(
      SalesDomainErrorCode.INVALID_DISCOUNT,
      'Percentage promotion discount cannot exceed 100%',
      422,
    );
  }
  if (rules.startsAt && rules.endsAt && rules.startsAt > rules.endsAt) {
    throw new SalesDomainError(
      SalesDomainErrorCode.VALIDATION_ERROR,
      'A promotion cannot start after it ends',
      422,
    );
  }
}

const normalizeChannels = (values: string[] | undefined): string[] => [
  ...new Set((values ?? []).map((v) => v.trim().toUpperCase()).filter(Boolean)),
];

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
    assertPromotionRules({
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      startsAt: dto.startsAt ? parseDate(dto.startsAt, 'startsAt') : null,
      endsAt: dto.endsAt ? parseDate(dto.endsAt, 'endsAt') : null,
    });

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
        description: dto.description?.trim() || null,
        channelTypes: normalizeChannels(dto.channelTypes),
        customerGroupIds: dto.customerGroupIds ?? [],
        status: dto.status ?? 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
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

  async updatePromotion(
    id: string,
    dto: UpdatePromotionDto,
    scope: BranchScope,
  ): Promise<PromotionEntity> {
    const tenantId = TenantContext.require();
    if (dto.branchId) {
      assertBranchAllowed(
        scope,
        dto.branchId,
        'VALIDATION_ERROR',
        'Branch not found',
      );
    }
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const promo = await em.getRepository(PromotionEntity).findOne({
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!promo || (promo.branchId && !branchAllowed(scope, promo.branchId))) {
        throw new SalesDomainError(
          SalesDomainErrorCode.PROMOTION_NOT_FOUND,
          'Promotion not found',
          404,
        );
      }

      const next = {
        discountType: dto.discountType ?? promo.discountType,
        discountValue: dto.discountValue ?? promo.discountValue,
        startsAt:
          dto.startsAt === undefined
            ? promo.startsAt
            : dto.startsAt === null
              ? null
              : parseDate(dto.startsAt, 'startsAt'),
        endsAt:
          dto.endsAt === undefined
            ? promo.endsAt
            : dto.endsAt === null
              ? null
              : parseDate(dto.endsAt, 'endsAt'),
      };
      assertPromotionRules(next);

      if (dto.name !== undefined) promo.name = dto.name.trim();
      if (dto.description !== undefined) {
        promo.description = dto.description?.trim() || null;
      }
      promo.discountType = next.discountType;
      promo.discountValue = next.discountValue;
      if (dto.minOrderAmount !== undefined) {
        promo.minOrderAmount = dto.minOrderAmount;
      }
      if (dto.maxDiscountAmount !== undefined) {
        promo.maxDiscountAmount = dto.maxDiscountAmount;
      }
      if (dto.branchId !== undefined) promo.branchId = dto.branchId;
      promo.startsAt = next.startsAt;
      promo.endsAt = next.endsAt;
      if (dto.channelTypes !== undefined) {
        promo.channelTypes = normalizeChannels(dto.channelTypes);
      }
      if (dto.customerGroupIds !== undefined) {
        promo.customerGroupIds = dto.customerGroupIds;
      }
      if (dto.status !== undefined) promo.status = dto.status;
      promo.updatedAt = new Date();
      return em.save(PromotionEntity, promo);
    });
  }

  async updateCoupon(
    id: string,
    dto: UpdateCouponDto,
    scope: BranchScope,
  ): Promise<CouponEntity> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const coupon = await em.getRepository(CouponEntity).findOne({
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      const promotion = coupon
        ? await em.getRepository(PromotionEntity).findOne({
            where: { id: coupon.promotionId, tenantId },
          })
        : null;
      if (
        !coupon ||
        (promotion?.branchId && !branchAllowed(scope, promotion.branchId))
      ) {
        throw new SalesDomainError(
          SalesDomainErrorCode.COUPON_NOT_FOUND,
          'Coupon not found',
          404,
        );
      }
      if (
        dto.maxUses !== undefined &&
        dto.maxUses !== null &&
        dto.maxUses < Number(coupon.usedCount)
      ) {
        throw new SalesDomainError(
          SalesDomainErrorCode.COUPON_MAX_USES_BELOW_USED,
          `Coupon ${coupon.code} was already used ${coupon.usedCount} times: the usage limit cannot be lower`,
          409,
          { usedCount: Number(coupon.usedCount), maxUses: dto.maxUses },
        );
      }
      if (dto.maxUses !== undefined) coupon.maxUses = dto.maxUses;
      if (dto.maxUsesPerCustomer !== undefined) {
        coupon.maxUsesPerCustomer = dto.maxUsesPerCustomer;
      }
      if (dto.status !== undefined) coupon.status = dto.status;
      return em.save(CouponEntity, coupon);
    });
  }

  /**
   * The read-only preview of a coupon (promotions simulator, POS): the same `evaluateCoupon` the
   * checkout runs, without the row lock and without consuming a use. A coupon that does not
   * qualify answers the coded 409 the checkout would answer.
   */
  async evaluateCouponPreview(
    dto: EvaluateCouponDto,
    scope: BranchScope,
  ): Promise<CouponEvaluation> {
    assertBranchAllowed(
      scope,
      dto.branchId,
      'ORDER_NOT_FOUND',
      'Branch not found',
    );
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return this.evaluateCoupon(
        em,
        tenantId,
        dto.code,
        dto.orderAmount,
        dto.branchId,
        dto.customerId ?? null,
        false,
        {
          channelType: dto.channelType ?? null,
          customerGroupId: dto.customerGroupId ?? null,
        },
      );
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
        status: dto.status ?? 'ACTIVE',
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
    ctx: CouponContext = {},
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
        ctx,
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
    ctx: CouponContext = {},
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
      ctx,
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
    ctx: CouponContext = {},
  ): Promise<CouponEvaluation> {
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

    // Channel and customer group: an empty list means everyone. The checkout does not resolve a
    // customer's group, so a group-limited promotion never applies there (it answers COUPON_INVALID)
    const channels = promotion.channelTypes ?? [];
    // an ONLINE order is the WEBSITE channel of the promotion screens
    const rawChannel = ctx.channelType?.trim().toUpperCase() ?? null;
    const channel = rawChannel === 'ONLINE' ? 'WEBSITE' : rawChannel;
    if (channels.length > 0 && (!channel || !channels.includes(channel))) {
      throw new SalesDomainError(
        SalesDomainErrorCode.COUPON_INVALID,
        `Coupon ${normalizedCode} only applies to the channels: ${channels.join(', ')}`,
        409,
        { couponCode: normalizedCode, channelTypes: channels },
      );
    }
    const groups = promotion.customerGroupIds ?? [];
    if (
      groups.length > 0 &&
      (!ctx.customerGroupId || !groups.includes(ctx.customerGroupId))
    ) {
      throw new SalesDomainError(
        SalesDomainErrorCode.COUPON_INVALID,
        `Coupon ${normalizedCode} only applies to customers of selected customer groups`,
        409,
        { couponCode: normalizedCode },
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
      promotionCode: promotion.code,
      promotionName: promotion.name,
      discountType: promotion.discountType,
      discountValue: promotion.discountValue,
      minOrderAmount: vndNumber(minOrderVnd),
      maxDiscountAmount:
        promotion.maxDiscountAmount === null
          ? null
          : toMoney(promotion.maxDiscountAmount),
      orderAmountVnd: vndNumber(baseVnd),
      finalAmountVnd: vndNumber(baseVnd - discountVnd),
    };
  }
}
