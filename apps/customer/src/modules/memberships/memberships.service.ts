import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  CUSTOMER_MEMBERSHIP_CHANGED,
  CustomerMembershipChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  CustomerDomainError,
  CustomerDomainErrorCode,
  resolveEligibleMembershipTier,
} from '../../domain/customer-domain';
import { nextCustomerDocumentCode } from '../../infrastructure/persistence/customer-code.generator';
import {
  CustomerEntity,
  LoyaltyAccountEntity,
  MembershipTierEntity,
} from '../../infrastructure/persistence/customer.entities';
import {
  CreateMembershipTierDto,
  UpdateMembershipTierDto,
} from './memberships.dto';

@Injectable()
export class MembershipsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
  ) {}

  async createTier(
    dto: CreateMembershipTierDto,
  ): Promise<MembershipTierEntity> {
    const tenantId = TenantContext.require();
    const trimmedName = dto.name.trim();
    if (!trimmedName) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        'Membership tier name is required',
        422,
      );
    }

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const code = dto.code?.trim().toUpperCase()
        ? dto.code.trim().toUpperCase()
        : await nextCustomerDocumentCode(em, tenantId, 'TIER');

      const existing = await em.getRepository(MembershipTierEntity).findOne({
        where: { tenantId, code },
      });
      if (existing) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.MEMBERSHIP_TIER_ALREADY_EXISTS,
          `Membership tier with code "${code}" already exists`,
          409,
        );
      }

      const entity = em.create(MembershipTierEntity, {
        id: randomUUID(),
        tenantId,
        code,
        name: trimmedName,
        minPoints: dto.minPoints,
        discountRate: Number(dto.discountRate ?? 0).toFixed(2),
        benefitsJson: dto.benefits ?? {},
        status: 'ACTIVE',
      });

      return em.save(MembershipTierEntity, entity);
    });
  }

  async listTiers(): Promise<MembershipTierEntity[]> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return em.getRepository(MembershipTierEntity).find({
        where: { tenantId },
        order: { minPoints: 'ASC', code: 'ASC' },
      });
    });
  }

  async updateTier(
    tierId: string,
    dto: UpdateMembershipTierDto,
  ): Promise<MembershipTierEntity> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const tier = await em.getRepository(MembershipTierEntity).findOne({
        where: { id: tierId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tier) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.MEMBERSHIP_TIER_NOT_FOUND,
          `Membership tier ${tierId} not found`,
          404,
        );
      }

      if (dto.name !== undefined) {
        const trimmedName = dto.name.trim();
        if (!trimmedName) {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.VALIDATION_ERROR,
            'Membership tier name cannot be empty',
            422,
          );
        }
        tier.name = trimmedName;
      }
      if (dto.minPoints !== undefined) {
        tier.minPoints = dto.minPoints;
      }
      if (dto.discountRate !== undefined) {
        tier.discountRate = Number(dto.discountRate).toFixed(2);
      }
      if (dto.benefits !== undefined) {
        tier.benefitsJson = dto.benefits;
      }
      if (dto.status !== undefined) {
        tier.status = dto.status;
      }
      tier.updatedAt = new Date();
      return em.save(MembershipTierEntity, tier);
    });
  }

  async getCustomerMembership(customerId: string) {
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

      const account = await em.getRepository(LoyaltyAccountEntity).findOne({
        where: { customerId, tenantId },
      });
      const qualifyingPoints = account?.qualifyingPoints ?? 0;

      const tiers = await em.getRepository(MembershipTierEntity).find({
        where: { tenantId, status: 'ACTIVE' },
        order: { minPoints: 'ASC' },
      });

      const currentTier = customer.membershipTierId
        ? ((await em.getRepository(MembershipTierEntity).findOne({
            where: { id: customer.membershipTierId, tenantId },
          })) ?? resolveEligibleMembershipTier(qualifyingPoints, tiers))
        : resolveEligibleMembershipTier(qualifyingPoints, tiers);

      const nextTier =
        tiers.find((t) => t.minPoints > qualifyingPoints) ?? null;

      return {
        customerId: customer.id,
        qualifyingPoints,
        lifetimeEarnedPoints: account?.lifetimeEarnedPoints ?? 0,
        postedPointsBalance: account?.postedPointsBalance ?? 0,
        tier: currentTier,
        nextTier: nextTier
          ? {
              id: nextTier.id,
              code: nextTier.code,
              name: nextTier.name,
              minPoints: nextTier.minPoints,
              pointsNeeded: Math.max(0, nextTier.minPoints - qualifyingPoints),
            }
          : null,
      };
    });
  }

  /**
   * Evaluates and updates the customer's membership tier inside an active
   * PostgreSQL transaction based on `qualifying_points` (never redeemable wallet balance).
   */
  async recalculateCustomerTierWithinTransaction(
    em: EntityManager,
    tenantId: string,
    customerId: string,
    qualifyingPoints: number,
  ): Promise<MembershipTierEntity | null> {
    const tiers = await em.getRepository(MembershipTierEntity).find({
      where: { tenantId, status: 'ACTIVE' },
    });
    const eligible = resolveEligibleMembershipTier(qualifyingPoints, tiers);
    const newTierId = eligible?.id ?? null;

    const customer = await em.getRepository(CustomerEntity).findOne({
      where: { id: customerId, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!customer) {
      return eligible;
    }

    const previousTierId = customer.membershipTierId;
    if (previousTierId !== newTierId) {
      customer.membershipTierId = newTierId;
      customer.version += 1;
      customer.updatedAt = new Date();
      await em.save(CustomerEntity, customer);

      await em
        .getRepository(LoyaltyAccountEntity)
        .update(
          { tenantId, customerId },
          { tierId: newTierId, updatedAt: new Date() },
        );

      await this.outbox.add(
        em,
        CUSTOMER_MEMBERSHIP_CHANGED,
        {
          customerId,
          previousTierId,
          newTierId,
          qualifyingPoints,
          occurredAt: new Date().toISOString(),
        } satisfies CustomerMembershipChangedPayload,
        { tenantId },
      );
    }

    return eligible;
  }
}
