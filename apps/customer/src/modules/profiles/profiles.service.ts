import { Injectable } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import {
  CUSTOMER_CREATED,
  CUSTOMER_DEACTIVATED,
  CUSTOMER_GROUP_CHANGED,
  CUSTOMER_MEMBERSHIP_CHANGED,
  CUSTOMER_UPDATED,
  CustomerGroupChangedPayload,
  CustomerLifecycleEventPayload,
  CustomerMembershipChangedPayload,
  FINANCE_RECEIVABLE_CREATED,
  FINANCE_RECEIVABLE_PAYMENT_APPLIED,
  FinanceReceivableEventPayload,
} from '@pbl/contracts';
import { EventOutbox, OnEvent } from '@pbl/events';
import { DataSource, EntityManager } from 'typeorm';
import {
  computeAvailablePoints,
  CustomerDomainError,
  CustomerDomainErrorCode,
  formatVnd,
  maskEmailAddress,
  maskPhoneNumber,
  normalizeEmail,
  normalizePhoneNumber,
  parseVndBigInt,
  resolveEligibleMembershipTier,
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
  LoyaltyAccountEntity,
  LoyaltyHoldEntity,
  LoyaltySettingEntity,
  MembershipTierEntity,
} from '../../infrastructure/persistence/customer.entities';
import {
  CreateCustomerDto,
  DeactivateCustomerQueryDto,
  ListCustomerOrdersQueryDto,
  ListCustomersQueryDto,
  LookupCustomerQueryDto,
  UpdateCustomerDto,
} from './profiles.dto';

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
      maskPii?: boolean;
      group?: CustomerGroupEntity | null;
      tier?: MembershipTierEntity | null;
      loyaltyAccount?: LoyaltyAccountEntity | null;
      defaultAddress?: CustomerAddressEntity | null;
    },
  ) {
    const mask = options?.maskPii === true;
    const loyalty = options?.loyaltyAccount;
    return {
      id: customer.id,
      tenantId: customer.tenantId,
      code: customer.code,
      name: customer.name,
      phone: mask ? maskPhoneNumber(customer.phone) : customer.phone,
      phoneNormalized: mask
        ? maskPhoneNumber(customer.phoneNormalized)
        : customer.phoneNormalized,
      email: mask ? maskEmailAddress(customer.email) : customer.email,
      gender: customer.gender,
      dateOfBirth: mask ? null : customer.dateOfBirth,
      source: customer.source,
      status: customer.status,
      customerGroupId: customer.customerGroupId,
      membershipTierId: customer.membershipTierId,
      debtLimit: customer.debtLimit,
      currentDebt: customer.currentDebt,
      note: mask ? null : customer.note,
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
        ? { defaultAddress: options.defaultAddress }
        : {}),
    };
  }

  async createCustomer(
    tenantId: string,
    _actorId: string,
    dto: CreateCustomerDto,
  ) {
    const trimmedName = dto.name?.trim();
    if (!trimmedName) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        'Customer name is required',
        422,
      );
    }

    const phoneNormalized = normalizePhoneNumber(dto.phone);
    const emailNormalized = normalizeEmail(dto.email);
    const debtLimitFormatted = dto.debtLimit
      ? formatVnd(parseVndBigInt(dto.debtLimit, true))
      : '2000000.00';

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
        if (dto.customerGroupId) {
          group = await em.getRepository(CustomerGroupEntity).findOne({
            where: { id: dto.customerGroupId, tenantId },
          });
          if (!group || group.status !== 'ACTIVE') {
            throw new CustomerDomainError(
              CustomerDomainErrorCode.CUSTOMER_GROUP_NOT_FOUND,
              `Active customer group '${dto.customerGroupId}' not found`,
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
          tier = resolveEligibleMembershipTier(0, tiers);
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
          name: trimmedName,
          phone: dto.phone?.trim() || phoneNormalized,
          phoneNormalized,
          email: emailNormalized,
          gender: dto.gender ?? null,
          dateOfBirth: dto.dateOfBirth ?? null,
          source: dto.source?.trim().toUpperCase() || 'POS',
          status: 'ACTIVE',
          customerGroupId: group?.id ?? null,
          membershipTierId: tier?.id ?? null,
          debtLimit: debtLimitFormatted,
          currentDebt: '0.00',
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
          postedPointsBalance: 0,
          heldPoints: 0,
          lifetimeEarnedPoints: 0,
          lifetimeRedeemedPoints: 0,
          qualifyingPoints: 0,
          tierId: tier?.id ?? null,
          status: 'ACTIVE',
          version: 1,
        });
        const savedLoyalty = await em
          .getRepository(LoyaltyAccountEntity)
          .save(loyaltyAccount);

        let savedAddress: CustomerAddressEntity | null = null;
        if (dto.initialAddress) {
          const addrPhoneRaw = dto.initialAddress.phone ?? dto.phone;
          const addrPhoneNorm = normalizePhoneNumber(addrPhoneRaw);
          const addr = em.getRepository(CustomerAddressEntity).create({
            tenantId,
            customerId: savedCustomer.id,
            recipientName:
              dto.initialAddress.recipientName?.trim() || savedCustomer.name,
            phone: addrPhoneRaw?.trim() || addrPhoneNorm,
            phoneNormalized: addrPhoneNorm,
            addressLine: dto.initialAddress.addressLine.trim(),
            ward: dto.initialAddress.ward?.trim() ?? null,
            district: dto.initialAddress.district?.trim() ?? null,
            province: dto.initialAddress.province?.trim() ?? null,
            isDefault: true,
            status: 'ACTIVE',
          });
          savedAddress = await em
            .getRepository(CustomerAddressEntity)
            .save(addr);
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

        return this.formatCustomerRecord(savedCustomer, {
          group,
          tier,
          loyaltyAccount: savedLoyalty,
          defaultAddress: savedAddress,
        });
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

  async listCustomers(
    tenantId: string,
    query: ListCustomersQueryDto,
    callerRoles: string[] = [],
  ) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = (page - 1) * limit;
    const shouldMaskPii = query.maskPii === true;

    return this.runInTenantTx(tenantId, async (em) => {
      const qb = em
        .getRepository(CustomerEntity)
        .createQueryBuilder('c')
        .where('c.tenant_id = :tenantId', { tenantId });

      if (query.status) {
        qb.andWhere('c.status = :status', { status: query.status });
      } else {
        qb.andWhere('c.deleted_at IS NULL');
      }

      if (query.customerGroupId) {
        qb.andWhere('c.customer_group_id = :customerGroupId', {
          customerGroupId: query.customerGroupId,
        });
      }

      if (query.membershipTierId) {
        qb.andWhere('c.membership_tier_id = :membershipTierId', {
          membershipTierId: query.membershipTierId,
        });
      }

      if (query.source) {
        qb.andWhere('c.source = :source', {
          source: query.source.trim().toUpperCase(),
        });
      }

      if (query.q && query.q.trim()) {
        const rawQ = query.q.trim();
        let phoneQ: string | null = null;
        try {
          phoneQ = normalizePhoneNumber(rawQ);
        } catch {
          phoneQ = null;
        }
        if (phoneQ) {
          qb.andWhere(
            '(c.phone_normalized = :phoneQ OR c.name ILIKE :likeQ OR c.code ILIKE :likeQ)',
            { phoneQ, likeQ: `%${rawQ}%` },
          );
        } else {
          qb.andWhere(
            '(c.name ILIKE :likeQ OR c.code ILIKE :likeQ OR c.phone ILIKE :likeQ OR c.email ILIKE :likeQ)',
            { likeQ: `%${rawQ}%` },
          );
        }
      }

      if (query.cursor) {
        const cursorRow = await em.getRepository(CustomerEntity).findOne({
          where: { id: query.cursor, tenantId },
        });
        if (cursorRow) {
          qb.andWhere(
            '(c.created_at < :cursorCreatedAt OR (c.created_at = :cursorCreatedAt AND c.id < :cursorId))',
            {
              cursorCreatedAt: cursorRow.createdAt,
              cursorId: cursorRow.id,
            },
          );
        }
      }

      qb.orderBy('c.created_at', 'DESC').addOrderBy('c.id', 'DESC');

      if (!query.cursor) {
        qb.skip(offset);
      }
      qb.take(limit);

      const [items, total] = await qb.getManyAndCount();
      const customerIds = items.map((c) => c.id);

      const loyaltyByCustomer = new Map<string, LoyaltyAccountEntity>();
      if (customerIds.length > 0) {
        const accounts = await em
          .getRepository(LoyaltyAccountEntity)
          .createQueryBuilder('la')
          .where('la.tenant_id = :tenantId', { tenantId })
          .andWhere('la.customer_id IN (:...customerIds)', { customerIds })
          .getMany();
        for (const acc of accounts) {
          loyaltyByCustomer.set(acc.customerId, acc);
        }
      }

      const nextCursor =
        items.length === limit ? (items[items.length - 1]?.id ?? null) : null;

      return {
        items: items.map((c) =>
          this.formatCustomerRecord(c, {
            maskPii: shouldMaskPii,
            loyaltyAccount: loyaltyByCustomer.get(c.id) ?? null,
          }),
        ),
        total,
        page,
        limit,
        nextCursor,
        piiMasked: shouldMaskPii,
        callerRoles,
      };
    });
  }

  async lookupCustomer(tenantId: string, query: LookupCustomerQueryDto) {
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

      const [group, tier, loyaltyAccount, defaultAddress] = await Promise.all([
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
      ]);

      return this.formatCustomerRecord(customer, {
        group,
        tier,
        loyaltyAccount,
        defaultAddress,
      });
    });
  }

  async getCustomerById(
    tenantId: string,
    customerId: string,
    options?: { maskPii?: boolean },
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

      const [group, tier, loyaltyAccount, defaultAddress] = await Promise.all([
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
      ]);

      return this.formatCustomerRecord(customer, {
        maskPii: options?.maskPii,
        group,
        tier,
        loyaltyAccount,
        defaultAddress,
      });
    });
  }

  async updateCustomer(
    tenantId: string,
    customerId: string,
    actorId: string,
    dto: UpdateCustomerDto,
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

        if (dto.dateOfBirth !== undefined) {
          customer.dateOfBirth = dto.dateOfBirth;
        }

        if (dto.debtLimit !== undefined) {
          customer.debtLimit = formatVnd(parseVndBigInt(dto.debtLimit, true));
        }

        if (dto.note !== undefined) {
          customer.note = dto.note?.trim() ?? null;
        }

        if (dto.status !== undefined) {
          customer.status = dto.status;
        }

        const previousGroupId = customer.customerGroupId;
        let group: CustomerGroupEntity | null = null;
        if (dto.customerGroupId !== undefined) {
          if (dto.customerGroupId === null) {
            customer.customerGroupId = null;
          } else {
            group = await em.getRepository(CustomerGroupEntity).findOne({
              where: { id: dto.customerGroupId, tenantId },
            });
            if (!group || group.status !== 'ACTIVE') {
              throw new CustomerDomainError(
                CustomerDomainErrorCode.CUSTOMER_GROUP_NOT_FOUND,
                `Active customer group '${dto.customerGroupId}' not found`,
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

        return this.formatCustomerRecord(saved, {
          group,
          tier,
          loyaltyAccount,
        });
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
           COALESCE(SUM("original_order_total"), 0)::numeric(18,2)::text AS "gross_spend",
           COALESCE(SUM("returned_amount"), 0)::numeric(18,2)::text AS "returned_amount",
           COALESCE(SUM(GREATEST(0, "eligible_net_spend" - "returned_amount")), 0)::numeric(18,2)::text AS "net_spend",
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
        grossSpendVnd: agg?.gross_spend ?? '0.00',
        returnedAmountVnd: agg?.returned_amount ?? '0.00',
        netSpendVnd: agg?.net_spend ?? '0.00',
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

  async getCustomerSummary(tenantId: string, customerId: string) {
    const [profile, purchaseSummary] = await Promise.all([
      this.getCustomerById(tenantId, customerId),
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
        availableCreditVnd: formatVnd(availableCreditBig),
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
    if (!tenantId || !payload?.customerId || !payload?.customerTotalDebtAfter) {
      return;
    }
    const debtVnd = formatVnd(
      parseVndBigInt(payload.customerTotalDebtAfter, true),
    );
    await this.runInTenantTx(tenantId, async (em) => {
      await em.query(
        `UPDATE ${this.schemaPrefix}"customers"
         SET "current_debt" = $3::numeric(18,2), "updated_at" = now()
         WHERE "tenant_id" = $1 AND "id" = $2`,
        [tenantId, payload.customerId, debtVnd],
      );
    });
  }
}
