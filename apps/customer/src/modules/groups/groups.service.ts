import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  CUSTOMER_GROUP_CHANGED,
  CustomerGroupChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  CustomerDomainError,
  CustomerDomainErrorCode,
} from '../../domain/customer-domain';
import {
  getSchemaPrefix,
  nextCustomerDocumentCode,
} from '../../infrastructure/persistence/customer-code.generator';
import {
  CustomerEntity,
  CustomerGroupEntity,
} from '../../infrastructure/persistence/customer.entities';
import {
  AssignCustomerGroupDto,
  CreateCustomerGroupDto,
  UpdateCustomerGroupDto,
} from './groups.dto';

@Injectable()
export class GroupsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
  ) {}

  async createGroup(dto: CreateCustomerGroupDto): Promise<CustomerGroupEntity> {
    const tenantId = TenantContext.require();
    const trimmedName = dto.name.trim();
    if (!trimmedName) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        'Group name is required',
        422,
      );
    }

    const prefix = getSchemaPrefix(this.dataSource);
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const dup: Array<{ id: string }> = await em.query(
        `SELECT id FROM ${prefix}"customer_groups"
         WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)
         LIMIT 1`,
        [tenantId, trimmedName],
      );
      if (dup.length > 0) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_GROUP_ALREADY_EXISTS,
          `Customer group "${trimmedName}" already exists`,
          409,
        );
      }

      const code = dto.code?.trim().toUpperCase()
        ? dto.code.trim().toUpperCase()
        : await nextCustomerDocumentCode(em, tenantId, 'GRP');

      const entity = em.create(CustomerGroupEntity, {
        id: randomUUID(),
        tenantId,
        code,
        name: trimmedName,
        description: dto.description?.trim() ?? null,
        defaultDiscountRate: Number(dto.defaultDiscountRate ?? 0).toFixed(2),
        status: 'ACTIVE',
      });

      try {
        return await em.save(CustomerGroupEntity, entity);
      } catch (err: unknown) {
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code?: string }).code === '23505'
        ) {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.CUSTOMER_GROUP_ALREADY_EXISTS,
            `Customer group "${trimmedName}" or code "${code}" already exists`,
            409,
          );
        }
        throw err;
      }
    });
  }

  async listGroups(): Promise<CustomerGroupEntity[]> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return em.getRepository(CustomerGroupEntity).find({
        where: { tenantId },
        order: { createdAt: 'ASC' },
      });
    });
  }

  async updateGroup(
    groupId: string,
    dto: UpdateCustomerGroupDto,
  ): Promise<CustomerGroupEntity> {
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const group = await em.getRepository(CustomerGroupEntity).findOne({
        where: { id: groupId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!group) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_GROUP_NOT_FOUND,
          `Customer group ${groupId} not found`,
          404,
        );
      }

      if (dto.name !== undefined) {
        const trimmedName = dto.name.trim();
        if (!trimmedName) {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.VALIDATION_ERROR,
            'Group name cannot be empty',
            422,
          );
        }
        const dup: Array<{ id: string }> = await em.query(
          `SELECT id FROM ${prefix}"customer_groups"
           WHERE tenant_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3
           LIMIT 1`,
          [tenantId, trimmedName, groupId],
        );
        if (dup.length > 0) {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.CUSTOMER_GROUP_ALREADY_EXISTS,
            `Customer group "${trimmedName}" already exists`,
            409,
          );
        }
        group.name = trimmedName;
      }

      if (dto.description !== undefined) {
        group.description = dto.description?.trim() ?? null;
      }
      if (dto.defaultDiscountRate !== undefined) {
        group.defaultDiscountRate = Number(dto.defaultDiscountRate).toFixed(2);
      }
      if (dto.status === 'INACTIVE' && group.status !== 'INACTIVE') {
        const activeCount = await em.getRepository(CustomerEntity).count({
          where: {
            tenantId,
            customerGroupId: groupId,
            status: 'ACTIVE',
          },
        });
        if (activeCount > 0 && !dto.forceDeactivate) {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.CUSTOMER_GROUP_NOT_EMPTY,
            `Cannot deactivate group ${group.name} while ${activeCount} active customers belong to it`,
            409,
            { activeCustomerCount: activeCount },
          );
        }
        group.status = 'INACTIVE';
      } else if (dto.status === 'ACTIVE') {
        group.status = 'ACTIVE';
      }

      group.updatedAt = new Date();
      return em.save(CustomerGroupEntity, group);
    });
  }

  async assignCustomerToGroup(
    customerId: string,
    actorId: string,
    dto: AssignCustomerGroupDto,
  ): Promise<CustomerEntity> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

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

      if (dto.customerGroupId) {
        const group = await em.getRepository(CustomerGroupEntity).findOne({
          where: { id: dto.customerGroupId, tenantId },
        });
        if (!group) {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.CUSTOMER_GROUP_NOT_FOUND,
            `Customer group ${dto.customerGroupId} not found in tenant`,
            404,
          );
        }
        if (group.status !== 'ACTIVE') {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.VALIDATION_ERROR,
            `Customer group ${group.name} is INACTIVE`,
            409,
          );
        }
      }

      const previousGroupId = customer.customerGroupId;
      customer.customerGroupId = dto.customerGroupId ?? null;
      customer.version += 1;
      customer.updatedAt = new Date();
      const saved = await em.save(CustomerEntity, customer);

      if (previousGroupId !== saved.customerGroupId) {
        await this.outbox.add(em, CUSTOMER_GROUP_CHANGED, {
          customerId: saved.id,
          previousGroupId,
          newGroupId: saved.customerGroupId,
          actorId,
          occurredAt: saved.updatedAt.toISOString(),
        } satisfies CustomerGroupChangedPayload);
      }

      return saved;
    });
  }
}
