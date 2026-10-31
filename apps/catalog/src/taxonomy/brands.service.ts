import { Injectable } from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantScopedRepository,
} from '@pbl/common';
import { randomUUID } from 'crypto';
import {
  CatalogErrorCode,
  conflict,
  notFound,
  translateUnique,
} from '../common/catalog-errors';
import { Page, PageQueryDto, likePattern, toPage } from '../common/page';
import { BrandEntity, ProductEntity } from '../entities/catalog.entities';
import { BrandRes } from './taxonomy.dto';

@Injectable()
export class BrandsService {
  constructor(
    @InjectTenantScopedRepository(BrandEntity)
    private readonly brands: TenantScopedRepository<BrandEntity>,
    @InjectTenantScopedRepository(ProductEntity)
    private readonly products: TenantScopedRepository<ProductEntity>,
  ) {}

  async list(query: PageQueryDto): Promise<Page<BrandRes>> {
    const qb = this.brands.createQueryBuilder('b');
    if (query.q)
      qb.andWhere(`b.name ILIKE :q ESCAPE '\\'`, { q: likePattern(query.q) });
    const [rows, total] = await qb
      .orderBy('b.name', 'ASC')
      .addOrderBy('b.id', 'ASC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .getManyAndCount();
    return toPage(rows.map(toRes), total, query.page, query.limit);
  }

  async create(name: string): Promise<BrandRes> {
    const saved = await translateUnique(() =>
      this.brands.save({ id: randomUUID(), name }),
    );
    return toRes(saved as BrandEntity);
  }

  async update(id: string, name: string): Promise<BrandRes> {
    const brand = await this.brands.findOneBy({ id });
    if (!brand) throw notFound('Brand');
    brand.name = name;
    return toRes(await translateUnique(() => this.brands.save(brand)));
  }

  async remove(id: string): Promise<void> {
    if (!(await this.brands.exists({ where: { id } }))) throw notFound('Brand');
    if (await this.products.exists({ where: { brandId: id } })) {
      throw conflict(
        CatalogErrorCode.BRAND_IN_USE,
        'The brand is still used by products',
      );
    }
    await this.brands.delete({ id });
  }
}

const toRes = (row: BrandEntity): BrandRes => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
});
