import { Injectable } from '@nestjs/common';
import { InjectTenantRepository, TenantScopedRepository } from '@pbl/common';
import {
  CatalogDomainError,
  CatalogErrorCode,
  normalizeName,
} from '../../domain/catalog-domain';
import { BrandEntity } from '../../infrastructure/persistence/catalog.entities';
import { toCatalogHttpException } from '../../presentation/catalog-http-error';
import { PaginatedResult } from '../categories/categories.service';
import {
  BrandRes,
  CreateBrandReqDto,
  ListBrandsReqDto,
  UpdateBrandReqDto,
} from './brands.dto';

@Injectable()
export class BrandsService {
  constructor(
    @InjectTenantRepository(BrandEntity)
    private readonly brandsRepo: TenantScopedRepository<BrandEntity>,
  ) {}

  private toRes(entity: BrandEntity): BrandRes {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      status: entity.status,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  async create(dto: CreateBrandReqDto): Promise<BrandRes> {
    try {
      const normalizedName = normalizeName(dto.name);
      return await this.brandsRepo.transaction(async (scoped) => {
        const saved = await scoped.save({
          name: dto.name.trim(),
          normalizedName,
          description: dto.description?.trim() ?? null,
          status: 'ACTIVE',
        });
        return this.toRes(saved);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async getById(id: string): Promise<BrandRes> {
    try {
      return await this.brandsRepo.transaction(async (scoped) => {
        const brand = await scoped.findOneBy({ id });
        if (!brand) {
          throw new CatalogDomainError(
            CatalogErrorCode.BRAND_NOT_FOUND,
            'Brand not found',
            'NOT_FOUND',
          );
        }
        return this.toRes(brand);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async list(query: ListBrandsReqDto): Promise<PaginatedResult<BrandRes>> {
    try {
      return await this.brandsRepo.transaction(async (scoped) => {
        const qb = scoped.createQueryBuilder('b');
        if (query.status) {
          qb.andWhere('b.status = :status', { status: query.status });
        }
        if (query.q?.trim()) {
          qb.andWhere('b.normalized_name LIKE :q', {
            q: `%${query.q.trim().toLowerCase()}%`,
          });
        }
        qb.orderBy('b.name', 'ASC')
          .addOrderBy('b.id', 'ASC')
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

  async update(id: string, dto: UpdateBrandReqDto): Promise<BrandRes> {
    try {
      return await this.brandsRepo.transaction(async (scoped) => {
        const brand = await scoped.findOneBy({ id });
        if (!brand) {
          throw new CatalogDomainError(
            CatalogErrorCode.BRAND_NOT_FOUND,
            'Brand not found',
            'NOT_FOUND',
          );
        }
        if (dto.name !== undefined) {
          brand.name = dto.name.trim();
          brand.normalizedName = normalizeName(dto.name);
        }
        if (dto.description !== undefined) {
          brand.description = dto.description?.trim() ?? null;
        }
        if (dto.status !== undefined) {
          brand.status = dto.status;
        }
        const saved = await scoped.save(brand);
        return this.toRes(saved);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  /**
   * Deactivates the brand (`status = 'INACTIVE'`) so historical product records
   * retain their brand reference safely without breaking foreign keys.
   */
  async deactivate(id: string): Promise<BrandRes> {
    try {
      return await this.brandsRepo.transaction(async (scoped) => {
        const brand = await scoped.findOneBy({ id });
        if (!brand) {
          throw new CatalogDomainError(
            CatalogErrorCode.BRAND_NOT_FOUND,
            'Brand not found',
            'NOT_FOUND',
          );
        }
        brand.status = 'INACTIVE';
        const saved = await scoped.save(brand);
        return this.toRes(saved);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }
}
