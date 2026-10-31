import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  CustomerDomainError,
  CustomerDomainErrorCode,
} from '../../domain/customer-domain';
import { getSchemaPrefix } from '../../infrastructure/persistence/customer-code.generator';
import { CustomerTagEntity } from '../../infrastructure/persistence/customer.entities';
import { CreateCustomerTagDto } from './tags.dto';

@Injectable()
export class TagsService {
  constructor(private readonly dataSource: DataSource) {}

  private runInTenantTx<T>(
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

  async listTags(tenantId: string) {
    return this.runInTenantTx(tenantId, async (em) => {
      const tags = await em.getRepository(CustomerTagEntity).find({
        where: { tenantId },
        order: { name: 'ASC' },
      });
      return { data: tags.map((t) => ({ id: t.id, name: t.name })) };
    });
  }

  async createTag(tenantId: string, dto: CreateCustomerTagDto) {
    const name = dto.name.trim();
    if (!name) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        'Tag name is required',
        422,
      );
    }
    const prefix = getSchemaPrefix(this.dataSource);
    return this.runInTenantTx(tenantId, async (em) => {
      const dup: Array<{ id: string }> = await em.query(
        `SELECT "id" FROM ${prefix}"customer_tags"
         WHERE "tenant_id" = $1 AND LOWER("name") = LOWER($2) LIMIT 1`,
        [tenantId, name],
      );
      if (dup.length > 0) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_TAG_ALREADY_EXISTS,
          `Customer tag "${name}" already exists`,
          409,
          { existingTagId: dup[0].id },
        );
      }
      try {
        const saved = await em
          .getRepository(CustomerTagEntity)
          .save(em.getRepository(CustomerTagEntity).create({ tenantId, name }));
        return { id: saved.id, name: saved.name };
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new CustomerDomainError(
            CustomerDomainErrorCode.CUSTOMER_TAG_ALREADY_EXISTS,
            `Customer tag "${name}" already exists`,
            409,
          );
        }
        throw err;
      }
    });
  }
}
