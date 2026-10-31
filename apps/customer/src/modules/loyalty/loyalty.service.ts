import { Injectable } from '@nestjs/common';
import { EventEnvelope, TenantContext } from '@pbl/common';
import {
  CUSTOMER_LOYALTY_HOLD_COMMITTED,
  CUSTOMER_LOYALTY_HOLD_CREATED,
  CUSTOMER_LOYALTY_HOLD_EXPIRED,
  CUSTOMER_LOYALTY_HOLD_RELEASED,
  CUSTOMER_LOYALTY_POINTS_EARNED,
  CUSTOMER_LOYALTY_POINTS_REDEEMED,
  CUSTOMER_LOYALTY_POINTS_REVERSED,
  LoyaltyHoldEventPayload,
  LoyaltyPointsEventPayload,
  OrderCompletedPayload,
  SALES_CHECKOUT_COMPLETED,
  SALES_ORDER_COMPLETED,
  SALES_RETURN_COMPLETED,
  SalesOrderLifecycleEventPayload,
  SalesReturnEventPayload,
} from '@pbl/contracts';
import { EventOutbox, OnEvent } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  CustomerDomainError,
  CustomerDomainErrorCode,
  calculateEarnedPoints,
  calculateReturnPointReversal,
  computeAvailablePoints,
  computeCanonicalHash,
  parseVndBigInt,
  toVndNumber,
  validatePointRedemption,
} from '../../domain/customer-domain';
import { getSchemaPrefix } from '../../infrastructure/persistence/customer-code.generator';
import {
  CustomerEntity,
  CustomerPurchaseProjectionEntity,
  LoyaltyAccountEntity,
  LoyaltyHoldEntity,
  LoyaltySettingEntity,
  LoyaltyTransactionEntity,
} from '../../infrastructure/persistence/customer.entities';
import { MembershipsService } from '../memberships/memberships.service';
import {
  CommitLoyaltyHoldDto,
  CreateLoyaltyHoldDto,
  ManualLoyaltyAdjustmentDto,
  ReleaseLoyaltyHoldDto,
  UpdateLoyaltySettingsDto,
} from './loyalty.dto';

/** Ledger type names of the screen contract: earn | redeem | adjust | expire | reverse. */
export function screenLoyaltyType(
  type: LoyaltyTransactionEntity['transactionType'],
): 'earn' | 'redeem' | 'adjust' | 'expire' | 'reverse' {
  switch (type) {
    case 'EARN':
      return 'earn';
    case 'REDEEM':
      return 'redeem';
    case 'EXPIRE':
      return 'expire';
    case 'EARN_REVERSAL':
    case 'REDEMPTION_REVERSAL':
      return 'reverse';
    default:
      return 'adjust';
  }
}

/** Settings in the screen-contract shape plus the extra service fields. */
export function toScreenLoyaltySettings(settings: LoyaltySettingEntity) {
  return {
    enabled: settings.isEnabled,
    earnAmountPerPoint: settings.earnAmountPerPoint,
    redeemValuePerPoint: settings.redeemValuePerPoint,
    pointsExpireMonths:
      settings.pointsExpirationDays === null
        ? null
        : Math.max(1, Math.round(settings.pointsExpirationDays / 30)),
    pointsExpirationDays: settings.pointsExpirationDays,
    minRedeemPoints: settings.minRedeemPoints,
    maxRedeemPointsPerOrder: settings.maxRedeemPointsPerOrder,
    holdTtlSeconds: settings.holdTtlSeconds,
    version: settings.version,
  };
}

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly membershipsService: MembershipsService,
    private readonly outbox: EventOutbox,
  ) {}

  async getSettings(): Promise<LoyaltySettingEntity> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return this.getOrCreateSettingsInTx(em, tenantId);
    });
  }

  async updateSettings(
    actorId: string,
    dto: UpdateLoyaltySettingsDto,
  ): Promise<LoyaltySettingEntity> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const settings = await this.getOrCreateSettingsInTx(em, tenantId, true);
      if (dto.isEnabled !== undefined) {
        settings.isEnabled = dto.isEnabled;
      }
      if (dto.earnAmountPerPoint !== undefined) {
        const val = parseVndBigInt(dto.earnAmountPerPoint, false);
        settings.earnAmountPerPoint = toVndNumber(val);
      }
      if (dto.redeemValuePerPoint !== undefined) {
        const val = parseVndBigInt(dto.redeemValuePerPoint, false);
        settings.redeemValuePerPoint = toVndNumber(val);
      }
      if (dto.minRedeemPoints !== undefined) {
        settings.minRedeemPoints = dto.minRedeemPoints;
      }
      if (dto.maxRedeemPointsPerOrder !== undefined) {
        settings.maxRedeemPointsPerOrder = dto.maxRedeemPointsPerOrder;
      }
      if (dto.holdTtlSeconds !== undefined) {
        settings.holdTtlSeconds = dto.holdTtlSeconds;
      }
      if (dto.pointsExpirationDays !== undefined) {
        settings.pointsExpirationDays = dto.pointsExpirationDays;
      }
      settings.version += 1;
      settings.updatedBy = actorId;
      settings.updatedAt = new Date();
      return em.save(LoyaltySettingEntity, settings);
    });
  }

  async getOrCreateSettingsInTx(
    em: EntityManager,
    tenantId: string,
    lock = false,
  ): Promise<LoyaltySettingEntity> {
    const existing = await em.getRepository(LoyaltySettingEntity).findOne({
      where: { tenantId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (existing) {
      return existing;
    }

    const prefix = getSchemaPrefix(this.dataSource);
    await em.query(
      `INSERT INTO ${prefix}"loyalty_settings" (
         id, tenant_id, is_enabled, earn_amount_per_point, redeem_value_per_point,
         min_redeem_points, max_redeem_points_per_order, hold_ttl_seconds, version
       )
       VALUES ($1, $2, true, 10000.00, 1000.00, 10, 10000, 900, 1)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [randomUUID(), tenantId],
    );

    const created = await em.getRepository(LoyaltySettingEntity).findOne({
      where: { tenantId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    return created!;
  }

  async ensureAccountInTx(
    em: EntityManager,
    tenantId: string,
    customerId: string,
    lock = false,
  ): Promise<LoyaltyAccountEntity> {
    const existing = await em.getRepository(LoyaltyAccountEntity).findOne({
      where: { tenantId, customerId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (existing) {
      return existing;
    }

    const prefix = getSchemaPrefix(this.dataSource);
    await em.query(
      `INSERT INTO ${prefix}"loyalty_accounts" (
         id, tenant_id, customer_id, posted_points_balance, held_points,
         lifetime_earned_points, lifetime_redeemed_points, qualifying_points,
         status, version
       )
       VALUES ($1, $2, $3, 0, 0, 0, 0, 0, 'ACTIVE', 1)
       ON CONFLICT (tenant_id, customer_id) DO NOTHING`,
      [randomUUID(), tenantId, customerId],
    );

    const account = await em.getRepository(LoyaltyAccountEntity).findOne({
      where: { tenantId, customerId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!account) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.LOYALTY_ACCOUNT_NOT_FOUND,
        `Loyalty account for customer ${customerId} not found`,
        404,
      );
    }
    return account;
  }

  async getLoyaltyAccount(customerId: string) {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const customer = await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
      });
      if (!customer || customer.deletedAt) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Customer ${customerId} not found`,
          404,
        );
      }

      const account = await this.ensureAccountInTx(
        em,
        tenantId,
        customerId,
        false,
      );
      const availablePoints = computeAvailablePoints(
        account.postedPointsBalance,
        account.heldPoints,
      );
      const pointsDebt = Math.max(0, -account.postedPointsBalance);

      return {
        ...account,
        availablePoints,
        pointsDebt,
      };
    });
  }

  async listLoyaltyTransactions(
    customerId: string,
    query: { limit?: number; offset?: number } = {},
  ) {
    const tenantId = TenantContext.require();
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const customer = await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
      });
      if (!customer || customer.deletedAt) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Customer ${customerId} not found`,
          404,
        );
      }

      const [items, total] = await em
        .getRepository(LoyaltyTransactionEntity)
        .findAndCount({
          where: { tenantId, customerId },
          order: { createdAt: 'DESC' },
          take: limit,
          skip: offset,
        });

      return {
        items,
        total,
        limit,
        offset,
      };
    });
  }

  /** Screen-contract ledger page: `{ data, pagination }` with mapped types and order codes. */
  async listTransactionsPage(
    customerId: string,
    query: { page?: number; limit?: number } = {},
  ) {
    const tenantId = TenantContext.require();
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const prefix = getSchemaPrefix(this.dataSource);

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const customer = await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
      });
      if (!customer || customer.deletedAt) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Customer ${customerId} not found`,
          404,
        );
      }
      const [rows, total] = await em
        .getRepository(LoyaltyTransactionEntity)
        .findAndCount({
          where: { tenantId, customerId },
          order: { createdAt: 'DESC', id: 'DESC' },
          take: limit,
          skip: (page - 1) * limit,
        });
      const orderIds = [
        ...new Set(rows.map((r) => r.orderId).filter(Boolean)),
      ] as string[];
      const codes = new Map<string, string>();
      if (orderIds.length > 0) {
        const found: Array<{ order_id: string; order_code: string }> =
          await em.query(
            `SELECT "order_id", "order_code"
             FROM ${prefix}"customer_purchase_projections"
             WHERE "tenant_id" = $1 AND "order_id" = ANY($2::uuid[])`,
            [tenantId, orderIds],
          );
        for (const r of found) codes.set(r.order_id, r.order_code);
      }
      const totalPages = Math.ceil(total / limit);
      return {
        data: rows.map((r) => ({
          id: r.id,
          type: screenLoyaltyType(r.transactionType),
          points: r.pointsDelta,
          orderId: r.orderId,
          orderCode: r.orderId ? (codes.get(r.orderId) ?? null) : null,
          balanceAfter: r.balanceAfter,
          reason: r.reason,
          createdAt: r.createdAt,
        })),
        pagination: {
          limit,
          currentPage: page,
          nextPage: page < totalPages ? page + 1 : null,
          totalRecords: total,
          totalPages,
        },
      };
    });
  }

  async adjustPoints(
    customerId: string,
    actorId: string,
    headerIdempotencyKey: string | undefined,
    dto: ManualLoyaltyAdjustmentDto,
  ) {
    const tenantId = TenantContext.require();
    if (!Number.isInteger(dto.pointsDelta) || dto.pointsDelta === 0) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        'pointsDelta must be a non-zero integer',
        422,
      );
    }
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        'reason is required for manual loyalty adjustment',
        422,
      );
    }

    const rawKey = (
      headerIdempotencyKey ??
      dto.idempotencyKey ??
      randomUUID()
    ).trim();
    const idempotencyKey = `manual_adj:${customerId}:${rawKey}`;

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const existingTx = await em
        .getRepository(LoyaltyTransactionEntity)
        .findOne({
          where: { tenantId, idempotencyKey },
        });
      if (existingTx) {
        const account = await this.ensureAccountInTx(
          em,
          tenantId,
          customerId,
          false,
        );
        return {
          transaction: existingTx,
          account: {
            ...account,
            availablePoints: computeAvailablePoints(
              account.postedPointsBalance,
              account.heldPoints,
            ),
          },
          replayed: true,
        };
      }

      const customer = await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!customer || customer.deletedAt) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Customer ${customerId} not found`,
          404,
        );
      }

      const account = await this.ensureAccountInTx(
        em,
        tenantId,
        customerId,
        true,
      );
      const balanceBefore = account.postedPointsBalance;
      const balanceAfter = balanceBefore + dto.pointsDelta;

      if (dto.pointsDelta < 0 && balanceAfter - account.heldPoints < 0) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.INSUFFICIENT_LOYALTY_POINTS,
          `Manual deduction of ${Math.abs(dto.pointsDelta)} points exceeds available balance (${computeAvailablePoints(balanceBefore, account.heldPoints)})`,
          409,
        );
      }

      account.postedPointsBalance = balanceAfter;
      if (dto.pointsDelta > 0) {
        account.lifetimeEarnedPoints += dto.pointsDelta;
        account.qualifyingPoints += dto.pointsDelta;
      } else {
        account.qualifyingPoints = Math.max(
          0,
          account.qualifyingPoints + dto.pointsDelta,
        );
      }
      account.version += 1;
      account.updatedAt = new Date();
      await em.save(LoyaltyAccountEntity, account);

      const tx = em.create(LoyaltyTransactionEntity, {
        id: randomUUID(),
        tenantId,
        customerId,
        loyaltyAccountId: account.id,
        transactionType: 'MANUAL_ADJUSTMENT',
        pointsDelta: dto.pointsDelta,
        balanceBefore,
        balanceAfter,
        sourceType: 'MANUAL',
        sourceRefId: rawKey,
        idempotencyKey,
        actorId,
        reason,
      });
      const savedTx = await em.save(LoyaltyTransactionEntity, tx);

      await this.membershipsService.recalculateCustomerTierWithinTransaction(
        em,
        tenantId,
        customerId,
        account.qualifyingPoints,
      );

      await this.outbox.add(
        em,
        dto.pointsDelta > 0
          ? CUSTOMER_LOYALTY_POINTS_EARNED
          : CUSTOMER_LOYALTY_POINTS_REVERSED,
        {
          transactionId: savedTx.id,
          customerId,
          loyaltyAccountId: account.id,
          transactionType: 'MANUAL_ADJUSTMENT',
          pointsDelta: dto.pointsDelta,
          postedBalanceAfter: balanceAfter,
          occurredAt: savedTx.createdAt.toISOString(),
        } satisfies LoyaltyPointsEventPayload,
      );

      return {
        transaction: savedTx,
        account: {
          ...account,
          availablePoints: computeAvailablePoints(
            account.postedPointsBalance,
            account.heldPoints,
          ),
        },
        replayed: false,
      };
    });
  }

  /**
   * Atomic S2S loyalty point hold creation (Section 12.3).
   */
  async createHold(
    headerIdempotencyKey: string | undefined,
    dto: CreateLoyaltyHoldDto,
  ) {
    const tenantId = TenantContext.require();
    const idempotencyKey = (
      headerIdempotencyKey ??
      dto.idempotencyKey ??
      ''
    ).trim();
    if (!idempotencyKey) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        'Idempotency-Key is required for loyalty point hold creation',
        422,
      );
    }

    const callerService = (dto.callerService ?? 'sales').trim().toLowerCase();
    const operation = 'HOLD';
    const sourceRefType = (dto.sourceRefType ?? 'CHECKOUT')
      .trim()
      .toUpperCase();
    const requestHash = computeCanonicalHash({
      customerId: dto.customerId,
      points: dto.points,
      sourceRefType,
      sourceRefId: dto.sourceRefId,
    });

    const formatHoldResponse = (
      hold: LoyaltyHoldEntity,
      account: LoyaltyAccountEntity,
      replayed: boolean,
    ) => ({
      holdId: hold.id,
      tenantId: hold.tenantId,
      customerId: hold.customerId,
      loyaltyAccountId: hold.loyaltyAccountId,
      points: hold.points,
      discountValueVnd: hold.discountValueVnd,
      state: hold.state,
      sourceRefType: hold.sourceRefType,
      sourceRefId: hold.sourceRefId,
      expiresAt: hold.expiresAt.toISOString(),
      postedPointsBalance: account.postedPointsBalance,
      heldPoints: account.heldPoints,
      availablePoints: computeAvailablePoints(
        account.postedPointsBalance,
        account.heldPoints,
      ),
      replayed,
    });

    try {
      return await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);

        // 1. Check existing hold by (tenantId, callerService, operation, idempotencyKey)
        const existingHold = await em.getRepository(LoyaltyHoldEntity).findOne({
          where: { tenantId, callerService, operation, idempotencyKey },
        });
        if (existingHold) {
          if (existingHold.requestHash !== requestHash) {
            throw new CustomerDomainError(
              CustomerDomainErrorCode.IDEMPOTENCY_CONFLICT,
              `Idempotency-Key "${idempotencyKey}" was already used with a different loyalty hold payload`,
              409,
            );
          }
          const acc = await this.ensureAccountInTx(
            em,
            tenantId,
            existingHold.customerId,
            false,
          );
          return formatHoldResponse(existingHold, acc, true);
        }

        // 2. Validate customer & lock loyalty account FOR UPDATE
        const customer = await em.getRepository(CustomerEntity).findOne({
          where: { id: dto.customerId, tenantId },
        });
        if (!customer || customer.deletedAt) {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
            `Customer ${dto.customerId} not found`,
            404,
          );
        }
        if (customer.status !== 'ACTIVE') {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.CUSTOMER_INACTIVE,
            `Customer ${dto.customerId} is ${customer.status} and cannot redeem loyalty points`,
            409,
          );
        }

        const settings = await this.getOrCreateSettingsInTx(
          em,
          tenantId,
          false,
        );
        const account = await this.ensureAccountInTx(
          em,
          tenantId,
          dto.customerId,
          true,
        );
        if (account.status !== 'ACTIVE') {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.LOYALTY_STATE_CONFLICT,
            `Loyalty account is ${account.status}`,
            409,
          );
        }

        const validated = validatePointRedemption({
          requestedPoints: dto.points,
          postedPointsBalance: account.postedPointsBalance,
          heldPoints: account.heldPoints,
          settings,
        });

        const ttlSeconds = dto.ttlSeconds ?? settings.holdTtlSeconds ?? 900;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

        account.heldPoints += dto.points;
        account.version += 1;
        account.updatedAt = now;
        await em.save(LoyaltyAccountEntity, account);

        const hold = em.create(LoyaltyHoldEntity, {
          id: randomUUID(),
          tenantId,
          customerId: dto.customerId,
          loyaltyAccountId: account.id,
          callerService,
          operation,
          idempotencyKey,
          requestHash,
          sourceRefType,
          sourceRefId: dto.sourceRefId,
          points: dto.points,
          discountValueVnd: validated.discountValueVnd,
          state: 'HELD',
          expiresAt,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        const savedHold = await em.save(LoyaltyHoldEntity, hold);

        await this.outbox.add(em, CUSTOMER_LOYALTY_HOLD_CREATED, {
          holdId: savedHold.id,
          customerId: savedHold.customerId,
          loyaltyAccountId: savedHold.loyaltyAccountId,
          points: savedHold.points,
          state: 'HELD',
          sourceRefType: savedHold.sourceRefType,
          sourceRefId: savedHold.sourceRefId,
          expiresAt: savedHold.expiresAt.toISOString(),
          occurredAt: now.toISOString(),
        } satisfies LoyaltyHoldEventPayload);

        return formatHoldResponse(savedHold, account, false);
      });
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === '23505'
      ) {
        return this.dataSource.transaction(async (em) => {
          await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
            tenantId,
          ]);
          const racedHold = await em.getRepository(LoyaltyHoldEntity).findOne({
            where: { tenantId, callerService, operation, idempotencyKey },
          });
          if (!racedHold) {
            throw err;
          }
          if (racedHold.requestHash !== requestHash) {
            throw new CustomerDomainError(
              CustomerDomainErrorCode.IDEMPOTENCY_CONFLICT,
              `Idempotency-Key "${idempotencyKey}" was already used with a different loyalty hold payload`,
              409,
            );
          }
          const acc = await this.ensureAccountInTx(
            em,
            tenantId,
            racedHold.customerId,
            false,
          );
          return formatHoldResponse(racedHold, acc, true);
        });
      }
      throw err;
    }
  }

  async getHoldById(holdId: string) {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const hold = await em.getRepository(LoyaltyHoldEntity).findOne({
        where: { id: holdId, tenantId },
      });
      if (!hold) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.LOYALTY_HOLD_NOT_FOUND,
          `Loyalty hold ${holdId} not found`,
          404,
        );
      }
      const account = await this.ensureAccountInTx(
        em,
        tenantId,
        hold.customerId,
        false,
      );
      return {
        holdId: hold.id,
        tenantId: hold.tenantId,
        customerId: hold.customerId,
        loyaltyAccountId: hold.loyaltyAccountId,
        points: hold.points,
        discountValueVnd: hold.discountValueVnd,
        state: hold.state,
        sourceRefType: hold.sourceRefType,
        sourceRefId: hold.sourceRefId,
        expiresAt: hold.expiresAt.toISOString(),
        postedPointsBalance: account.postedPointsBalance,
        heldPoints: account.heldPoints,
        availablePoints: computeAvailablePoints(
          account.postedPointsBalance,
          account.heldPoints,
        ),
      };
    });
  }

  /**
   * Atomic commit of a HELD loyalty point reservation (Section 12.4).
   */
  async commitHold(holdId: string, dto: CommitLoyaltyHoldDto = {}) {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const hold = await em.getRepository(LoyaltyHoldEntity).findOne({
        where: { id: holdId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!hold) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.LOYALTY_HOLD_NOT_FOUND,
          `Loyalty hold ${holdId} not found`,
          404,
        );
      }

      const account = await this.ensureAccountInTx(
        em,
        tenantId,
        hold.customerId,
        true,
      );

      if (hold.state === 'COMMITTED') {
        return {
          holdId: hold.id,
          customerId: hold.customerId,
          points: hold.points,
          discountValueVnd: hold.discountValueVnd,
          state: hold.state,
          postedPointsBalance: account.postedPointsBalance,
          heldPoints: account.heldPoints,
          availablePoints: computeAvailablePoints(
            account.postedPointsBalance,
            account.heldPoints,
          ),
          replayed: true,
        };
      }

      if (hold.state === 'RELEASED') {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.LOYALTY_STATE_CONFLICT,
          `Loyalty hold ${holdId} was already RELEASED and cannot be committed`,
          409,
        );
      }

      const now = new Date();
      if (
        hold.state === 'EXPIRED' ||
        hold.expiresAt.getTime() <= now.getTime()
      ) {
        if (hold.state === 'HELD') {
          account.heldPoints = Math.max(0, account.heldPoints - hold.points);
          account.version += 1;
          account.updatedAt = now;
          await em.save(LoyaltyAccountEntity, account);

          hold.state = 'EXPIRED';
          hold.releasedAt = now;
          hold.releaseReason = 'TTL_EXPIRED';
          hold.version += 1;
          hold.updatedAt = now;
          await em.save(LoyaltyHoldEntity, hold);
        }

        throw new CustomerDomainError(
          CustomerDomainErrorCode.LOYALTY_HOLD_EXPIRED,
          `Loyalty hold ${holdId} has expired and cannot be committed`,
          409,
        );
      }

      // Transition HELD -> COMMITTED and deduct both posted_points_balance and held_points
      const balanceBefore = account.postedPointsBalance;
      const balanceAfter = balanceBefore - hold.points;

      account.postedPointsBalance = balanceAfter;
      account.heldPoints = Math.max(0, account.heldPoints - hold.points);
      account.lifetimeRedeemedPoints += hold.points;
      account.version += 1;
      account.updatedAt = now;
      await em.save(LoyaltyAccountEntity, account);

      hold.state = 'COMMITTED';
      hold.committedAt = now;
      hold.version += 1;
      hold.updatedAt = now;
      await em.save(LoyaltyHoldEntity, hold);

      const tx = em.create(LoyaltyTransactionEntity, {
        id: randomUUID(),
        tenantId,
        customerId: hold.customerId,
        loyaltyAccountId: account.id,
        transactionType: 'REDEEM',
        pointsDelta: -hold.points,
        balanceBefore,
        balanceAfter,
        sourceType: hold.sourceRefType,
        sourceRefId: hold.id,
        idempotencyKey: `redeem:hold:${hold.id}`,
        orderId: dto.orderId ?? null,
        holdId: hold.id,
        actorId: dto.actorId ?? null,
        reason: `Redeemed ${hold.points} points for ${hold.sourceRefType} ${hold.sourceRefId}`,
        createdAt: now,
      });
      const savedTx = await em.save(LoyaltyTransactionEntity, tx);

      await this.outbox.add(em, CUSTOMER_LOYALTY_HOLD_COMMITTED, {
        holdId: hold.id,
        customerId: hold.customerId,
        loyaltyAccountId: account.id,
        points: hold.points,
        state: 'COMMITTED',
        sourceRefType: hold.sourceRefType,
        sourceRefId: hold.sourceRefId,
        expiresAt: hold.expiresAt.toISOString(),
        occurredAt: now.toISOString(),
      } satisfies LoyaltyHoldEventPayload);

      await this.outbox.add(em, CUSTOMER_LOYALTY_POINTS_REDEEMED, {
        transactionId: savedTx.id,
        customerId: hold.customerId,
        loyaltyAccountId: account.id,
        transactionType: 'REDEEM',
        pointsDelta: -hold.points,
        postedBalanceAfter: balanceAfter,
        orderId: dto.orderId ?? null,
        holdId: hold.id,
        occurredAt: now.toISOString(),
      } satisfies LoyaltyPointsEventPayload);

      return {
        holdId: hold.id,
        transactionId: savedTx.id,
        customerId: hold.customerId,
        points: hold.points,
        discountValueVnd: hold.discountValueVnd,
        state: hold.state,
        postedPointsBalance: account.postedPointsBalance,
        heldPoints: account.heldPoints,
        availablePoints: computeAvailablePoints(
          account.postedPointsBalance,
          account.heldPoints,
        ),
        replayed: false,
      };
    });
  }

  /**
   * Atomic release of a HELD loyalty point reservation (Section 12.5).
   */
  async releaseHold(holdId: string, dto: ReleaseLoyaltyHoldDto = {}) {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const hold = await em.getRepository(LoyaltyHoldEntity).findOne({
        where: { id: holdId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!hold) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.LOYALTY_HOLD_NOT_FOUND,
          `Loyalty hold ${holdId} not found`,
          404,
        );
      }

      const account = await this.ensureAccountInTx(
        em,
        tenantId,
        hold.customerId,
        true,
      );

      if (hold.state === 'RELEASED' || hold.state === 'EXPIRED') {
        return {
          holdId: hold.id,
          customerId: hold.customerId,
          points: hold.points,
          state: hold.state,
          postedPointsBalance: account.postedPointsBalance,
          heldPoints: account.heldPoints,
          availablePoints: computeAvailablePoints(
            account.postedPointsBalance,
            account.heldPoints,
          ),
          replayed: true,
        };
      }

      if (hold.state === 'COMMITTED') {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.LOYALTY_HOLD_ALREADY_COMMITTED,
          `Loyalty hold ${holdId} is already COMMITTED and cannot be released`,
          409,
        );
      }

      const now = new Date();
      account.heldPoints = Math.max(0, account.heldPoints - hold.points);
      account.version += 1;
      account.updatedAt = now;
      await em.save(LoyaltyAccountEntity, account);

      hold.state = 'RELEASED';
      hold.releasedAt = now;
      hold.releaseReason = dto.reason?.trim() ?? 'CHECKOUT_CANCELLED';
      hold.version += 1;
      hold.updatedAt = now;
      await em.save(LoyaltyHoldEntity, hold);

      await this.outbox.add(em, CUSTOMER_LOYALTY_HOLD_RELEASED, {
        holdId: hold.id,
        customerId: hold.customerId,
        loyaltyAccountId: account.id,
        points: hold.points,
        state: 'RELEASED',
        sourceRefType: hold.sourceRefType,
        sourceRefId: hold.sourceRefId,
        expiresAt: hold.expiresAt.toISOString(),
        occurredAt: now.toISOString(),
      } satisfies LoyaltyHoldEventPayload);

      return {
        holdId: hold.id,
        customerId: hold.customerId,
        points: hold.points,
        state: hold.state,
        postedPointsBalance: account.postedPointsBalance,
        heldPoints: account.heldPoints,
        availablePoints: computeAvailablePoints(
          account.postedPointsBalance,
          account.heldPoints,
        ),
        replayed: false,
      };
    });
  }

  /**
   * Concurrency-safe expiration sweep for overdue HELD reservations (Section 12.6).
   */
  async expireOverdueHolds(limit = 100): Promise<{ expiredCount: number }> {
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const overdueRows: Array<{ id: string }> = await em.query(
        `SELECT id FROM ${prefix}"loyalty_holds"
         WHERE tenant_id = $1 AND state = 'HELD' AND expires_at <= now()
         ORDER BY expires_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [tenantId, limit],
      );

      let expiredCount = 0;
      const now = new Date();

      for (const row of overdueRows) {
        const hold = await em.getRepository(LoyaltyHoldEntity).findOne({
          where: { id: row.id, tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!hold || hold.state !== 'HELD') continue;

        const account = await this.ensureAccountInTx(
          em,
          tenantId,
          hold.customerId,
          true,
        );

        account.heldPoints = Math.max(0, account.heldPoints - hold.points);
        account.version += 1;
        account.updatedAt = now;
        await em.save(LoyaltyAccountEntity, account);

        hold.state = 'EXPIRED';
        hold.releasedAt = now;
        hold.releaseReason = 'TTL_EXPIRED';
        hold.version += 1;
        hold.updatedAt = now;
        await em.save(LoyaltyHoldEntity, hold);

        await this.outbox.add(em, CUSTOMER_LOYALTY_HOLD_EXPIRED, {
          holdId: hold.id,
          customerId: hold.customerId,
          loyaltyAccountId: account.id,
          points: hold.points,
          state: 'EXPIRED',
          sourceRefType: hold.sourceRefType,
          sourceRefId: hold.sourceRefId,
          expiresAt: hold.expiresAt.toISOString(),
          occurredAt: now.toISOString(),
        } satisfies LoyaltyHoldEventPayload);

        expiredCount++;
      }

      return { expiredCount };
    });
  }

  /**
   * Event handler for Sales order completion (`sales.order.completed` / `sales.checkout.completed`).
   * Updates `customer_purchase_projections`, awards loyalty points idempotently,
   * and reconciles any out-of-order return reversals that arrived before the order event.
   */
  @OnEvent(SALES_ORDER_COMPLETED.type)
  async onSalesOrderCompleted(
    event: EventEnvelope<OrderCompletedPayload>,
    manager?: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    if (!p.customerId) {
      return;
    }

    const subtotalVnd = p.subtotal
      ? parseVndBigInt(p.subtotal, true)
      : BigInt(Math.max(0, Math.round(p.totalAmount)));
    const discountVnd = p.discountTotal
      ? parseVndBigInt(p.discountTotal, true)
      : 0n;
    const eligibleNetSpendVnd =
      subtotalVnd > discountVnd ? subtotalVnd - discountVnd : 0n;
    const grandTotalVnd = p.grandTotal
      ? parseVndBigInt(p.grandTotal, true)
      : BigInt(Math.max(0, Math.round(p.totalAmount)));

    await this.processCompletedSale({
      tenantId: event.tenantId!,
      eventId: event.id,
      customerId: p.customerId,
      orderId: p.orderId,
      orderCode: p.code,
      branchId: p.branchId,
      channelType: 'POS',
      originalOrderTotalVnd: toVndNumber(grandTotalVnd),
      eligibleNetSpendVnd: toVndNumber(eligibleNetSpendVnd),
      completedAt: p.completedAt ? new Date(p.completedAt) : new Date(),
      manager,
    });
  }

  @OnEvent(SALES_CHECKOUT_COMPLETED.type)
  async onSalesCheckoutCompleted(
    event: EventEnvelope<SalesOrderLifecycleEventPayload>,
    manager?: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    if (!p.customerId) {
      return;
    }
    const subtotalVnd = parseVndBigInt(p.subtotal, true);
    const discountVnd = parseVndBigInt(p.discountTotal, true);
    const eligibleNetSpendVnd =
      subtotalVnd > discountVnd ? subtotalVnd - discountVnd : 0n;

    await this.processCompletedSale({
      tenantId: event.tenantId!,
      eventId: event.id,
      customerId: p.customerId,
      orderId: p.orderId,
      orderCode: p.code,
      branchId: p.branchId,
      channelType: p.channelType ?? 'POS',
      originalOrderTotalVnd: toVndNumber(parseVndBigInt(p.grandTotal, true)),
      eligibleNetSpendVnd: toVndNumber(eligibleNetSpendVnd),
      completedAt: p.occurredAt ? new Date(p.occurredAt) : new Date(),
      manager,
    });
  }

  async processCompletedSale(params: {
    tenantId: string;
    eventId: string;
    customerId: string;
    orderId: string;
    orderCode: string;
    branchId?: string | null;
    channelType?: string;
    originalOrderTotalVnd: number;
    eligibleNetSpendVnd: number;
    completedAt?: Date;
    manager?: EntityManager;
  }) {
    const run = async (em: EntityManager) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        params.tenantId,
      ]);

      const customer = await em.getRepository(CustomerEntity).findOne({
        where: { id: params.customerId, tenantId: params.tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!customer || customer.deletedAt) {
        return { awardedPoints: 0, replayed: false };
      }

      // Check if EARN transaction already exists for this orderId
      const idempotencyKey = `earn:order:${params.orderId}`;
      const existingEarnTx = await em
        .getRepository(LoyaltyTransactionEntity)
        .findOne({
          where: {
            tenantId: params.tenantId,
            idempotencyKey,
          },
        });
      if (existingEarnTx) {
        return { awardedPoints: existingEarnTx.pointsDelta, replayed: true };
      }

      const settings = await this.getOrCreateSettingsInTx(
        em,
        params.tenantId,
        false,
      );
      const account = await this.ensureAccountInTx(
        em,
        params.tenantId,
        params.customerId,
        true,
      );

      const { earnedPoints, eligibleSpendVnd, appliedRateVnd } =
        calculateEarnedPoints(params.eligibleNetSpendVnd, settings);

      // Upsert purchase projection (handling any out-of-order return that arrived early)
      let projection = await em
        .getRepository(CustomerPurchaseProjectionEntity)
        .findOne({
          where: { tenantId: params.tenantId, orderId: params.orderId },
          lock: { mode: 'pessimistic_write' },
        });

      const preExistingReturnedVnd = projection ? projection.returnedAmount : 0;

      if (!projection) {
        projection = em.create(CustomerPurchaseProjectionEntity, {
          id: randomUUID(),
          tenantId: params.tenantId,
          customerId: params.customerId,
          orderId: params.orderId,
          orderCode: params.orderCode,
          branchId: params.branchId ?? null,
          channelType: params.channelType ?? 'POS',
          orderStatus: 'COMPLETED',
          originalOrderTotal: params.originalOrderTotalVnd,
          eligibleNetSpend: eligibleSpendVnd,
          returnedAmount: 0,
          earnedPoints,
          reversedPoints: 0,
          completedAt: params.completedAt ?? new Date(),
          lastEventId: params.eventId,
        });
      } else {
        projection.customerId = params.customerId;
        projection.orderCode = params.orderCode;
        projection.branchId = params.branchId ?? projection.branchId;
        projection.orderStatus = 'COMPLETED';
        projection.originalOrderTotal = params.originalOrderTotalVnd;
        projection.eligibleNetSpend = eligibleSpendVnd;
        projection.earnedPoints = earnedPoints;
        projection.lastEventId = params.eventId;
        projection.updatedAt = new Date();
      }

      let earnTx: LoyaltyTransactionEntity | null = null;
      if (earnedPoints > 0) {
        const balanceBefore = account.postedPointsBalance;
        const balanceAfter = balanceBefore + earnedPoints;
        account.postedPointsBalance = balanceAfter;
        account.lifetimeEarnedPoints += earnedPoints;
        account.qualifyingPoints += earnedPoints;
        account.version += 1;
        account.updatedAt = new Date();
        await em.save(LoyaltyAccountEntity, account);

        earnTx = em.create(LoyaltyTransactionEntity, {
          id: randomUUID(),
          tenantId: params.tenantId,
          customerId: params.customerId,
          loyaltyAccountId: account.id,
          transactionType: 'EARN',
          pointsDelta: earnedPoints,
          balanceBefore,
          balanceAfter,
          sourceType: 'ORDER',
          sourceRefId: params.orderId,
          idempotencyKey,
          orderId: params.orderId,
          eligibleSpendAmount: eligibleSpendVnd,
          appliedRateAmountPerPoint: appliedRateVnd,
          reversedPointsTotal: 0,
          correlationId: params.eventId,
          reason: `Earned ${earnedPoints} points from order ${params.orderCode}`,
        });
        earnTx = await em.save(LoyaltyTransactionEntity, earnTx);

        await this.outbox.add(
          em,
          CUSTOMER_LOYALTY_POINTS_EARNED,
          {
            transactionId: earnTx.id,
            customerId: params.customerId,
            loyaltyAccountId: account.id,
            transactionType: 'EARN',
            pointsDelta: earnedPoints,
            postedBalanceAfter: balanceAfter,
            orderId: params.orderId,
            occurredAt: earnTx.createdAt.toISOString(),
          } satisfies LoyaltyPointsEventPayload,
          { tenantId: params.tenantId },
        );
      }

      // If an out-of-order return arrived BEFORE the order completed event,
      // apply the deferred point reversal now!
      if (
        earnTx &&
        parseVndBigInt(preExistingReturnedVnd, true) > 0n &&
        projection.reversedPoints === 0
      ) {
        const revCalc = calculateReturnPointReversal({
          originalEarnedPoints: earnedPoints,
          alreadyReversedPoints: 0,
          originalEligibleSpendVnd: eligibleSpendVnd,
          returnRefundAmountVnd: preExistingReturnedVnd,
          cumulativeRefundedAmountVnd: preExistingReturnedVnd,
        });
        if (revCalc.pointsToReverse > 0) {
          const revBefore = account.postedPointsBalance;
          const revAfter = revBefore - revCalc.pointsToReverse;
          account.postedPointsBalance = revAfter;
          account.qualifyingPoints = Math.max(
            0,
            account.qualifyingPoints - revCalc.pointsToReverse,
          );
          account.version += 1;
          await em.save(LoyaltyAccountEntity, account);

          const revTx = em.create(LoyaltyTransactionEntity, {
            id: randomUUID(),
            tenantId: params.tenantId,
            customerId: params.customerId,
            loyaltyAccountId: account.id,
            transactionType: 'EARN_REVERSAL',
            pointsDelta: -revCalc.pointsToReverse,
            balanceBefore: revBefore,
            balanceAfter: revAfter,
            sourceType: 'RETURN',
            sourceRefId: `deferred:${params.orderId}`,
            idempotencyKey: `earn_reversal:deferred:${params.orderId}`,
            orderId: params.orderId,
            originalTransactionId: earnTx.id,
            appliedRateAmountPerPoint: appliedRateVnd,
            reason: `Deferred return reversal for order ${params.orderCode}`,
          });
          const savedRevTx = await em.save(LoyaltyTransactionEntity, revTx);
          projection.reversedPoints = revCalc.pointsToReverse;

          await this.outbox.add(
            em,
            CUSTOMER_LOYALTY_POINTS_REVERSED,
            {
              transactionId: savedRevTx.id,
              customerId: params.customerId,
              loyaltyAccountId: account.id,
              transactionType: 'EARN_REVERSAL',
              pointsDelta: -revCalc.pointsToReverse,
              postedBalanceAfter: revAfter,
              orderId: params.orderId,
              occurredAt: savedRevTx.createdAt.toISOString(),
            } satisfies LoyaltyPointsEventPayload,
            { tenantId: params.tenantId },
          );
        }
      }

      await em.save(CustomerPurchaseProjectionEntity, projection);

      await this.membershipsService.recalculateCustomerTierWithinTransaction(
        em,
        params.tenantId,
        params.customerId,
        account.qualifyingPoints,
      );

      return { awardedPoints: earnedPoints, replayed: false };
    };

    if (params.manager) {
      return run(params.manager);
    }
    return this.dataSource.transaction(run);
  }

  /**
   * Event handler for Sales return completion (`sales.return.completed`).
   * Reverses eligible earned points using the original EARN transaction snapshot.
   */
  @OnEvent(SALES_RETURN_COMPLETED.type)
  async onSalesReturnCompleted(
    event: EventEnvelope<SalesReturnEventPayload>,
    manager?: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    await this.processCompletedReturn({
      tenantId: event.tenantId!,
      eventId: event.id,
      returnId: p.returnId,
      returnCode: p.code,
      orderId: p.orderId,
      customerId: p.customerId ?? null,
      refundAmountVnd: p.totalRefundAmount,
      manager,
    });
  }

  async processCompletedReturn(params: {
    tenantId: string;
    eventId: string;
    returnId: string;
    returnCode: string;
    orderId: string;
    customerId?: string | null;
    refundAmountVnd: number;
    manager?: EntityManager;
  }) {
    const run = async (em: EntityManager) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        params.tenantId,
      ]);

      const idempotencyKey = `earn_reversal:return:${params.returnId}`;
      const existingRev = await em
        .getRepository(LoyaltyTransactionEntity)
        .findOne({
          where: { tenantId: params.tenantId, idempotencyKey },
        });
      if (existingRev) {
        return {
          reversedPoints: Math.abs(existingRev.pointsDelta),
          replayed: true,
        };
      }

      let projection = await em
        .getRepository(CustomerPurchaseProjectionEntity)
        .findOne({
          where: { tenantId: params.tenantId, orderId: params.orderId },
          lock: { mode: 'pessimistic_write' },
        });

      const refundVnd = parseVndBigInt(params.refundAmountVnd, true);

      // Out-of-order case (Test K): return event arrived BEFORE order-completed event!
      if (!projection) {
        if (!params.customerId) {
          return { reversedPoints: 0, replayed: false, deferred: true };
        }
        projection = em.create(CustomerPurchaseProjectionEntity, {
          id: randomUUID(),
          tenantId: params.tenantId,
          customerId: params.customerId,
          orderId: params.orderId,
          orderCode: `PENDING-${params.orderId.slice(0, 8)}`,
          orderStatus: 'PENDING_ORDER_EVENT',
          originalOrderTotal: 0,
          eligibleNetSpend: 0,
          returnedAmount: toVndNumber(refundVnd),
          earnedPoints: 0,
          reversedPoints: 0,
          lastEventId: `return:${params.returnId}`,
        });
        await em.save(CustomerPurchaseProjectionEntity, projection);
        return { reversedPoints: 0, replayed: false, deferred: true };
      }

      if (projection.lastEventId === `return:${params.returnId}`) {
        return { reversedPoints: 0, replayed: true };
      }

      const prevReturnedVnd = parseVndBigInt(projection.returnedAmount, true);
      const newCumulativeReturnedVnd = prevReturnedVnd + refundVnd;
      projection.returnedAmount = toVndNumber(newCumulativeReturnedVnd);
      projection.lastEventId = `return:${params.returnId}`;
      projection.updatedAt = new Date();

      const earnTx = await em.getRepository(LoyaltyTransactionEntity).findOne({
        where: {
          tenantId: params.tenantId,
          orderId: params.orderId,
          transactionType: 'EARN',
        },
      });

      if (!earnTx) {
        await em.save(CustomerPurchaseProjectionEntity, projection);
        return { reversedPoints: 0, replayed: false, deferred: true };
      }

      // Compute already-reversed points for this order from append-only ledger
      const prefix = getSchemaPrefix(this.dataSource);
      const sumRows: Array<{ total_rev: string | number }> = await em.query(
        `SELECT COALESCE(SUM(ABS(points_delta)), 0) AS total_rev
         FROM ${prefix}"loyalty_transactions"
         WHERE tenant_id = $1 AND order_id = $2 AND transaction_type = 'EARN_REVERSAL'`,
        [params.tenantId, params.orderId],
      );
      const alreadyReversedPoints = Number(sumRows[0]?.total_rev ?? 0);

      const { pointsToReverse } = calculateReturnPointReversal({
        originalEarnedPoints: earnTx.pointsDelta,
        alreadyReversedPoints,
        originalEligibleSpendVnd:
          earnTx.eligibleSpendAmount ?? projection.eligibleNetSpend,
        returnRefundAmountVnd: toVndNumber(refundVnd),
        cumulativeRefundedAmountVnd: toVndNumber(newCumulativeReturnedVnd),
      });

      projection.reversedPoints = alreadyReversedPoints + pointsToReverse;
      await em.save(CustomerPurchaseProjectionEntity, projection);

      if (pointsToReverse <= 0) {
        return { reversedPoints: 0, replayed: false };
      }

      const account = await this.ensureAccountInTx(
        em,
        params.tenantId,
        projection.customerId,
        true,
      );

      // Clawback policy (ADR-0016): posted_points_balance may become negative if customer already redeemed earned points
      const balanceBefore = account.postedPointsBalance;
      const balanceAfter = balanceBefore - pointsToReverse;
      account.postedPointsBalance = balanceAfter;
      account.qualifyingPoints = Math.max(
        0,
        account.qualifyingPoints - pointsToReverse,
      );
      account.version += 1;
      account.updatedAt = new Date();
      await em.save(LoyaltyAccountEntity, account);

      const revTx = em.create(LoyaltyTransactionEntity, {
        id: randomUUID(),
        tenantId: params.tenantId,
        customerId: projection.customerId,
        loyaltyAccountId: account.id,
        transactionType: 'EARN_REVERSAL',
        pointsDelta: -pointsToReverse,
        balanceBefore,
        balanceAfter,
        sourceType: 'RETURN',
        sourceRefId: params.returnId,
        idempotencyKey,
        orderId: params.orderId,
        returnId: params.returnId,
        originalTransactionId: earnTx.id,
        appliedRateAmountPerPoint: earnTx.appliedRateAmountPerPoint,
        correlationId: params.eventId,
        reason: `Reversed ${pointsToReverse} points for return ${params.returnCode}`,
      });
      const savedRevTx = await em.save(LoyaltyTransactionEntity, revTx);

      await this.membershipsService.recalculateCustomerTierWithinTransaction(
        em,
        params.tenantId,
        projection.customerId,
        account.qualifyingPoints,
      );

      await this.outbox.add(
        em,
        CUSTOMER_LOYALTY_POINTS_REVERSED,
        {
          transactionId: savedRevTx.id,
          customerId: projection.customerId,
          loyaltyAccountId: account.id,
          transactionType: 'EARN_REVERSAL',
          pointsDelta: -pointsToReverse,
          postedBalanceAfter: balanceAfter,
          orderId: params.orderId,
          returnId: params.returnId,
          occurredAt: savedRevTx.createdAt.toISOString(),
        } satisfies LoyaltyPointsEventPayload,
        { tenantId: params.tenantId },
      );

      return { reversedPoints: pointsToReverse, replayed: false };
    };

    if (params.manager) {
      return run(params.manager);
    }
    return this.dataSource.transaction(run);
  }

  /**
   * Loyalty Reconciliation Worker (Section 27):
   *  1. Expires overdue HELD holds.
   *  2. Verifies posted_points_balance == SUM(loyalty_transactions.points_delta).
   *  3. Verifies held_points == SUM(loyalty_holds.points WHERE state = 'HELD').
   */
  async reconcileTenantLoyalty() {
    const tenantId = TenantContext.require();
    const { expiredCount } = await this.expireOverdueHolds(500);
    const prefix = getSchemaPrefix(this.dataSource);

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const rows: Array<{
        account_id: string;
        customer_id: string;
        posted_points_balance: number;
        held_points: number;
        ledger_sum: string | number;
        active_holds_sum: string | number;
      }> = await em.query(
        `SELECT
           a.id AS account_id,
           a.customer_id,
           a.posted_points_balance,
           a.held_points,
           COALESCE((
             SELECT SUM(t.points_delta)
             FROM ${prefix}"loyalty_transactions" t
             WHERE t.tenant_id = a.tenant_id AND t.loyalty_account_id = a.id
           ), 0) AS ledger_sum,
           COALESCE((
             SELECT SUM(h.points)
             FROM ${prefix}"loyalty_holds" h
             WHERE h.tenant_id = a.tenant_id AND h.loyalty_account_id = a.id AND h.state = 'HELD'
           ), 0) AS active_holds_sum
         FROM ${prefix}"loyalty_accounts" a
         WHERE a.tenant_id = $1`,
        [tenantId],
      );

      const discrepancies: Array<{
        accountId: string;
        customerId: string;
        postedPointsBalance: number;
        ledgerSum: number;
        heldPoints: number;
        activeHoldsSum: number;
      }> = [];

      for (const r of rows) {
        const ledgerSum = Number(r.ledger_sum);
        const activeHoldsSum = Number(r.active_holds_sum);
        if (
          Number(r.posted_points_balance) !== ledgerSum ||
          Number(r.held_points) !== activeHoldsSum
        ) {
          discrepancies.push({
            accountId: r.account_id,
            customerId: r.customer_id,
            postedPointsBalance: Number(r.posted_points_balance),
            ledgerSum,
            heldPoints: Number(r.held_points),
            activeHoldsSum,
          });
        }
      }

      return {
        tenantId,
        checkedAccounts: rows.length,
        expiredHoldsCount: expiredCount,
        discrepancyCount: discrepancies.length,
        discrepancies,
        checkedAt: new Date().toISOString(),
      };
    });
  }
}
