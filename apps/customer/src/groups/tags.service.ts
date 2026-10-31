import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantScopedRepository } from '@pbl/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { CustomerErrorCode, isUniqueViolation } from '../common/errors';
import { CustomerTagEntity } from '../entities/customer.entities';

export interface TagRes {
  id: string;
  name: string;
}

@Injectable()
export class TagsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(): Promise<{ data: TagRes[] }> {
    const tags = TenantScopedRepository.forEntity(
      this.dataSource,
      CustomerTagEntity,
    );
    const rows = await tags.find({ order: { name: 'ASC' } });
    return { data: rows.map((t) => ({ id: t.id, name: t.name })) };
  }

  async create(name: string): Promise<TagRes> {
    const tags = TenantScopedRepository.forEntity(
      this.dataSource,
      CustomerTagEntity,
    );
    const existing = await tags
      .createQueryBuilder('t')
      .where('lower(t.name) = lower(:name)', { name })
      .getCount();
    if (existing > 0) throw this.taken();
    try {
      const saved = await tags.save({ id: randomUUID(), name });
      return { id: saved.id, name: saved.name };
    } catch (error) {
      if (isUniqueViolation(error, 'UQ_customer_tag_tenant_name'))
        throw this.taken();
      throw error;
    }
  }

  private taken() {
    return new BadRequestException({
      errorCode: CustomerErrorCode.TAG_NAME_TAKEN,
      message: 'A tag with this name already exists',
    });
  }
}
