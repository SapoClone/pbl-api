import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext, TenantScopedRepository } from '@pbl/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { CustomerErrorCode, isUniqueViolation } from '../common/errors';
import {
  CustomerEntity,
  CustomerGroupEntity,
  DEFAULT_GROUPS,
} from '../entities/customer.entities';

export interface GroupRes {
  id: string;
  code: string;
  name: string;
  customerCount: number;
  isSeeded: boolean;
}

const slugify = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'group';

/**
 * Creates the four default groups of a store the first time it is needed (a
 * store never goes through a sign-up step in this service). Safe to run
 * concurrently: the unique `(tenant, code)` index and ON CONFLICT make it a no-op.
 */
export async function ensureDefaultGroups(
  em: EntityManager,
  tenantId: string,
): Promise<void> {
  const groups = TenantScopedRepository.forEntity(em, CustomerGroupEntity);
  if (
    (await groups.count({ where: { isSeeded: true } })) >= DEFAULT_GROUPS.length
  ) {
    return;
  }
  await em
    .createQueryBuilder()
    .insert()
    .into(CustomerGroupEntity)
    .values(
      DEFAULT_GROUPS.map((group) => ({
        id: randomUUID(),
        tenantId,
        code: group.code,
        name: group.name,
        isSeeded: true,
      })),
    )
    .orIgnore()
    .execute();
}

@Injectable()
export class GroupsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(): Promise<{ data: GroupRes[] }> {
    const tenantId = TenantContext.require();
    await ensureDefaultGroups(this.dataSource.manager, tenantId);
    const rows: {
      id: string;
      code: string;
      name: string;
      is_seeded: boolean;
      customer_count: string;
    }[] = await this.dataSource
      .getRepository(CustomerGroupEntity)
      .createQueryBuilder('g')
      .leftJoin(
        CustomerEntity,
        'c',
        'c.group_id = g.id AND c.tenant_id = g.tenant_id AND c.deleted_at IS NULL',
      )
      .where('g.tenant_id = :tenantId', { tenantId })
      .select([
        'g.id AS id',
        'g.code AS code',
        'g.name AS name',
        'g.isSeeded AS is_seeded',
      ])
      .addSelect('count(c.id)', 'customer_count')
      .groupBy('g.id')
      .getRawMany();
    // the four defaults keep their natural order, custom groups follow by name
    const rank = new Map<string, number>(
      DEFAULT_GROUPS.map((g, i) => [g.code, i]),
    );
    rows.sort(
      (a, b) =>
        (rank.get(a.code) ?? 99) - (rank.get(b.code) ?? 99) ||
        a.name.localeCompare(b.name),
    );
    return {
      data: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        customerCount: Number(r.customer_count),
        isSeeded: r.is_seeded,
      })),
    };
  }

  async create(name: string): Promise<GroupRes> {
    const tenantId = TenantContext.require();
    await ensureDefaultGroups(this.dataSource.manager, tenantId);
    const groups = TenantScopedRepository.forEntity(
      this.dataSource,
      CustomerGroupEntity,
    );
    await this.assertNameFree(groups, name);
    const base = slugify(name);
    for (let attempt = 1; attempt <= 20; attempt++) {
      const code = attempt === 1 ? base : `${base}-${attempt}`;
      if (await groups.exists({ where: { code } })) continue;
      try {
        const saved = await groups.save({
          id: randomUUID(),
          code,
          name,
          isSeeded: false,
        });
        return { id: saved.id, code, name, customerCount: 0, isSeeded: false };
      } catch (error) {
        if (isUniqueViolation(error, 'UQ_customer_group_tenant_name')) {
          throw this.nameTaken();
        }
        if (!isUniqueViolation(error, 'UQ_customer_group_tenant_code'))
          throw error;
      }
    }
    throw new BadRequestException({
      errorCode: CustomerErrorCode.GROUP_NAME_TAKEN,
      message: 'A group with a similar name exists',
    });
  }

  async rename(id: string, name: string): Promise<GroupRes> {
    await ensureDefaultGroups(this.dataSource.manager, TenantContext.require());
    const groups = TenantScopedRepository.forEntity(
      this.dataSource,
      CustomerGroupEntity,
    );
    const group = await groups.findOneBy({ id });
    if (!group) throw new NotFoundException();
    await this.assertNameFree(groups, name, id);
    try {
      await groups.update({ id }, { name });
    } catch (error) {
      if (isUniqueViolation(error, 'UQ_customer_group_tenant_name')) {
        throw this.nameTaken();
      }
      throw error;
    }
    const count = await TenantScopedRepository.forEntity(
      this.dataSource,
      CustomerEntity,
    ).count({ where: { groupId: id, deletedAt: IsNull() } });
    return {
      id,
      code: group.code,
      name,
      customerCount: count,
      isSeeded: group.isSeeded,
    };
  }

  private async assertNameFree(
    groups: TenantScopedRepository<CustomerGroupEntity>,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const same = await groups
      .createQueryBuilder('g')
      .where('lower(g.name) = lower(:name)', { name })
      .getMany();
    if (same.some((g) => g.id !== exceptId)) throw this.nameTaken();
  }

  private nameTaken() {
    return new BadRequestException({
      errorCode: CustomerErrorCode.GROUP_NAME_TAKEN,
      message: 'A group with this name already exists',
    });
  }
}
