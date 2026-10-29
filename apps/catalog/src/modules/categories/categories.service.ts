import { Injectable } from '@nestjs/common';
import {
  InjectTenantRepository,
  TenantScopedRepository,
  runInTenantTransaction,
} from '@pbl/common';
import { DataSource } from 'typeorm';
import {
  CatalogDomainError,
  CatalogErrorCode,
  MAX_CATEGORY_DEPTH,
  normalizeName,
  normalizeSlug,
  validateCategoryReparent,
} from '../../domain/catalog-domain';
import {
  CategoryEntity,
  ProductEntity,
} from '../../infrastructure/persistence/catalog.entities';
import { toCatalogHttpException } from '../../presentation/catalog-http-error';
import {
  CategoryRes,
  CategoryTreeNodeRes,
  CreateCategoryReqDto,
  ListCategoriesReqDto,
  ReparentCategoryReqDto,
  UpdateCategoryReqDto,
  UpdateCategoryStatusReqDto,
} from './categories.dto';

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectTenantRepository(CategoryEntity)
    private readonly categoriesRepo: TenantScopedRepository<CategoryEntity>,
  ) {}

  private toRes(entity: CategoryEntity): CategoryRes {
    return {
      id: entity.id,
      parentId: entity.parentId,
      name: entity.name,
      slug: entity.slug,
      depth: entity.depth,
      status: entity.status,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private get schemaPrefix(): string {
    const schema = (this.dataSource.options as { schema?: string }).schema;
    return schema ? `"${schema}".` : '';
  }

  async create(dto: CreateCategoryReqDto): Promise<CategoryRes> {
    try {
      const normalizedName = normalizeName(dto.name);
      const slug = normalizeSlug(dto.slug ?? dto.name);

      return await this.categoriesRepo.transaction(async (scoped) => {
        let depth = 1;
        const parentId = dto.parentId ?? null;

        if (parentId) {
          const parent = await scoped.findOneBy({ id: parentId });
          if (!parent) {
            throw new CatalogDomainError(
              CatalogErrorCode.CATEGORY_NOT_FOUND,
              'Parent category not found in this tenant',
              'NOT_FOUND',
            );
          }
          if (parent.status !== 'ACTIVE') {
            throw new CatalogDomainError(
              CatalogErrorCode.CATEGORY_IN_USE,
              'Cannot create a subcategory under an INACTIVE parent category',
              'CONFLICT',
            );
          }
          if (parent.depth >= MAX_CATEGORY_DEPTH) {
            throw new CatalogDomainError(
              CatalogErrorCode.CATEGORY_DEPTH_EXCEEDED,
              `Category hierarchy depth cannot exceed ${MAX_CATEGORY_DEPTH} levels`,
              'CONFLICT',
            );
          }
          depth = parent.depth + 1;
        }

        const saved = await scoped.save({
          name: dto.name.trim(),
          normalizedName,
          slug,
          parentId,
          depth,
          status: 'ACTIVE',
        });
        return this.toRes(saved);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async getById(id: string): Promise<CategoryRes> {
    try {
      return await this.categoriesRepo.transaction(async (scoped) => {
        const category = await scoped.findOneBy({ id });
        if (!category) {
          throw new CatalogDomainError(
            CatalogErrorCode.CATEGORY_NOT_FOUND,
            'Category not found',
            'NOT_FOUND',
          );
        }
        return this.toRes(category);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async list(
    query: ListCategoriesReqDto,
  ): Promise<PaginatedResult<CategoryRes>> {
    try {
      return await this.categoriesRepo.transaction(async (scoped) => {
        const qb = scoped.createQueryBuilder('c');
        if (query.status) {
          qb.andWhere('c.status = :status', { status: query.status });
        }
        if (query.parentId) {
          qb.andWhere('c.parent_id = :parentId', { parentId: query.parentId });
        }
        if (query.q?.trim()) {
          const search = `%${query.q.trim().toLowerCase()}%`;
          qb.andWhere(
            '(c.normalized_name LIKE :search OR c.slug LIKE :search)',
            {
              search,
            },
          );
        }

        qb.orderBy('c.depth', 'ASC')
          .addOrderBy('c.name', 'ASC')
          .addOrderBy('c.id', 'ASC')
          .skip((query.page - 1) * query.limit)
          .take(query.limit);

        const [rows, total] = await qb.getManyAndCount();
        return {
          items: rows.map((r) => this.toRes(r)),
          page: query.page,
          limit: query.limit,
          total,
        };
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async getTree(activeOnly = false): Promise<CategoryTreeNodeRes[]> {
    try {
      return await this.categoriesRepo.transaction(async (scoped) => {
        const qb = scoped.createQueryBuilder('c');
        if (activeOnly) {
          qb.andWhere('c.status = :status', { status: 'ACTIVE' });
        }
        qb.orderBy('c.depth', 'ASC')
          .addOrderBy('c.name', 'ASC')
          .addOrderBy('c.id', 'ASC');

        const all = await qb.getMany();
        const map = new Map<string, CategoryTreeNodeRes>();
        const roots: CategoryTreeNodeRes[] = [];

        for (const row of all) {
          map.set(row.id, { ...this.toRes(row), children: [] });
        }
        for (const node of map.values()) {
          if (node.parentId && map.has(node.parentId)) {
            map.get(node.parentId)!.children.push(node);
          } else {
            roots.push(node);
          }
        }
        return roots;
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async update(id: string, dto: UpdateCategoryReqDto): Promise<CategoryRes> {
    try {
      return await this.categoriesRepo.transaction(async (scoped) => {
        const category = await scoped.findOneBy({ id });
        if (!category) {
          throw new CatalogDomainError(
            CatalogErrorCode.CATEGORY_NOT_FOUND,
            'Category not found',
            'NOT_FOUND',
          );
        }

        if (dto.name !== undefined) {
          category.name = dto.name.trim();
          category.normalizedName = normalizeName(dto.name);
          if (dto.slug === undefined) {
            category.slug = normalizeSlug(dto.name);
          }
        }
        if (dto.slug !== undefined) {
          category.slug = normalizeSlug(dto.slug);
        }

        const saved = await scoped.save(category);
        return this.toRes(saved);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async reparent(
    id: string,
    dto: ReparentCategoryReqDto,
  ): Promise<CategoryRes> {
    try {
      return await runInTenantTransaction(
        this.dataSource,
        async (em, tenantId) => {
          const catTable = `${this.schemaPrefix}"categories"`;

          // Lock target category row
          const targetRows: {
            id: string;
            parent_id: string | null;
            depth: number;
          }[] = await em.query(
            `SELECT id, parent_id, depth FROM ${catTable} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
            [tenantId, id],
          );
          if (targetRows.length === 0) {
            throw new CatalogDomainError(
              CatalogErrorCode.CATEGORY_NOT_FOUND,
              'Category not found',
              'NOT_FOUND',
            );
          }

          let newParentDepth = 0;
          if (dto.parentId !== null) {
            if (dto.parentId === id) {
              throw new CatalogDomainError(
                CatalogErrorCode.CATEGORY_CYCLE_DETECTED,
                'A category cannot be its own parent',
                'CONFLICT',
              );
            }
            const parentRows: { id: string; depth: number; status: string }[] =
              await em.query(
                `SELECT id, depth, status FROM ${catTable} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
                [tenantId, dto.parentId],
              );
            if (parentRows.length === 0) {
              throw new CatalogDomainError(
                CatalogErrorCode.CATEGORY_NOT_FOUND,
                'New parent category not found in this tenant',
                'NOT_FOUND',
              );
            }
            if (parentRows[0].status !== 'ACTIVE') {
              throw new CatalogDomainError(
                CatalogErrorCode.CATEGORY_IN_USE,
                'Cannot reparent under an INACTIVE category',
                'CONFLICT',
              );
            }
            newParentDepth = Number(parentRows[0].depth);
          }

          // Recursive CTE to inspect and lock the entire descendant subtree
          const subtreeRows: { id: string; rel_depth: number }[] =
            await em.query(
              `
              WITH RECURSIVE subtree AS (
                SELECT id, parent_id, 0 AS rel_depth
                FROM ${catTable}
                WHERE tenant_id = $1 AND id = $2
                UNION ALL
                SELECT c.id, c.parent_id, s.rel_depth + 1
                FROM ${catTable} c
                INNER JOIN subtree s ON c.parent_id = s.id AND c.tenant_id = $1
              )
              SELECT id, rel_depth FROM subtree
              `,
              [tenantId, id],
            );

          const { newCategoryDepth } = validateCategoryReparent({
            categoryId: id,
            newParentId: dto.parentId,
            newParentDepth,
            descendantRelativeDepths: subtreeRows.map((r) => ({
              id: r.id,
              relativeDepth: Number(r.rel_depth),
            })),
          });

          const depthDelta = newCategoryDepth - Number(targetRows[0].depth);

          await em.query(
            `UPDATE ${catTable} SET parent_id = $1, depth = $2, updated_at = now() WHERE tenant_id = $3 AND id = $4`,
            [dto.parentId, newCategoryDepth, tenantId, id],
          );

          const descendantIds = subtreeRows
            .filter((r) => r.id !== id)
            .map((r) => r.id);
          if (descendantIds.length > 0 && depthDelta !== 0) {
            await em.query(
              `UPDATE ${catTable} SET depth = depth + $1, updated_at = now() WHERE tenant_id = $2 AND id = ANY($3::uuid[])`,
              [depthDelta, tenantId, descendantIds],
            );
          }

          const updated = await TenantScopedRepository.forEntity(
            em,
            CategoryEntity,
          ).findOneBy({ id });
          return this.toRes(updated!);
        },
      );
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async updateStatus(
    id: string,
    dto: UpdateCategoryStatusReqDto,
  ): Promise<CategoryRes> {
    try {
      return await runInTenantTransaction(
        this.dataSource,
        async (em, tenantId) => {
          const catTable = `${this.schemaPrefix}"categories"`;
          const scoped = TenantScopedRepository.forEntity(em, CategoryEntity);
          const category = await scoped.findOneBy({ id });
          if (!category) {
            throw new CatalogDomainError(
              CatalogErrorCode.CATEGORY_NOT_FOUND,
              'Category not found',
              'NOT_FOUND',
            );
          }

          if (dto.status === 'INACTIVE') {
            const subtreeRows: { id: string; status: string }[] =
              await em.query(
                `
                WITH RECURSIVE subtree AS (
                  SELECT id, status FROM ${catTable} WHERE tenant_id = $1 AND id = $2
                  UNION ALL
                  SELECT c.id, c.status FROM ${catTable} c
                  INNER JOIN subtree s ON c.parent_id = s.id AND c.tenant_id = $1
                )
                SELECT id, status FROM subtree
                `,
                [tenantId, id],
              );

            const activeChildren = subtreeRows.filter(
              (r) => r.id !== id && r.status === 'ACTIVE',
            );
            if (activeChildren.length > 0 && !dto.cascade) {
              throw new CatalogDomainError(
                CatalogErrorCode.CATEGORY_IN_USE,
                'Category has active subcategories. Set cascade=true or deactivate subcategories first',
                'CONFLICT',
              );
            }

            const allIds = subtreeRows.map((r) => r.id);
            const activeProductCount = await em
              .getRepository(ProductEntity)
              .createQueryBuilder('p')
              .where('p.tenant_id = :tenantId', { tenantId })
              .andWhere('p.category_id IN (:...allIds)', { allIds })
              .andWhere('p.status = :status', { status: 'ACTIVE' })
              .andWhere('p.deleted_at IS NULL')
              .getCount();

            if (activeProductCount > 0) {
              throw new CatalogDomainError(
                CatalogErrorCode.CATEGORY_IN_USE,
                `Category (or its subtree) is referenced by ${activeProductCount} active product(s)`,
                'CONFLICT',
              );
            }

            if (dto.cascade && allIds.length > 1) {
              await em.query(
                `UPDATE ${catTable} SET status = 'INACTIVE', updated_at = now() WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
                [tenantId, allIds],
              );
            }
          } else if (dto.status === 'ACTIVE' && category.parentId) {
            const parent = await scoped.findOneBy({ id: category.parentId });
            if (parent && parent.status !== 'ACTIVE') {
              throw new CatalogDomainError(
                CatalogErrorCode.CATEGORY_IN_USE,
                'Cannot activate a category while its parent category is INACTIVE',
                'CONFLICT',
              );
            }
          }

          category.status = dto.status;
          const saved = await scoped.save(category);
          return this.toRes(saved);
        },
      );
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await runInTenantTransaction(this.dataSource, async (em, tenantId) => {
        const scoped = TenantScopedRepository.forEntity(em, CategoryEntity);
        const category = await scoped.findOneBy({ id });
        if (!category) {
          throw new CatalogDomainError(
            CatalogErrorCode.CATEGORY_NOT_FOUND,
            'Category not found',
            'NOT_FOUND',
          );
        }

        const childCount = await scoped.count({ where: { parentId: id } });
        if (childCount > 0) {
          throw new CatalogDomainError(
            CatalogErrorCode.CATEGORY_IN_USE,
            'Category has subcategories and cannot be deleted',
            'CONFLICT',
          );
        }

        const productCount = await em.getRepository(ProductEntity).count({
          where: { tenantId, categoryId: id },
          withDeleted: true,
        });
        if (productCount > 0) {
          throw new CatalogDomainError(
            CatalogErrorCode.CATEGORY_IN_USE,
            'Category is referenced by products and cannot be hard-deleted; deactivate instead',
            'CONFLICT',
          );
        }

        await scoped.delete(id);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }
}
