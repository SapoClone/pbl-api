import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext, TenantScopedRepository } from '@pbl/common';
import { OrderCompletedPayload } from '@pbl/contracts';
import { qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CustomerErrorCode, Page, toPage } from '../common/errors';
import { rowsOf } from '../common/rows';
import {
  ListLoyaltyTransactionsReqDto,
  LoyaltyAdjustmentReqDto,
  UpdateLoyaltySettingsReqDto,
} from '../customers/dto/customer.dto';
import {
  CustomerEntity,
  DEFAULT_AMOUNT_PER_POINT,
  LoyaltySettingEntity,
  LoyaltyTransactionEntity,
} from '../entities/customer.entities';

export interface LoyaltySettingsRes {
  enabled: boolean;
  earnAmountPerPoint: number;
  redeemValuePerPoint: number;
  pointsExpireMonths: number | null;
}

export interface LoyaltyTransactionRes {
  id: string;
  type: string;
  points: number;
  balanceAfter: number;
  orderId: string | null;
  orderCode: string | null;
  note: string | null;
  createdAt: string;
}

const toSettings = (s: LoyaltySettingEntity): LoyaltySettingsRes => ({
  enabled: s.isEnabled,
  earnAmountPerPoint: s.amountPerPoint,
  redeemValuePerPoint: s.redeemValuePerPoint,
  pointsExpireMonths: s.pointsExpireMonths,
});

const toTransaction = (t: LoyaltyTransactionEntity): LoyaltyTransactionRes => ({
  id: t.id,
  type: t.type,
  points: t.points,
  balanceAfter: t.balanceAfter,
  orderId: t.refType === 'order' ? t.refId : null,
  orderCode: t.refType === 'order' ? t.refCode : null,
  note: t.note,
  createdAt: t.createdAt.toISOString(),
});

/** The tenant's loyalty setting, created with the defaults the first time it is read */
export async function loadLoyaltySetting(
  em: EntityManager,
  tenantId: string,
): Promise<LoyaltySettingEntity> {
  const settings = TenantScopedRepository.forEntity(em, LoyaltySettingEntity);
  const found = await settings.findOneBy({ tenantId });
  if (found) return found;
  await em
    .createQueryBuilder()
    .insert()
    .into(LoyaltySettingEntity)
    .values({ tenantId })
    .orIgnore()
    .execute();
  return (await settings.findOneBy({ tenantId }))!;
}

@Injectable()
export class LoyaltyService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getSettings(): Promise<LoyaltySettingsRes> {
    const setting = await loadLoyaltySetting(
      this.dataSource.manager,
      TenantContext.require(),
    );
    return toSettings(setting);
  }

  async updateSettings(
    dto: UpdateLoyaltySettingsReqDto,
  ): Promise<LoyaltySettingsRes> {
    const tenantId = TenantContext.require();
    await loadLoyaltySetting(this.dataSource.manager, tenantId);
    const settings = TenantScopedRepository.forEntity(
      this.dataSource,
      LoyaltySettingEntity,
    );
    const patch: Partial<LoyaltySettingEntity> = { updatedAt: new Date() };
    if (dto.enabled !== undefined) patch.isEnabled = dto.enabled;
    if (dto.earnAmountPerPoint !== undefined)
      patch.amountPerPoint = dto.earnAmountPerPoint;
    if (dto.redeemValuePerPoint !== undefined)
      patch.redeemValuePerPoint = dto.redeemValuePerPoint;
    if (dto.pointsExpireMonths !== undefined)
      patch.pointsExpireMonths = dto.pointsExpireMonths;
    await settings.update({ tenantId }, patch);
    return toSettings((await settings.findOneBy({ tenantId }))!);
  }

  async listTransactions(
    customerId: string,
    query: ListLoyaltyTransactionsReqDto,
  ): Promise<Page<LoyaltyTransactionRes>> {
    const customers = TenantScopedRepository.forEntity(
      this.dataSource,
      CustomerEntity,
    );
    if (!(await customers.exists({ where: { id: customerId } }))) {
      throw new NotFoundException();
    }
    const transactions = TenantScopedRepository.forEntity(
      this.dataSource,
      LoyaltyTransactionEntity,
    );
    const [rows, total] = await transactions.findAndCount({
      where: { customerId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: query.limit,
      skip: (query.page - 1) * query.limit,
    });
    return toPage(rows.map(toTransaction), total, query.page, query.limit);
  }

  /** A manual correction; the balance never goes below zero (the database agrees) */
  async adjust(
    customerId: string,
    dto: LoyaltyAdjustmentReqDto,
  ): Promise<{ transaction: LoyaltyTransactionRes; balance: number }> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      const balance = await this.changeBalance(
        em,
        tenantId,
        customerId,
        dto.points,
      );
      if (balance === null) {
        const exists = await TenantScopedRepository.forEntity(
          em,
          CustomerEntity,
        ).exists({
          where: { id: customerId },
        });
        if (!exists) throw new NotFoundException();
        throw new BadRequestException({
          errorCode: CustomerErrorCode.NEGATIVE_BALANCE,
          message: 'The balance cannot go below zero',
        });
      }
      const saved = await TenantScopedRepository.forEntity(
        em,
        LoyaltyTransactionEntity,
      ).save({
        id: randomUUID(),
        customerId,
        type: 'adjust',
        points: dto.points,
        balanceAfter: balance,
        refType: null,
        refId: null,
        refCode: null,
        note: dto.reason,
      });
      const row = await TenantScopedRepository.forEntity(
        em,
        LoyaltyTransactionEntity,
      ).findOneBy({
        id: saved.id,
      });
      return { transaction: toTransaction(row!), balance };
    });
  }

  /**
   * Adds `points` (may be negative) to a live customer's balance and returns the new
   * balance; null when the customer is not this store's or the result would be negative.
   */
  async changeBalance(
    em: EntityManager,
    tenantId: string,
    customerId: string,
    points: number,
  ): Promise<number | null> {
    const customer = qualifiedTable(em.connection, 'customer');
    const rows = rowsOf<{ points_balance: number }>(
      await em.query(
        `UPDATE ${customer} SET "points_balance" = "points_balance" + $1, "updated_at" = now()
         WHERE "id" = $2 AND "tenant_id" = $3 AND "deleted_at" IS NULL AND "points_balance" + $1 >= 0
         RETURNING "points_balance"`,
        [points, customerId, tenantId],
      ),
    );
    return rows.length === 0 ? null : Number(rows[0].points_balance);
  }

  /**
   * sales.order.completed: the buyer's order count, spend and last purchase move, and
   * points are earned (floor(total / amountPerPoint)) when the programme is on. Runs in
   * the inbox transaction. An order without a customer, or whose customer is not this
   * store's (or was deleted), changes nothing.
   */
  async onOrderCompleted(
    em: EntityManager,
    tenantId: string,
    order: OrderCompletedPayload,
  ): Promise<void> {
    const customerId = order.customerId;
    if (!customerId) return;
    const customer = qualifiedTable(em.connection, 'customer');
    const total = Math.max(0, Math.trunc(order.totalAmount));
    const completedAt = new Date(order.completedAt);
    const when = Number.isNaN(completedAt.getTime()) ? new Date() : completedAt;

    const setting = await loadLoyaltySetting(em, tenantId);
    const perPoint =
      setting.amountPerPoint > 0
        ? setting.amountPerPoint
        : DEFAULT_AMOUNT_PER_POINT;
    const points = setting.isEnabled ? Math.floor(total / perPoint) : 0;

    const rows = rowsOf<{ points_balance: number }>(
      await em.query(
        `UPDATE ${customer} SET
           "order_count" = "order_count" + 1,
           "total_spent" = "total_spent" + $3,
           "last_purchase_at" = GREATEST(COALESCE("last_purchase_at", $4), $4),
           "points_balance" = "points_balance" + $5,
           "updated_at" = now()
         WHERE "id" = $1 AND "tenant_id" = $2 AND "deleted_at" IS NULL
         RETURNING "points_balance"`,
        [customerId, tenantId, total, when, points],
      ),
    );
    if (rows.length === 0 || points === 0) return;

    await em
      .createQueryBuilder()
      .insert()
      .into(LoyaltyTransactionEntity)
      .values({
        id: randomUUID(),
        tenantId,
        customerId,
        type: 'earn',
        points,
        balanceAfter: Number(rows[0].points_balance),
        refType: 'order',
        refId: order.orderId,
        refCode: order.code,
        note: null,
      })
      .execute();
  }
}
