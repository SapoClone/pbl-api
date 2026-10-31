import { Injectable } from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantScopedRepository,
} from '@pbl/common';
import { randomUUID } from 'crypto';
import { notFound, translateUnique } from '../common/catalog-errors';
import { Page, PageQueryDto, likePattern, toPage } from '../common/page';
import {
  AttributeEntity,
  AttributeValueEntity,
} from '../entities/catalog.entities';
import { AttributeRes, CreateAttributeValueReqDto } from './taxonomy.dto';

@Injectable()
export class AttributesService {
  constructor(
    @InjectTenantScopedRepository(AttributeEntity)
    private readonly attributes: TenantScopedRepository<AttributeEntity>,
    @InjectTenantScopedRepository(AttributeValueEntity)
    private readonly values: TenantScopedRepository<AttributeValueEntity>,
  ) {}

  async list(query: PageQueryDto): Promise<Page<AttributeRes>> {
    const qb = this.attributes.createQueryBuilder('a');
    if (query.q)
      qb.andWhere(`a.name ILIKE :q ESCAPE '\\'`, { q: likePattern(query.q) });
    const [rows, total] = await qb
      .orderBy('a.name', 'ASC')
      .addOrderBy('a.id', 'ASC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .getManyAndCount();
    return toPage(await this.withValues(rows), total, query.page, query.limit);
  }

  async create(name: string): Promise<AttributeRes> {
    const saved = await translateUnique(() =>
      this.attributes.save({ id: randomUUID(), name }),
    );
    return { id: saved.id, name: saved.name, values: [] };
  }

  async addValue(
    attributeId: string,
    dto: CreateAttributeValueReqDto,
  ): Promise<AttributeRes> {
    const attribute = await this.attributes.findOneBy({ id: attributeId });
    if (!attribute) throw notFound('Attribute');
    await translateUnique(() =>
      this.values.save({
        id: randomUUID(),
        attributeId,
        value: dto.value,
        code: (dto.code ?? defaultCode(dto.value)).toUpperCase(),
      }),
    );
    return (await this.withValues([attribute]))[0];
  }

  private async withValues(rows: AttributeEntity[]): Promise<AttributeRes[]> {
    if (rows.length === 0) return [];
    const values = await this.values
      .createQueryBuilder('v')
      .where('v.attributeId IN (:...ids)', { ids: rows.map((row) => row.id) })
      .orderBy('v.value', 'ASC')
      .getMany();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      values: values
        .filter((value) => value.attributeId === row.id)
        .map((value) => ({
          id: value.id,
          value: value.value,
          code: value.code,
        })),
    }));
  }
}

/** `Xanh sage` -> `XANHSAGE`, cut to the 30 characters a code may have */
const defaultCode = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 30) || 'V';
