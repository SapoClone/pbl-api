import { Injectable } from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantScopedRepository,
} from '@pbl/common';
import { randomUUID } from 'crypto';
import {
  CatalogErrorCode,
  badRequest,
  conflict,
  notFound,
  translateUnique,
} from '../common/catalog-errors';
import { Page, likePattern, slugify, toPage } from '../common/page';
import { CategoryEntity, ProductEntity } from '../entities/catalog.entities';
import {
  CategoryRes,
  CreateCategoryReqDto,
  ListCategoriesReqDto,
  UpdateCategoryReqDto,
} from './taxonomy.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectTenantScopedRepository(CategoryEntity)
    private readonly categories: TenantScopedRepository<CategoryEntity>,
    @InjectTenantScopedRepository(ProductEntity)
    private readonly products: TenantScopedRepository<ProductEntity>,
  ) {}

  async list(query: ListCategoriesReqDto): Promise<Page<CategoryRes>> {
    const qb = this.categories.createQueryBuilder('c');
    if (query.q)
      qb.andWhere(`c.name ILIKE :q ESCAPE '\\'`, { q: likePattern(query.q) });
    if (query.parentId === 'root') qb.andWhere('c.parentId IS NULL');
    else if (query.parentId)
      qb.andWhere('c.parentId = :parentId', { parentId: query.parentId });
    const [rows, total] = await qb
      .orderBy('c.name', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .getManyAndCount();
    const counts = await this.productCounts(rows.map((row) => row.id));
    return toPage(
      rows.map((row) => this.toRes(row, counts.get(row.id) ?? 0)),
      total,
      query.page,
      query.limit,
    );
  }

  async create(dto: CreateCategoryReqDto): Promise<CategoryRes> {
    if (dto.parentId) await this.require(dto.parentId, true);
    const saved = await translateUnique(() =>
      this.categories.save({
        id: randomUUID(),
        parentId: dto.parentId ?? null,
        name: dto.name,
        slug: slugify(dto.name) || 'category',
      }),
    );
    return this.toRes(saved as CategoryEntity, 0);
  }

  async update(id: string, dto: UpdateCategoryReqDto): Promise<CategoryRes> {
    const category = await this.require(id);
    if (dto.parentId !== undefined) {
      if (dto.parentId !== null) {
        await this.require(dto.parentId, true);
        await this.assertNotInside(id, dto.parentId);
      }
      category.parentId = dto.parentId;
    }
    if (dto.name !== undefined) {
      category.name = dto.name;
      category.slug = slugify(dto.name) || 'category';
    }
    const saved = await translateUnique(() => this.categories.save(category));
    return this.toRes(saved, (await this.productCounts([id])).get(id) ?? 0);
  }

  /** 409 while the category has children or products: nothing is orphaned silently */
  async remove(id: string): Promise<void> {
    await this.require(id);
    const children = await this.categories.count({ where: { parentId: id } });
    const products = (await this.productCounts([id])).get(id) ?? 0;
    if (children > 0 || products > 0) {
      throw conflict(
        CatalogErrorCode.CATEGORY_NOT_EMPTY,
        'The category still has products or sub-categories',
      );
    }
    await this.categories.delete({ id });
  }

  private async require(
    id: string,
    asReference = false,
  ): Promise<CategoryEntity> {
    const found = await this.categories.findOneBy({ id });
    if (found) return found;
    throw asReference
      ? badRequest(
          CatalogErrorCode.UNKNOWN_REFERENCE,
          'Unknown parent category',
        )
      : notFound('Category');
  }

  /** The new parent must not be the category itself or one of its descendants */
  private async assertNotInside(id: string, parentId: string): Promise<void> {
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      if (cursor === id) {
        throw badRequest(
          CatalogErrorCode.CATEGORY_CYCLE,
          'A category cannot be moved under itself or its own descendants',
        );
      }
      seen.add(cursor);
      cursor =
        (await this.categories.findOneBy({ id: cursor }))?.parentId ?? null;
    }
  }

  private async productCounts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.products
      .createQueryBuilder('p')
      .select('p.categoryId', 'categoryId')
      .addSelect('COUNT(*)', 'count')
      .where('p.categoryId IN (:...ids)', { ids })
      .groupBy('p.categoryId')
      .getRawMany<{ categoryId: string; count: string }>();
    return new Map(rows.map((row) => [row.categoryId, Number(row.count)]));
  }

  private toRes(row: CategoryEntity, productCount: number): CategoryRes {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      parentId: row.parentId,
      productCount,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
