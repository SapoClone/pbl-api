import { Injectable } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import {
  CUSTOMER_CREATED,
  CUSTOMER_DEACTIVATED,
  CUSTOMER_GROUP_CHANGED,
  CUSTOMER_LOYALTY_POINTS_EARNED,
  CUSTOMER_MEMBERSHIP_CHANGED,
  CUSTOMER_UPDATED,
  CustomerGroupChangedPayload,
  CustomerLifecycleEventPayload,
  CustomerMembershipChangedPayload,
  FINANCE_RECEIVABLE_CREATED,
  FINANCE_RECEIVABLE_PAYMENT_APPLIED,
  FinanceReceivableEventPayload,
  LoyaltyPointsEventPayload,
} from '@pbl/contracts';
import { EventOutbox, OnEvent } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { toMoney } from '../../common/money';
import {
  computeAvailablePoints,
  CustomerDomainError,
  CustomerDomainErrorCode,
  formatPhoneMasked,
  maskAddressPhones,
  maskPhoneNumber,
  normalizeEmail,
  normalizePhoneNumber,
  parseVndBigInt,
  resolveEligibleMembershipTier,
  sanitizeCsvCell,
  toVndNumber,
} from '../../domain/customer-domain';
import {
  getSchemaPrefix,
  nextCustomerDocumentCode,
} from '../../infrastructure/persistence/customer-code.generator';
import {
  CustomerAddressEntity,
  CustomerEntity,
  CustomerGroupEntity,
  CustomerPurchaseProjectionEntity,
  CustomerTagEntity,
  LoyaltyAccountEntity,
  LoyaltyHoldEntity,
  LoyaltySettingEntity,
  LoyaltyTransactionEntity,
  MembershipTierEntity,
} from '../../infrastructure/persistence/customer.entities';
import { ensureSeededGroups } from '../../infrastructure/persistence/seeded-groups';
import {
  CreateCustomerDto,
  CustomersKpiQueryDto,
  DeactivateCustomerQueryDto,
  ExportCustomersQueryDto,
  ListCustomerOrdersQueryDto,
  ListCustomersQueryDto,
  LookupCustomerQueryDto,
  UpdateCustomerDto,
} from './profiles.dto';

type CustomerFilter = ExportCustomersQueryDto & {
  q?: string;
};

interface PurchaseStats {
  orderCount: number;
  totalSpent: number;
  lastPurchaseAt: Date | null;
}

const NO_STATS: PurchaseStats = {
  orderCount: 0,
  totalSpent: 0,
  lastPurchaseAt: null,
};

function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function isPgUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505'
  );
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
  ) {}

  private get schemaPrefix(): string {
    return getSchemaPrefix(this.dataSource);
  }

  private async runInTenantTx<T>(
    tenantId: string,
    fn: (em: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return fn(em);
    });
  }

  private formatCustomerRecord(
    customer: CustomerEntity,
    options?: {
      /** Full phone only for callers holding customers.update (set by the controller). */
      fullPhone?: boolean;
      group?: CustomerGroupEntity | null;
      tier?: MembershipTierEntity | null;
      loyaltyAccount?: LoyaltyAccountEntity | null;
      defaultAddress?: CustomerAddressEntity | null;
    },
  ) {
    const maskPhone = options?.fullPhone !== true;
    const loyalty = options?.loyaltyAccount;
    return {
      id: customer.id,
      tenantId: customer.tenantId,
      code: customer.code,
      name: customer.name,
      phone: maskPhone ? maskPhoneNumber(customer.phone) : customer.phone,
      phoneNormalized: maskPhone
        ? maskPhoneNumber(customer.phoneNormalized)
        : customer.phoneNormalized,
      phoneMasked: formatPhoneMasked(
        customer.phone ?? customer.phoneNormalized,
      ),
      email: customer.email,
      gender: customer.gender,
      dateOfBirth: customer.dateOfBirth,
      memberCode: customer.memberCode ?? null,
      source: customer.source,
      status: customer.status,
      customerGroupId: customer.customerGroupId,
      membershipTierId: customer.membershipTierId,
      debtLimit: customer.debtLimit,
      currentDebt: customer.currentDebt,
      note: customer.note,
      mergedIntoCustomerId: customer.mergedIntoCustomerId,
      version: customer.version,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      ...(options?.group !== undefined
        ? {
            group: options.group
              ? {
                  id: options.group.id,
                  code: options.group.code,
                  name: options.group.name,
                  defaultDiscountRate: options.group.defaultDiscountRate,
                }
              : null,
          }
        : {}),
      ...(options?.tier !== undefined
        ? {
            membershipTier: options.tier
              ? {
                  id: options.tier.id,
                  code: options.tier.code,
                  name: options.tier.name,
                  minPoints: options.tier.minPoints,
                  discountRate: options.tier.discountRate,
                }
              : null,
          }
        : {}),
      ...(loyalty
        ? {
            loyalty: {
              enabled: customer.loyaltyEnabled !== false,
              loyaltyAccountId: loyalty.id,
              postedPointsBalance: loyalty.postedPointsBalance,
              heldPoints: loyalty.heldPoints,
              availablePoints: computeAvailablePoints(
                loyalty.postedPointsBalance,
                loyalty.heldPoints,
              ),
              qualifyingPoints: loyalty.qualifyingPoints,
              lifetimeEarnedPoints: loyalty.lifetimeEarnedPoints,
              lifetimeRedeemedPoints: loyalty.lifetimeRedeemedPoints,
              pointsDebt: Math.max(0, -loyalty.postedPointsBalance),
            },
          }
        : {}),
      ...(options?.defaultAddress !== undefined
        ? {
            defaultAddress: maskAddressPhones(
              options.defaultAddress,
              !maskPhone,
            ),
          }
        : {}),
    };
  }

  async createCustomer(
    tenantId: string,
    _actorId: string,
    dto: CreateCustomerDto,
    fullPhone = false,
  ) {
    const trimmedName = dto.name?.trim();
    if (!trimmedName) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        'Customer name is required',
        422,
      );
    }
    if (dto.addresses?.length && dto.initialAddress) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        'Send either addresses or initialAddress, not both',
        422,
      );
    }
    const loyaltyEnabled = dto.loyalty?.enabled !== false;
    const initialPoints = dto.loyalty?.initialPoints ?? 0;
    if (initialPoints > 0 && !loyaltyEnabled) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        'loyalty.initialPoints needs loyalty.enabled',
        422,
      );
    }

    const phoneNormalized = normalizePhoneNumber(dto.phone);
    const emailNormalized = normalizeEmail(dto.email);
    const debtLimitVnd =
      dto.debtLimit !== undefined && dto.debtLimit !== null
        ? toVndNumber(parseVndBigInt(dto.debtLimit, true))
        : 2000000;
    const groupId = dto.customerGroupId ?? dto.groupId ?? null;

    try {
      return await this.runInTenantTx(tenantId, async (em) => {
        if (phoneNormalized) {
          const existingByPhone = await em
            .getRepository(CustomerEntity)
            .findOne({
              where: {
                tenantId,
                phoneNormalized,
              },
            });
          if (existingByPhone && existingByPhone.deletedAt === null) {
            throw new CustomerDomainError(
              CustomerDomainErrorCode.CUSTOMER_ALREADY_EXISTS,
              `Customer with normalized phone '${phoneNormalized}' already exists in this tenant`,
              409,
              {
                existingCustomerId: existingByPhone.id,
                phoneNormalized,
              },
            );
          }
        }

        let group: CustomerGroupEntity | null = null;
        if (groupId) {
          group = await em.getRepository(CustomerGroupEntity).findOne({
            where: { id: groupId, tenantId },
          });
          if (!group || group.status !== 'ACTIVE') {
            throw new CustomerDomainError(
              CustomerDomainErrorCode.CUSTOMER_GROUP_NOT_FOUND,
              `Active customer group '${groupId}' not found`,
              404,
            );
          }
        }

        let tier: MembershipTierEntity | null = null;
        if (dto.membershipTierId) {
          tier = await em.getRepository(MembershipTierEntity).findOne({
            where: { id: dto.membershipTierId, tenantId },
          });
          if (!tier || tier.status !== 'ACTIVE') {
            throw new CustomerDomainError(
              CustomerDomainErrorCode.MEMBERSHIP_TIER_NOT_FOUND,
              `Active membership tier '${dto.membershipTierId}' not found`,
              404,
            );
          }
        } else {
          const tiers = await em.getRepository(MembershipTierEntity).find({
            where: { tenantId, status: 'ACTIVE' },
          });
          tier = resolveEligibleMembershipTier(initialPoints, tiers);
        }

        const code = dto.code?.trim()
          ? dto.code.trim().toUpperCase()
          : await nextCustomerDocumentCode(em, tenantId, 'KH');

        const existingByCode = await em.getRepository(CustomerEntity).findOne({
          where: { tenantId, code },
        });
        if (existingByCode) {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.CUSTOMER_ALREADY_EXISTS,
            `Customer code '${code}' already exists in this tenant`,
            409,
          );
        }

        const customer = em.getRepository(CustomerEntity).create({
          tenantId,
          code,
          memberCode: loyaltyEnabled
            ? await nextCustomerDocumentCode(em, tenantId, 'MB')
            : null,
          loyaltyEnabled,
          name: trimmedName,
          phone: dto.phone?.trim() || phoneNormalized,
          phoneNormalized,
          email: emailNormalized,
          gender: dto.gender ?? null,
          dateOfBirth: dto.dateOfBirth ?? dto.dob ?? null,
          source: dto.source?.trim().toUpperCase() || 'POS',
          status: 'ACTIVE',
          customerGroupId: group?.id ?? null,
          membershipTierId: tier?.id ?? null,
          debtLimit: debtLimitVnd,
          currentDebt: 0,
          note: dto.note?.trim() ?? null,
          mergedIntoCustomerId: null,
          version: 1,
          deletedAt: null,
        });
        const savedCustomer = await em
          .getRepository(CustomerEntity)
          .save(customer);

        const loyaltyAccount = em.getRepository(LoyaltyAccountEntity).create({
          tenantId,
          customerId: savedCustomer.id,
          postedPointsBalance: initialPoints,
          heldPoints: 0,
          lifetimeEarnedPoints: initialPoints,
          lifetimeRedeemedPoints: 0,
          qualifyingPoints: initialPoints,
          tierId: tier?.id ?? null,
          status: 'ACTIVE',
          version: 1,
        });
        const savedLoyalty = await em
          .getRepository(LoyaltyAccountEntity)
          .save(loyaltyAccount);

        if (initialPoints > 0) {
          const tx = await em.getRepository(LoyaltyTransactionEntity).save(
            em.getRepository(LoyaltyTransactionEntity).create({
              id: randomUUID(),
              tenantId,
              customerId: savedCustomer.id,
              loyaltyAccountId: savedLoyalty.id,
              transactionType: 'MANUAL_ADJUSTMENT',
              pointsDelta: initialPoints,
              balanceBefore: 0,
              balanceAfter: initialPoints,
              sourceType: 'INITIAL',
              sourceRefId: `initial:${savedCustomer.id}`,
              idempotencyKey: `initial_points:${savedCustomer.id}`,
              actorId: _actorId,
              reason: 'Initial points at customer creation',
            }),
          );
          await this.outbox.add(
            em,
            CUSTOMER_LOYALTY_POINTS_EARNED,
            {
              transactionId: tx.id,
              customerId: savedCustomer.id,
              loyaltyAccountId: savedLoyalty.id,
              transactionType: 'MANUAL_ADJUSTMENT',
              pointsDelta: initialPoints,
              postedBalanceAfter: initialPoints,
              occurredAt: tx.createdAt.toISOString(),
            } satisfies LoyaltyPointsEventPayload,
            { tenantId },
          );
        }

        const addressInputs: Array<{
          recipientName?: string;
          phone?: string;
          addressLine: string;
          ward?: string;
          district?: string;
          province?: string;
          isDefault?: boolean;
        }> = dto.addresses?.length
          ? dto.addresses.map((a) => ({ ...a, phone: a.recipientPhone }))
          : dto.initialAddress
            ? [{ ...dto.initialAddress, isDefault: true }]
            : [];
        const defaultIdx = Math.max(
          0,
          addressInputs.findIndex((a) => a.isDefault === true),
        );
        for (let i = 0; i < addressInputs.length; i += 1) {
          const input = addressInputs[i];
          const addrPhoneRaw = input.phone ?? dto.phone;
          const addrPhoneNorm = normalizePhoneNumber(addrPhoneRaw);
          await em.getRepository(CustomerAddressEntity).save(
            em.getRepository(CustomerAddressEntity).create({
              tenantId,
              customerId: savedCustomer.id,
              recipientName: input.recipientName?.trim() || savedCustomer.name,
              phone: addrPhoneRaw?.trim() || addrPhoneNorm,
              phoneNormalized: addrPhoneNorm,
              addressLine: input.addressLine.trim(),
              ward: input.ward?.trim() ?? null,
              district: input.district?.trim() ?? null,
              province: input.province?.trim() ?? null,
              isDefault: i === defaultIdx,
              status: 'ACTIVE',
            }),
          );
        }

        if (dto.tagIds?.length) {
          await this.replaceTags(em, tenantId, savedCustomer.id, dto.tagIds);
        }

        const eventPayload: CustomerLifecycleEventPayload = {
          customerId: savedCustomer.id,
          code: savedCustomer.code,
          status: savedCustomer.status,
          customerGroupId: savedCustomer.customerGroupId,
          membershipTierId: savedCustomer.membershipTierId,
          version: savedCustomer.version,
          occurredAt: new Date().toISOString(),
        };
        await this.outbox.add(em, CUSTOMER_CREATED, eventPayload, { tenantId });

        return this.loadDetail(em, tenantId, savedCustomer, fullPhone);
      });
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_ALREADY_EXISTS,
          'Customer with this phone number or code already exists in this tenant',
          409,
        );
      }
      throw err;
    }
  }

  /** Replaces the tag set of a customer; every id must be a tag of the tenant. */
  private async replaceTags(
    em: EntityManager,
    tenantId: string,
    customerId: string,
    tagIds: string[],
  ): Promise<void> {
    const unique = [...new Set(tagIds)];
    if (unique.length > 0) {
      const found = await em.getRepository(CustomerTagEntity).find({
        where: { tenantId, id: In(unique) },
      });
      if (found.length !== unique.length) {
        const known = new Set(found.map((t) => t.id));
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_TAG_NOT_FOUND,
          'One or more customer tags were not found',
          404,
          { missingTagIds: unique.filter((id) => !known.has(id)) },
        );
      }
    }
    await em.query(
      `DELETE FROM ${this.schemaPrefix}"customer_tag_links"
       WHERE "tenant_id" = $1 AND "customer_id" = $2`,
      [tenantId, customerId],
    );
    if (unique.length > 0) {
      await em.query(
        `INSERT INTO ${this.schemaPrefix}"customer_tag_links" ("tenant_id", "customer_id", "tag_id")
         SELECT $1, $2, UNNEST($3::uuid[])`,
        [tenantId, customerId, unique],
      );
    }
  }

  private statsSql(restrictToIds: boolean): string {
    return `SELECT "customer_id",
              COUNT(*) FILTER (WHERE "order_status" <> 'PENDING_ORDER_EVENT')::int AS "order_count",
              COALESCE(SUM(GREATEST(0, "eligible_net_spend" - "returned_amount")), 0)::bigint AS "total_spent",
              MAX("completed_at") FILTER (WHERE "order_status" <> 'PENDING_ORDER_EVENT') AS "last_purchase_at"
            FROM ${this.schemaPrefix}"customer_purchase_projections"
            WHERE "tenant_id" = $1${restrictToIds ? ' AND "customer_id" = ANY($2::uuid[])' : ''}
            GROUP BY "customer_id"`;
  }

  /** orderCount / totalSpent / lastPurchaseAt read model, per customer id. */
  private async loadPurchaseStats(
    em: EntityManager,
    tenantId: string,
    customerIds: string[],
  ): Promise<Map<string, PurchaseStats>> {
    const out = new Map<string, PurchaseStats>();
    if (customerIds.length === 0) return out;
    const rows: Array<{
      customer_id: string;
      order_count: number;
      total_spent: string;
      last_purchase_at: Date | null;
    }> = await em.query(this.statsSql(true), [tenantId, customerIds]);
    for (const r of rows) {
      out.set(r.customer_id, {
        orderCount: Number(r.order_count),
        totalSpent: toMoney(r.total_spent),
        lastPurchaseAt: r.last_purchase_at,
      });
    }
    return out;
  }

  /** Detail shape of the screen contract on top of the existing record. */
  private async loadDetail(
    em: EntityManager,
    tenantId: string,
    customer: CustomerEntity,
    fullPhone: boolean,
  ) {
    const [
      group,
      tier,
      loyaltyAccount,
      defaultAddress,
      addresses,
      tagRows,
      stats,
    ] = await Promise.all([
      customer.customerGroupId
        ? em.getRepository(CustomerGroupEntity).findOne({
            where: { id: customer.customerGroupId, tenantId },
          })
        : Promise.resolve(null),
      customer.membershipTierId
        ? em.getRepository(MembershipTierEntity).findOne({
            where: { id: customer.membershipTierId, tenantId },
          })
        : Promise.resolve(null),
      em.getRepository(LoyaltyAccountEntity).findOne({
        where: { customerId: customer.id, tenantId },
      }),
      em.getRepository(CustomerAddressEntity).findOne({
        where: {
          customerId: customer.id,
          tenantId,
          isDefault: true,
          status: 'ACTIVE',
        },
      }),
      em.getRepository(CustomerAddressEntity).find({
        where: { customerId: customer.id, tenantId, status: 'ACTIVE' },
        order: { isDefault: 'DESC', createdAt: 'ASC' },
      }),
      em.query(
        `SELECT t."id", t."name"
           FROM ${this.schemaPrefix}"customer_tag_links" l
           JOIN ${this.schemaPrefix}"customer_tags" t
             ON t."tenant_id" = l."tenant_id" AND t."id" = l."tag_id"
           WHERE l."tenant_id" = $1 AND l."customer_id" = $2
           ORDER BY t."name" ASC`,
        [tenantId, customer.id],
      ) as Promise<Array<{ id: string; name: string }>>,
      this.loadPurchaseStats(em, tenantId, [customer.id]),
    ]);
    const s = stats.get(customer.id) ?? NO_STATS;
    return {
      ...this.formatCustomerRecord(customer, {
        fullPhone,
        group,
        tier,
        loyaltyAccount,
        defaultAddress,
      }),
      dob: customer.dateOfBirth,
      joinedAt: customer.createdAt,
      tier: tier ? { id: tier.id, code: tier.code, name: tier.name } : null,
      addresses: addresses.map((a) => ({
        id: a.id,
        recipientName: a.recipientName,
        recipientPhone: fullPhone ? a.phone : maskPhoneNumber(a.phone),
        province: a.province,
        district: a.district,
        ward: a.ward,
        addressLine: a.addressLine,
        isDefault: a.isDefault,
      })),
      tags: tagRows.map((t) => ({ id: t.id, name: t.name })),
      orderCount: s.orderCount,
      totalSpent: s.totalSpent,
      lastPurchaseAt: s.lastPurchaseAt,
      loyaltyPoints: loyaltyAccount?.postedPointsBalance ?? 0,
    };
  }

  /**
   * One page of customer ids that match the list filters, with the total.
   * Spend filters and spend sorts join the purchase read model.
   */
  private async findCustomerPage(
    em: EntityManager,
    tenantId: string,
    f: CustomerFilter & { cursor?: string },
    page: { limit: number; offset: number },
  ): Promise<{ ids: string[]; total: number }> {
    const prefix = this.schemaPrefix;
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where: string[] = ['c."tenant_id" = $1'];

    if (f.status) where.push(`c."status" = ${p(f.status)}`);
    else where.push('c."deleted_at" IS NULL');
    if (f.customerGroupId) {
      where.push(`c."customer_group_id" = ${p(f.customerGroupId)}`);
    }
    if (f.membershipTierId) {
      where.push(`c."membership_tier_id" = ${p(f.membershipTierId)}`);
    }
    if (f.source)
      where.push(`c."source" = ${p(f.source.trim().toUpperCase())}`);
    const codes = (f.group ?? '')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x && x !== 'all');
    if (codes.length > 0) {
      where.push(`LOWER(g."code") = ANY(${p(codes)}::text[])`);
    }
    if (f.tagId) {
      where.push(
        `EXISTS (SELECT 1 FROM ${prefix}"customer_tag_links" tl
                 WHERE tl."tenant_id" = c."tenant_id" AND tl."customer_id" = c."id"
                   AND tl."tag_id" = ${p(f.tagId)})`,
      );
    }
    if (f.spendMin !== undefined) {
      where.push(`COALESCE(s."total_spent", 0) >= ${p(f.spendMin)}`);
    }
    if (f.spendMax !== undefined) {
      where.push(`COALESCE(s."total_spent", 0) <= ${p(f.spendMax)}`);
    }
    if (f.q && f.q.trim()) {
      const rawQ = f.q.trim();
      let phoneQ: string | null = null;
      try {
        phoneQ = normalizePhoneNumber(rawQ);
      } catch {
        phoneQ = null;
      }
      const like = p(`%${escapeLike(rawQ)}%`);
      if (phoneQ) {
        where.push(
          `(c."phone_normalized" = ${p(phoneQ)} OR c."name" ILIKE ${like} OR c."code" ILIKE ${like} OR c."email" ILIKE ${like})`,
        );
      } else {
        where.push(
          `(c."name" ILIKE ${like} OR c."code" ILIKE ${like} OR c."phone" ILIKE ${like} OR c."email" ILIKE ${like})`,
        );
      }
    }

    const sort = f.sort ?? 'createdAt';
    const dir = f.order === 'asc' ? 'ASC' : 'DESC';
    const defaultOrder = sort === 'createdAt' && dir === 'DESC';
    if (f.cursor && defaultOrder) {
      const cursorRow = await em.getRepository(CustomerEntity).findOne({
        where: { id: f.cursor, tenantId },
      });
      if (cursorRow) {
        const at = p(cursorRow.createdAt);
        where.push(
          `(c."created_at" < ${at} OR (c."created_at" = ${at} AND c."id" < ${p(cursorRow.id)}))`,
        );
      }
    }

    const needStats =
      f.spendMin !== undefined ||
      f.spendMax !== undefined ||
      sort === 'totalSpent' ||
      sort === 'lastPurchaseAt';
    const from = `FROM ${prefix}"customers" c
      LEFT JOIN ${prefix}"customer_groups" g
        ON g."tenant_id" = c."tenant_id" AND g."id" = c."customer_group_id"
      ${needStats ? `LEFT JOIN (${this.statsSql(false)}) s ON s."customer_id" = c."id"` : ''}
      WHERE ${where.join(' AND ')}`;

    const orderBy =
      sort === 'totalSpent'
        ? `COALESCE(s."total_spent", 0) ${dir}, c."created_at" DESC, c."id" DESC`
        : sort === 'lastPurchaseAt'
          ? `s."last_purchase_at" ${dir} NULLS LAST, c."created_at" DESC, c."id" DESC`
          : `c."created_at" ${dir}, c."id" ${dir}`;

    const totalRows: Array<{ n: number }> = await em.query(
      `SELECT COUNT(*)::int AS n ${from}`,
      params,
    );
    const rows: Array<{ id: string }> = await em.query(
      `SELECT c."id" AS id ${from} ORDER BY ${orderBy}
       LIMIT ${p(page.limit)} OFFSET ${p(f.cursor && defaultOrder ? 0 : page.offset)}`,
      params,
    );
    return { ids: rows.map((r) => r.id), total: totalRows[0]?.n ?? 0 };
  }

  async listCustomers(
    tenantId: string,
    query: ListCustomersQueryDto,
    fullPhone = false,
  ) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = (page - 1) * limit;

    return this.runInTenantTx(tenantId, async (em) => {
      const { ids, total } = await this.findCustomerPage(em, tenantId, query, {
        limit,
        offset,
      });
      const entities = ids.length
        ? await em.getRepository(CustomerEntity).find({
            where: { tenantId, id: In(ids) },
          })
        : [];
      const byId = new Map(entities.map((c) => [c.id, c]));
      const items = ids.map((id) => byId.get(id)!).filter(Boolean);

      const loyaltyByCustomer = new Map<string, LoyaltyAccountEntity>();
      if (ids.length > 0) {
        const accounts = await em.getRepository(LoyaltyAccountEntity).find({
          where: { tenantId, customerId: In(ids) },
        });
        for (const acc of accounts) {
          loyaltyByCustomer.set(acc.customerId, acc);
        }
      }
      const groupIds = [
        ...new Set(items.map((c) => c.customerGroupId).filter(Boolean)),
      ] as string[];
      const groups = groupIds.length
        ? await em.getRepository(CustomerGroupEntity).find({
            where: { tenantId, id: In(groupIds) },
          })
        : [];
      const groupById = new Map(groups.map((g) => [g.id, g]));
      const stats = await this.loadPurchaseStats(em, tenantId, ids);

      const defaultOrder =
        (query.sort ?? 'createdAt') === 'createdAt' && query.order !== 'asc';
      const nextCursor =
        defaultOrder && items.length === limit
          ? (items[items.length - 1]?.id ?? null)
          : null;
      const totalPages = Math.ceil(total / limit);

      return {
        items: items.map((c) =>
          this.formatCustomerRecord(c, {
            fullPhone,
            loyaltyAccount: loyaltyByCustomer.get(c.id) ?? null,
          }),
        ),
        total,
        page,
        limit,
        nextCursor,
        // Screen contract shape (phone only for customers.update holders).
        data: items.map((c) => {
          const g = c.customerGroupId
            ? groupById.get(c.customerGroupId)
            : undefined;
          const st = stats.get(c.id) ?? NO_STATS;
          return {
            id: c.id,
            code: c.code,
            name: c.name,
            phone: fullPhone ? c.phone : null,
            phoneMasked: formatPhoneMasked(c.phone ?? c.phoneNormalized),
            email: c.email,
            group: g ? { id: g.id, code: g.code, name: g.name } : null,
            orderCount: st.orderCount,
            totalSpent: st.totalSpent,
            loyaltyPoints:
              loyaltyByCustomer.get(c.id)?.postedPointsBalance ?? 0,
            lastPurchaseAt: st.lastPurchaseAt,
          };
        }),
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

  /** `GET /customers/export`: the filtered list as CSV (max 5000 rows). */
  async exportCustomersCsv(
    tenantId: string,
    query: ExportCustomersQueryDto,
    fullPhone = false,
  ): Promise<string> {
    return this.runInTenantTx(tenantId, async (em) => {
      const { ids } = await this.findCustomerPage(em, tenantId, query, {
        limit: 5000,
        offset: 0,
      });
      const entities = ids.length
        ? await em.getRepository(CustomerEntity).find({
            where: { tenantId, id: In(ids) },
          })
        : [];
      const byId = new Map(entities.map((c) => [c.id, c]));
      const groups = await em.getRepository(CustomerGroupEntity).find({
        where: { tenantId },
      });
      const groupName = new Map(groups.map((g) => [g.id, g.name]));
      const accounts = ids.length
        ? await em.getRepository(LoyaltyAccountEntity).find({
            where: { tenantId, customerId: In(ids) },
          })
        : [];
      const points = new Map(
        accounts.map((a) => [a.customerId, a.postedPointsBalance]),
      );
      const stats = await this.loadPurchaseStats(em, tenantId, ids);
      const header =
        'code,name,phone,email,group,orderCount,totalSpent,loyaltyPoints,lastPurchaseAt,source,status,note';
      const lines = ids
        .map((id) => byId.get(id))
        .filter((c): c is CustomerEntity => !!c)
        .map((c) => {
          const st = stats.get(c.id) ?? NO_STATS;
          const rawPhone = c.phone ?? c.phoneNormalized;
          return [
            c.code,
            c.name,
            fullPhone ? (rawPhone ?? '') : (maskPhoneNumber(rawPhone) ?? ''),
            c.email ?? '',
            c.customerGroupId ? (groupName.get(c.customerGroupId) ?? '') : '',
            st.orderCount,
            st.totalSpent,
            points.get(c.id) ?? 0,
            st.lastPurchaseAt ? st.lastPurchaseAt.toISOString() : '',
            c.source,
            c.status,
            c.note ?? '',
          ]
            .map(sanitizeCsvCell)
            .join(',');
        });
      return [header, ...lines].join('\n');
    });
  }

  /**
   * KPI cards and group tab counts of the customer screen. Groups are seeded
   * on first call; `returningRate` = customers with 2+ orders in the month
   * over customers with any order in the month.
   */
  async getKpiSummary(tenantId: string, query: CustomersKpiQueryDto) {
    const now = new Date();
    const [y, m] = query.month
      ? query.month.split('-').map(Number)
      : [now.getUTCFullYear(), now.getUTCMonth() + 1];
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    const prevStart = new Date(Date.UTC(y, m - 2, 1));
    const prefix = this.schemaPrefix;

    return this.runInTenantTx(tenantId, async (em) => {
      await ensureSeededGroups(em, tenantId);
      const [totals]: Array<{ total: number; fresh: number }> = await em.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE "created_at" >= $2 AND "created_at" < $3)::int AS fresh
         FROM ${prefix}"customers"
         WHERE "tenant_id" = $1 AND "deleted_at" IS NULL`,
        [tenantId, start, end],
      );
      const groupRows: Array<{ code: string; n: number }> = await em.query(
        `SELECT LOWER(g."code") AS code, COUNT(c."id")::int AS n
         FROM ${prefix}"customer_groups" g
         LEFT JOIN ${prefix}"customers" c
           ON c."tenant_id" = g."tenant_id" AND c."customer_group_id" = g."id"
          AND c."deleted_at" IS NULL
         WHERE g."tenant_id" = $1
         GROUP BY LOWER(g."code")`,
        [tenantId],
      );
      const groupCounts: Record<string, number> = {
        all: totals?.total ?? 0,
        retail: 0,
        member: 0,
        vip: 0,
        wholesale: 0,
      };
      for (const r of groupRows) groupCounts[r.code] = r.n;

      const rate = async (from: Date, to: Date): Promise<number> => {
        const [r]: Array<{ buyers: number; repeat: number }> = await em.query(
          `SELECT COUNT(*)::int AS buyers, COUNT(*) FILTER (WHERE n >= 2)::int AS repeat
           FROM (SELECT "customer_id", COUNT(*) AS n
                 FROM ${prefix}"customer_purchase_projections"
                 WHERE "tenant_id" = $1 AND "completed_at" >= $2 AND "completed_at" < $3
                   AND "order_status" <> 'PENDING_ORDER_EVENT'
                 GROUP BY "customer_id") x`,
          [tenantId, from, to],
        );
        return r && r.buyers > 0
          ? Math.round((r.repeat / r.buyers) * 1000) / 1000
          : 0;
      };
      const returningRate = await rate(start, end);
      const previous = await rate(prevStart, start);

      return {
        total: totals?.total ?? 0,
        newThisMonth: totals?.fresh ?? 0,
        members: groupCounts.member,
        vip: groupCounts.vip,
        returningRate,
        returningRateDelta:
          Math.round((returningRate - previous) * 1000) / 1000,
        groupCounts,
      };
    });
  }

  async lookupCustomer(
    tenantId: string,
    query: LookupCustomerQueryDto,
    fullPhone = false,
  ) {
    if (!query.phone && !query.code && !query.email) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        'At least one lookup parameter (phone, code, or email) is required',
        422,
      );
    }

    return this.runInTenantTx(tenantId, async (em) => {
      let customer: CustomerEntity | null = null;

      if (query.phone) {
        const phoneNormalized = normalizePhoneNumber(query.phone);
        if (phoneNormalized) {
          customer = await em
            .getRepository(CustomerEntity)
            .createQueryBuilder('c')
            .where('c.tenant_id = :tenantId', { tenantId })
            .andWhere('c.phone_normalized = :phoneNormalized', {
              phoneNormalized,
            })
            .andWhere('c.deleted_at IS NULL')
            .getOne();
        }
      } else if (query.code) {
        customer = await em.getRepository(CustomerEntity).findOne({
          where: {
            tenantId,
            code: query.code.trim().toUpperCase(),
          },
        });
      } else if (query.email) {
        const emailNormalized = normalizeEmail(query.email);
        if (emailNormalized) {
          customer = await em
            .getRepository(CustomerEntity)
            .createQueryBuilder('c')
            .where('c.tenant_id = :tenantId', { tenantId })
            .andWhere('c.email = :emailNormalized', { emailNormalized })
            .andWhere('c.deleted_at IS NULL')
            .getOne();
        }
      }

      if (!customer) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          'Customer not found for lookup query',
          404,
        );
      }

      return this.loadDetail(em, tenantId, customer, fullPhone);
    });
  }

  async getCustomerById(
    tenantId: string,
    customerId: string,
    options?: { fullPhone?: boolean },
  ) {
    return this.runInTenantTx(tenantId, async (em) => {
      const customer = await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
      });
      if (!customer) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Customer '${customerId}' not found`,
          404,
        );
      }
      return this.loadDetail(
        em,
        tenantId,
        customer,
        options?.fullPhone === true,
      );
    });
  }

  async updateCustomer(
    tenantId: string,
    customerId: string,
    actorId: string,
    dto: UpdateCustomerDto,
    fullPhone = false,
  ) {
    try {
      return await this.runInTenantTx(tenantId, async (em) => {
        const customer = await em
          .getRepository(CustomerEntity)
          .createQueryBuilder('c')
          .setLock('pessimistic_write')
          .where('c.id = :customerId AND c.tenant_id = :tenantId', {
            customerId,
            tenantId,
          })
          .getOne();

        if (!customer) {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
            `Customer '${customerId}' not found`,
            404,
          );
        }

        if (customer.status === 'ANONYMIZED') {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.CUSTOMER_INACTIVE,
            'Anonymized customer profile cannot be modified',
            409,
          );
        }

        if (dto.version !== undefined && customer.version !== dto.version) {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.RESOURCE_VERSION_CONFLICT,
            `Customer version conflict: expected ${dto.version}, current is ${customer.version}`,
            409,
            {
              expectedVersion: dto.version,
              currentVersion: customer.version,
            },
          );
        }

        if (dto.name !== undefined) {
          const trimmed = dto.name.trim();
          if (!trimmed) {
            throw new CustomerDomainError(
              CustomerDomainErrorCode.VALIDATION_ERROR,
              'Customer name cannot be empty',
              422,
            );
          }
          customer.name = trimmed;
        }

        if (dto.phone !== undefined) {
          const phoneNormalized = normalizePhoneNumber(dto.phone);
          if (phoneNormalized && phoneNormalized !== customer.phoneNormalized) {
            const duplicate = await em.getRepository(CustomerEntity).findOne({
              where: { tenantId, phoneNormalized },
            });
            if (
              duplicate &&
              duplicate.id !== customer.id &&
              duplicate.deletedAt === null
            ) {
              throw new CustomerDomainError(
                CustomerDomainErrorCode.CUSTOMER_ALREADY_EXISTS,
                `Customer with normalized phone '${phoneNormalized}' already exists in this tenant`,
                409,
                { existingCustomerId: duplicate.id, phoneNormalized },
              );
            }
          }
          customer.phone = dto.phone?.trim() || phoneNormalized;
          customer.phoneNormalized = phoneNormalized;
        }

        if (dto.email !== undefined) {
          customer.email = normalizeEmail(dto.email);
        }

        if (dto.gender !== undefined) {
          customer.gender = dto.gender;
        }

        const dob = dto.dateOfBirth !== undefined ? dto.dateOfBirth : dto.dob;
        if (dob !== undefined) {
          customer.dateOfBirth = dob;
        }

        if (dto.loyalty?.enabled !== undefined) {
          customer.loyaltyEnabled = dto.loyalty.enabled;
          if (dto.loyalty.enabled && !customer.memberCode) {
            customer.memberCode = await nextCustomerDocumentCode(
              em,
              tenantId,
              'MB',
            );
          }
        }

        if (dto.debtLimit !== undefined) {
          customer.debtLimit = toVndNumber(parseVndBigInt(dto.debtLimit, true));
        }

        if (dto.note !== undefined) {
          customer.note = dto.note?.trim() ?? null;
        }

        if (dto.status !== undefined) {
          customer.status = dto.status;
        }

        const previousGroupId = customer.customerGroupId;
        const groupIdInput =
          dto.customerGroupId !== undefined ? dto.customerGroupId : dto.groupId;
        let group: CustomerGroupEntity | null = null;
        if (groupIdInput !== undefined) {
          if (groupIdInput === null) {
            customer.customerGroupId = null;
          } else {
            group = await em.getRepository(CustomerGroupEntity).findOne({
              where: { id: groupIdInput, tenantId },
            });
            if (!group || group.status !== 'ACTIVE') {
              throw new CustomerDomainError(
                CustomerDomainErrorCode.CUSTOMER_GROUP_NOT_FOUND,
                `Active customer group '${groupIdInput}' not found`,
                404,
              );
            }
            customer.customerGroupId = group.id;
          }
        } else if (customer.customerGroupId) {
          group = await em.getRepository(CustomerGroupEntity).findOne({
            where: { id: customer.customerGroupId, tenantId },
          });
        }

        const previousTierId = customer.membershipTierId;
        let tier: MembershipTierEntity | null = null;
        if (dto.membershipTierId !== undefined) {
          if (dto.membershipTierId === null) {
            customer.membershipTierId = null;
          } else {
            tier = await em.getRepository(MembershipTierEntity).findOne({
              where: { id: dto.membershipTierId, tenantId },
            });
            if (!tier || tier.status !== 'ACTIVE') {
              throw new CustomerDomainError(
                CustomerDomainErrorCode.MEMBERSHIP_TIER_NOT_FOUND,
                `Active membership tier '${dto.membershipTierId}' not found`,
                404,
              );
            }
            customer.membershipTierId = tier.id;
          }
        } else if (customer.membershipTierId) {
          tier = await em.getRepository(MembershipTierEntity).findOne({
            where: { id: customer.membershipTierId, tenantId },
          });
        }

        if (dto.tagIds !== undefined) {
          await this.replaceTags(em, tenantId, customer.id, dto.tagIds);
        }

        customer.version += 1;
        const saved = await em.getRepository(CustomerEntity).save(customer);

        const loyaltyAccount = await em
          .getRepository(LoyaltyAccountEntity)
          .findOne({
            where: { customerId: saved.id, tenantId },
          });
        if (
          loyaltyAccount &&
          dto.membershipTierId !== undefined &&
          loyaltyAccount.tierId !== saved.membershipTierId
        ) {
          loyaltyAccount.tierId = saved.membershipTierId;
          loyaltyAccount.version += 1;
          await em.getRepository(LoyaltyAccountEntity).save(loyaltyAccount);
        }

        if (previousGroupId !== saved.customerGroupId) {
          const groupPayload: CustomerGroupChangedPayload = {
            customerId: saved.id,
            previousGroupId,
            newGroupId: saved.customerGroupId,
            actorId,
            occurredAt: new Date().toISOString(),
          };
          await this.outbox.add(em, CUSTOMER_GROUP_CHANGED, groupPayload, {
            tenantId,
          });
        }

        if (
          previousTierId !== saved.membershipTierId &&
          saved.membershipTierId
        ) {
          const tierPayload: CustomerMembershipChangedPayload = {
            customerId: saved.id,
            previousTierId,
            newTierId: saved.membershipTierId,
            qualifyingPoints: loyaltyAccount?.qualifyingPoints ?? 0,
            occurredAt: new Date().toISOString(),
          };
          await this.outbox.add(em, CUSTOMER_MEMBERSHIP_CHANGED, tierPayload, {
            tenantId,
          });
        }

        const updatedPayload: CustomerLifecycleEventPayload = {
          customerId: saved.id,
          code: saved.code,
          status: saved.status,
          customerGroupId: saved.customerGroupId,
          membershipTierId: saved.membershipTierId,
          version: saved.version,
          occurredAt: new Date().toISOString(),
        };
        await this.outbox.add(em, CUSTOMER_UPDATED, updatedPayload, {
          tenantId,
        });

        return this.loadDetail(em, tenantId, saved, fullPhone);
      });
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_ALREADY_EXISTS,
          'Customer with this phone number already exists in this tenant',
          409,
        );
      }
      throw err;
    }
  }

  async deactivateCustomer(
    tenantId: string,
    customerId: string,
    _actorId: string,
    query: DeactivateCustomerQueryDto,
  ) {
    return this.runInTenantTx(tenantId, async (em) => {
      const customer = await em
        .getRepository(CustomerEntity)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :customerId AND c.tenant_id = :tenantId', {
          customerId,
          tenantId,
        })
        .getOne();

      if (!customer) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Customer '${customerId}' not found`,
          404,
        );
      }

      // Check for active HELD loyalty holds
      const activeHoldsCount = await em.getRepository(LoyaltyHoldEntity).count({
        where: {
          tenantId,
          customerId: customer.id,
          state: 'HELD',
        },
      });
      if (activeHoldsCount > 0) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.LOYALTY_STATE_CONFLICT,
          `Cannot deactivate or anonymize customer '${customerId}' while ${activeHoldsCount} loyalty point hold(s) are active`,
          409,
          { activeHoldsCount },
        );
      }

      if (customer.currentDebt > 0) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_HAS_OUTSTANDING_DEBT,
          `Cannot deactivate or anonymize customer '${customerId}' with outstanding debt`,
          409,
          { currentDebt: customer.currentDebt },
        );
      }

      const anonymize = query.anonymize === true;
      if (anonymize) {
        customer.name = `ANONYMIZED-${customer.code}`;
        customer.phone = null;
        customer.phoneNormalized = null;
        customer.email = null;
        customer.gender = null;
        customer.dateOfBirth = null;
        customer.note = null;
        customer.status = 'ANONYMIZED';
        customer.deletedAt = new Date();

        await em.query(
          `UPDATE ${this.schemaPrefix}"customer_addresses"
           SET "recipient_name" = 'ANONYMIZED',
               "phone" = NULL,
               "phone_normalized" = NULL,
               "address_line" = 'ANONYMIZED',
               "ward" = NULL,
               "district" = NULL,
               "province" = NULL,
               "is_default" = false,
               "status" = 'INACTIVE',
               "updated_at" = now()
           WHERE "tenant_id" = $1 AND "customer_id" = $2`,
          [tenantId, customer.id],
        );

        await em.query(
          `UPDATE ${this.schemaPrefix}"loyalty_accounts"
           SET "status" = 'CLOSED',
               "version" = "version" + 1,
               "updated_at" = now()
           WHERE "tenant_id" = $1 AND "customer_id" = $2`,
          [tenantId, customer.id],
        );
      } else {
        customer.status = 'INACTIVE';
        customer.deletedAt = new Date();
      }

      customer.version += 1;
      const saved = await em.getRepository(CustomerEntity).save(customer);

      const deactivatedPayload: CustomerLifecycleEventPayload = {
        customerId: saved.id,
        code: saved.code,
        status: saved.status,
        customerGroupId: saved.customerGroupId,
        membershipTierId: saved.membershipTierId,
        version: saved.version,
        occurredAt: new Date().toISOString(),
      };
      await this.outbox.add(em, CUSTOMER_DEACTIVATED, deactivatedPayload, {
        tenantId,
      });

      return this.formatCustomerRecord(saved);
    });
  }

  async getPurchaseSummary(tenantId: string, customerId: string) {
    return this.runInTenantTx(tenantId, async (em) => {
      const customer = await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
      });
      if (!customer) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Customer '${customerId}' not found`,
          404,
        );
      }

      const aggRows: Array<{
        order_count: string;
        gross_spend: string;
        returned_amount: string;
        net_spend: string;
        earned_points: string;
        reversed_points: string;
        last_order_at: Date | null;
        last_updated_at: Date | null;
      }> = await em.query(
        `SELECT
           COUNT(*) FILTER (WHERE "order_status" != 'PENDING_ORDER_EVENT')::text AS "order_count",
           COALESCE(SUM("original_order_total"), 0)::bigint::text AS "gross_spend",
           COALESCE(SUM("returned_amount"), 0)::bigint::text AS "returned_amount",
           COALESCE(SUM(GREATEST(0, "eligible_net_spend" - "returned_amount")), 0)::bigint::text AS "net_spend",
           COALESCE(SUM("earned_points"), 0)::bigint::text AS "earned_points",
           COALESCE(SUM("reversed_points"), 0)::bigint::text AS "reversed_points",
           MAX("completed_at") AS "last_order_at",
           MAX("updated_at") AS "last_updated_at"
         FROM ${this.schemaPrefix}"customer_purchase_projections"
         WHERE "tenant_id" = $1 AND "customer_id" = $2`,
        [tenantId, customerId],
      );

      const agg = aggRows[0];
      return {
        customerId: customer.id,
        completedOrderCount: Number(agg?.order_count ?? 0),
        grossSpendVnd: toMoney(agg?.gross_spend ?? 0),
        returnedAmountVnd: toMoney(agg?.returned_amount ?? 0),
        netSpendVnd: toMoney(agg?.net_spend ?? 0),
        totalEarnedPoints: Number(agg?.earned_points ?? 0),
        totalReversedPoints: Number(agg?.reversed_points ?? 0),
        lastOrderAt: agg?.last_order_at ?? null,
        projectionMetadata: {
          source: 'CUSTOMER_PURCHASE_PROJECTION',
          eventDriven: true,
          lastUpdatedAt: agg?.last_updated_at ?? null,
        },
      };
    });
  }

  async listCustomerOrders(
    tenantId: string,
    customerId: string,
    query: ListCustomerOrdersQueryDto,
  ) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = (page - 1) * limit;

    return this.runInTenantTx(tenantId, async (em) => {
      const customer = await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
      });
      if (!customer) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Customer '${customerId}' not found`,
          404,
        );
      }

      const [items, total] = await em
        .getRepository(CustomerPurchaseProjectionEntity)
        .findAndCount({
          where: { tenantId, customerId },
          order: { completedAt: 'DESC', id: 'DESC' },
          skip: offset,
          take: limit,
        });

      return {
        customerId,
        items,
        total,
        page,
        limit,
        projectionMetadata: {
          source: 'CUSTOMER_PURCHASE_PROJECTION',
          eventDriven: true,
        },
      };
    });
  }

  async getCustomerSummary(
    tenantId: string,
    customerId: string,
    fullPhone = false,
  ) {
    const [profile, purchaseSummary] = await Promise.all([
      this.getCustomerById(tenantId, customerId, { fullPhone }),
      this.getPurchaseSummary(tenantId, customerId),
    ]);

    const debtLimitBig = parseVndBigInt(profile.debtLimit, true);
    const currentDebtBig = parseVndBigInt(profile.currentDebt, true);
    const availableCreditBig =
      debtLimitBig > currentDebtBig ? debtLimitBig - currentDebtBig : 0n;

    return {
      customer: profile,
      loyalty: profile.loyalty ?? {
        loyaltyAccountId: null,
        postedPointsBalance: 0,
        heldPoints: 0,
        availablePoints: 0,
        qualifyingPoints: 0,
        lifetimeEarnedPoints: 0,
        lifetimeRedeemedPoints: 0,
        pointsDebt: 0,
      },
      purchaseSummary,
      financialSummary: {
        debtLimitVnd: profile.debtLimit,
        currentDebtVnd: profile.currentDebt,
        availableCreditVnd: toVndNumber(availableCreditBig),
        authoritativeSource: 'PENDING_M5_FINANCE',
      },
    };
  }

  async getCustomerEligibility(tenantId: string, customerId: string) {
    return this.runInTenantTx(tenantId, async (em) => {
      const customer = await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
      });
      if (!customer) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Customer '${customerId}' not found`,
          404,
        );
      }

      const [group, tier, loyaltyAccount, settings] = await Promise.all([
        customer.customerGroupId
          ? em.getRepository(CustomerGroupEntity).findOne({
              where: { id: customer.customerGroupId, tenantId },
            })
          : Promise.resolve(null),
        customer.membershipTierId
          ? em.getRepository(MembershipTierEntity).findOne({
              where: { id: customer.membershipTierId, tenantId },
            })
          : Promise.resolve(null),
        em.getRepository(LoyaltyAccountEntity).findOne({
          where: { customerId: customer.id, tenantId },
        }),
        em.getRepository(LoyaltySettingEntity).findOne({
          where: { tenantId },
        }),
      ]);

      const postedPointsBalance = loyaltyAccount?.postedPointsBalance ?? 0;
      const heldPoints = loyaltyAccount?.heldPoints ?? 0;
      const availablePoints = computeAvailablePoints(
        postedPointsBalance,
        heldPoints,
      );

      return {
        customerId: customer.id,
        tenantId: customer.tenantId,
        code: customer.code,
        name: customer.name,
        phoneNormalized: customer.phoneNormalized,
        status: customer.status,
        isActive: customer.status === 'ACTIVE' && customer.deletedAt === null,
        customerGroup: group
          ? {
              id: group.id,
              code: group.code,
              name: group.name,
              defaultDiscountRate: group.defaultDiscountRate,
            }
          : null,
        membershipTier: tier
          ? {
              id: tier.id,
              code: tier.code,
              name: tier.name,
              discountRate: tier.discountRate,
            }
          : null,
        loyalty: {
          isEnabled: settings?.isEnabled ?? true,
          postedPointsBalance,
          heldPoints,
          availablePoints,
          qualifyingPoints: loyaltyAccount?.qualifyingPoints ?? 0,
          redeemValuePerPoint: settings?.redeemValuePerPoint ?? '1000.00',
          minRedeemPoints: settings?.minRedeemPoints ?? 10,
          maxRedeemPointsPerOrder: settings?.maxRedeemPointsPerOrder ?? 10000,
        },
        version: customer.version,
      };
    });
  }

  @OnEvent(FINANCE_RECEIVABLE_CREATED.type)
  async onFinanceReceivableCreated(
    envelope: EventEnvelope<FinanceReceivableEventPayload>,
  ): Promise<void> {
    await this.syncCustomerCurrentDebtFromFinance(envelope);
  }

  @OnEvent(FINANCE_RECEIVABLE_PAYMENT_APPLIED.type)
  async onFinanceReceivablePaymentApplied(
    envelope: EventEnvelope<FinanceReceivableEventPayload>,
  ): Promise<void> {
    await this.syncCustomerCurrentDebtFromFinance(envelope);
  }

  private async syncCustomerCurrentDebtFromFinance(
    envelope: EventEnvelope<FinanceReceivableEventPayload>,
  ): Promise<void> {
    const { tenantId, payload } = envelope;
    if (
      !tenantId ||
      !payload?.customerId ||
      payload?.customerTotalDebtAfter === undefined ||
      payload.customerTotalDebtAfter === null
    ) {
      return;
    }
    const debtVnd = toVndNumber(
      parseVndBigInt(payload.customerTotalDebtAfter, true),
    );
    await this.runInTenantTx(tenantId, async (em) => {
      await em.query(
        `UPDATE ${this.schemaPrefix}"customers"
         SET "current_debt" = $3::bigint, "updated_at" = now()
         WHERE "tenant_id" = $1 AND "id" = $2`,
        [tenantId, payload.customerId, debtVnd],
      );
    });
  }
}
