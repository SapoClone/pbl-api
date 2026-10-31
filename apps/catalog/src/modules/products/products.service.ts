import { Injectable } from '@nestjs/common';
import {
  InjectTenantRepository,
  TenantScopedRepository,
  runInTenantTransaction,
} from '@pbl/common';
import {
  CATALOG_PRODUCT_CREATED,
  CATALOG_PRODUCT_DEACTIVATED,
  CATALOG_PRODUCT_UPDATED,
  CATALOG_VARIANT_CREATED,
  CATALOG_VARIANT_DEACTIVATED,
  CATALOG_VARIANT_UPDATED,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  SelectQueryBuilder,
} from 'typeorm';
import {
  CatalogDomainError,
  CatalogErrorCode,
  MAX_PRODUCT_IMAGES,
  VariantGenerationAxis,
  buildCombinationSignature,
  generateCartesianVariantSpecs,
  normalizeName,
  normalizeSku,
  parseAndFormatConversionFactor,
  parseAndFormatMoney,
  validateAndNormalizeBarcode,
  validateProductLifecycleTransition,
  validateVariantWithProductLifecycle,
} from '../../domain/catalog-domain';
import {
  AttributeEntity,
  AttributeValueEntity,
  BrandEntity,
  CategoryEntity,
  ProductEntity,
  ProductImageMeta,
  ProductVariantEntity,
  UnitConversionEntity,
  UploadEntity,
  VariantAttributeValueEntity,
} from '../../infrastructure/persistence/catalog.entities';
import { toCatalogHttpException } from '../../presentation/catalog-http-error';
import { csvRow } from './csv';
import {
  CreateProductReqDto,
  CreateUnitConversionReqDto,
  CreateVariantReqDto,
  GenerateVariantsReqDto,
  ListProductsReqDto,
  ListVariantsReqDto,
  LookupProductReqDto,
  ProductRes,
  ProductSummaryRes,
  UnitConversionRes,
  UpdateProductReqDto,
  UpdateProductStatusReqDto,
  UpdateVariantReqDto,
  UpdateVariantStatusReqDto,
  VariantAttributeInputDto,
  VariantAttributeRes,
  VariantListRes,
  VariantRes,
  VariantRowRes,
} from './products.dto';

export const MAX_EXPORT_ROWS = 10_000;

export interface ProductListResponse {
  items: ProductRes[];
  page: number;
  limit: number;
  total: number;
  nextCursor: string | null;
}

export interface ProductLookupResponse {
  variant: VariantRes;
  product: Omit<ProductRes, 'variants' | 'unitConversions'>;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
    @InjectTenantRepository(ProductEntity)
    private readonly productsRepo: TenantScopedRepository<ProductEntity>,
    @InjectTenantRepository(ProductVariantEntity)
    private readonly variantsRepo: TenantScopedRepository<ProductVariantEntity>,
    @InjectTenantRepository(UnitConversionEntity)
    private readonly unitsRepo: TenantScopedRepository<UnitConversionEntity>,
  ) {}

  private toProductRes(
    entity: ProductEntity,
    variants?: VariantRes[],
    unitConversions?: UnitConversionRes[],
  ): ProductRes {
    return {
      id: entity.id,
      categoryId: entity.categoryId,
      brandId: entity.brandId,
      name: entity.name,
      description: entity.description,
      baseUnit: entity.baseUnit,
      isCombo: entity.isCombo,
      status: entity.status,
      images: entity.images ?? [],
      version: entity.version,
      ...(variants !== undefined ? { variants } : {}),
      ...(unitConversions !== undefined ? { unitConversions } : {}),
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private toVariantRes(
    entity: ProductVariantEntity,
    attributes: VariantAttributeRes[] = [],
  ): VariantRes {
    return {
      id: entity.id,
      productId: entity.productId,
      skuCode: entity.skuCode,
      barcode: entity.barcode,
      name: entity.name,
      basePrice: parseAndFormatMoney(entity.basePrice ?? 0),
      weight: entity.weight,
      imageUrl: entity.imageUrl,
      combinationSignature: entity.combinationSignature,
      isDefault: entity.isDefault,
      status: entity.status,
      version: entity.version,
      attributes,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private toUnitRes(entity: UnitConversionEntity): UnitConversionRes {
    return {
      id: entity.id,
      productId: entity.productId,
      unitName: entity.unitName,
      conversionFactor: entity.conversionFactor,
      isBase: entity.isBase,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private async verifyCategoryAndBrand(
    em: EntityManager,
    categoryId?: string | null,
    brandId?: string | null,
  ): Promise<void> {
    if (categoryId) {
      const cat = await TenantScopedRepository.forEntity(
        em,
        CategoryEntity,
      ).findOneBy({ id: categoryId });
      if (!cat) {
        throw new CatalogDomainError(
          CatalogErrorCode.CATEGORY_NOT_FOUND,
          'Category not found in this tenant',
          'NOT_FOUND',
        );
      }
      if (cat.status !== 'ACTIVE') {
        throw new CatalogDomainError(
          CatalogErrorCode.CATEGORY_IN_USE,
          'Cannot assign product to an INACTIVE category',
          'CONFLICT',
        );
      }
    }
    if (brandId) {
      const brand = await TenantScopedRepository.forEntity(
        em,
        BrandEntity,
      ).findOneBy({ id: brandId });
      if (!brand) {
        throw new CatalogDomainError(
          CatalogErrorCode.BRAND_NOT_FOUND,
          'Brand not found in this tenant',
          'NOT_FOUND',
        );
      }
      if (brand.status !== 'ACTIVE') {
        throw new CatalogDomainError(
          CatalogErrorCode.BRAND_IN_USE,
          'Cannot assign product to an INACTIVE brand',
          'CONFLICT',
        );
      }
    }
  }

  private async loadVariantAttributesMap(
    em: EntityManager,
    variantIds: string[],
  ): Promise<Map<string, VariantAttributeRes[]>> {
    const result = new Map<string, VariantAttributeRes[]>();
    if (variantIds.length === 0) return result;

    const vavRepo = TenantScopedRepository.forEntity(
      em,
      VariantAttributeValueEntity,
    );
    const links = await vavRepo.find({
      where: { variantId: In(variantIds) },
    });
    if (links.length === 0) return result;

    const attrIds = [...new Set(links.map((l) => l.attributeId))];
    const valIds = [...new Set(links.map((l) => l.attributeValueId))];

    const [attrs, vals] = await Promise.all([
      TenantScopedRepository.forEntity(em, AttributeEntity).find({
        where: { id: In(attrIds) },
      }),
      TenantScopedRepository.forEntity(em, AttributeValueEntity).find({
        where: { id: In(valIds) },
      }),
    ]);

    const attrById = new Map(attrs.map((a) => [a.id, a]));
    const valById = new Map(vals.map((v) => [v.id, v]));

    for (const link of links) {
      const attr = attrById.get(link.attributeId);
      const val = valById.get(link.attributeValueId);
      if (!attr || !val) continue;
      const list = result.get(link.variantId) ?? [];
      list.push({
        attributeId: attr.id,
        attributeName: attr.name,
        attributeValueId: val.id,
        value: val.value,
      });
      result.set(link.variantId, list);
    }

    for (const list of result.values()) {
      list.sort((a, b) => a.attributeName.localeCompare(b.attributeName));
    }
    return result;
  }

  /**
   * Turns upload ids (POST /uploads/images) into the product's image list, in the
   * given order; the first is the cover. Marks the uploads as attached.
   */
  private async resolveImageIds(
    em: EntityManager,
    imageIds: string[],
  ): Promise<ProductImageMeta[]> {
    const unique = [...new Set(imageIds)];
    if (unique.length === 0) return [];
    const scoped = TenantScopedRepository.forEntity(em, UploadEntity);
    const rows = await scoped.find({
      where: { id: In(unique), kind: 'IMAGE' },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of unique) {
      const row = byId.get(id);
      if (!row || row.status === 'PENDING' || !row.publicUrl) {
        throw new CatalogDomainError(
          CatalogErrorCode.UPLOAD_INVALID,
          `Image ${id} is unknown or its file was not uploaded yet`,
          'BAD_REQUEST',
        );
      }
    }
    for (const row of rows) {
      if (row.status !== 'ATTACHED') {
        row.status = 'ATTACHED';
        await scoped.save(row);
      }
    }
    return unique.map((id, i) => ({
      key: byId.get(id)!.storageKey,
      url: byId.get(id)!.publicUrl as string,
      sortOrder: i,
    }));
  }

  private applyVariantFilters(
    qb: SelectQueryBuilder<ProductVariantEntity>,
    query: Pick<
      ListVariantsReqDto,
      'q' | 'barcode' | 'ids' | 'status' | 'categoryId'
    >,
  ): void {
    qb.innerJoin(
      ProductEntity,
      'p',
      'p.id = v.product_id AND p.tenant_id = v.tenant_id AND p.deleted_at IS NULL',
    ).where('v.deleted_at IS NULL');
    if (query.status) {
      qb.andWhere('v.status = :vstatus', { vstatus: query.status });
    }
    if (query.categoryId) {
      qb.andWhere('p.category_id = :categoryId', {
        categoryId: query.categoryId,
      });
    }
    if (query.barcode?.trim()) {
      qb.andWhere('v.barcode = :barcode', { barcode: query.barcode.trim() });
    }
    if (query.ids?.length) {
      qb.andWhere('v.id IN (:...ids)', { ids: query.ids });
    }
    if (query.q?.trim()) {
      const like = `%${query.q
        .trim()
        .toLowerCase()
        .replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      qb.andWhere(
        '(LOWER(v.name) LIKE :like OR LOWER(v.sku_code) LIKE :like OR LOWER(v.barcode) LIKE :like)',
        { like },
      );
    }
  }

  private variantSortColumn(sort: ListVariantsReqDto['sort']): string {
    switch (sort) {
      case 'name':
        return 'v.name';
      case 'price':
        return 'v.basePrice';
      case 'skuCode':
        return 'v.skuCode';
      default:
        return 'v.createdAt';
    }
  }

  private async toVariantRows(
    em: EntityManager,
    variants: ProductVariantEntity[],
  ): Promise<VariantRowRes[]> {
    if (variants.length === 0) return [];
    const productIds = [...new Set(variants.map((v) => v.productId))];
    const products = await TenantScopedRepository.forEntity(
      em,
      ProductEntity,
    ).find({ where: { id: In(productIds) } });
    const productById = new Map(products.map((p) => [p.id, p]));
    const categoryIds = [
      ...new Set(products.map((p) => p.categoryId).filter(Boolean)),
    ] as string[];
    const categories = categoryIds.length
      ? await TenantScopedRepository.forEntity(em, CategoryEntity).find({
          where: { id: In(categoryIds) },
        })
      : [];
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const attrs = await this.loadVariantAttributesMap(
      em,
      variants.map((v) => v.id),
    );
    return variants.map((v) => {
      const product = productById.get(v.productId);
      const category = product?.categoryId
        ? categoryById.get(product.categoryId)
        : undefined;
      const values = (attrs.get(v.id) ?? []).map((a) => a.value);
      const cover = [...(product?.images ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      )[0];
      return {
        variantId: v.id,
        productId: v.productId,
        name: product?.name ?? v.name,
        label: values.length ? values.join(' / ') : null,
        skuCode: v.skuCode,
        barcode: v.barcode,
        imageUrl: v.imageUrl ?? cover?.url ?? null,
        category: category ? { id: category.id, name: category.name } : null,
        price: v.basePrice,
        avgCostPrice: null,
        status: v.status.toLowerCase() as VariantRowRes['status'],
      };
    });
  }

  /** GET /variants: one row per variant (table on the products screen and the search pickers). */
  async listVariants(query: ListVariantsReqDto): Promise<VariantListRes> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) => {
        const qb = TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        ).createQueryBuilder('v');
        this.applyVariantFilters(qb, query);
        qb.orderBy(this.variantSortColumn(query.sort), query.order)
          .addOrderBy('v.id', query.order)
          .skip((query.page - 1) * query.limit)
          .take(query.limit);
        const [rows, total] = await qb.getManyAndCount();
        const totalPages = Math.ceil(total / query.limit);
        return {
          data: await this.toVariantRows(em, rows),
          pagination: {
            limit: query.limit,
            currentPage: query.page,
            ...(query.page < totalPages ? { nextPage: query.page + 1 } : {}),
            totalRecords: total,
            totalPages,
          },
        };
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async productSummary(): Promise<ProductSummaryRes> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) => {
        const productCount = await TenantScopedRepository.forEntity(
          em,
          ProductEntity,
        ).count({ where: { deletedAt: IsNull() } });
        const variants = TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        );
        const live = await variants
          .createQueryBuilder('v')
          .innerJoin(
            ProductEntity,
            'p',
            'p.id = v.product_id AND p.tenant_id = v.tenant_id AND p.deleted_at IS NULL',
          )
          .select('v.status', 'status')
          .addSelect('COUNT(*)', 'n')
          .where('v.deleted_at IS NULL')
          .groupBy('v.status')
          .getRawMany<{ status: string; n: string }>();
        const n = (status: string) =>
          Number(live.find((r) => r.status === status)?.n ?? 0);
        const variantCount = live.reduce((sum, r) => sum + Number(r.n), 0);
        const activeVariantCount = n('ACTIVE');
        return {
          productCount,
          variantCount,
          activeVariantCount,
          inactiveVariantCount: variantCount - activeVariantCount,
        };
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  /** GET /products/export: CSV with BOM, one row per variant, at most 10,000 rows. */
  async exportProductsCsv(
    query: Omit<ListVariantsReqDto, 'page' | 'limit'>,
  ): Promise<string> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) => {
        const qb = TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        ).createQueryBuilder('v');
        this.applyVariantFilters(qb, query);
        const total = await qb.getCount();
        if (total > MAX_EXPORT_ROWS) {
          throw new CatalogDomainError(
            CatalogErrorCode.EXPORT_LIMIT_EXCEEDED,
            `Export is limited to ${MAX_EXPORT_ROWS} rows (${total} match); narrow the filters`,
            'BAD_REQUEST',
          );
        }
        qb.orderBy(this.variantSortColumn(query.sort), query.order).addOrderBy(
          'v.id',
          query.order,
        );
        const rows = await this.toVariantRows(em, await qb.getMany());
        const lines = [
          csvRow([
            'name',
            'variant',
            'skuCode',
            'barcode',
            'category',
            'price',
            'status',
          ]),
          ...rows.map((r) =>
            csvRow([
              r.name,
              r.label,
              r.skuCode,
              r.barcode,
              r.category?.name ?? null,
              r.price,
              r.status,
            ]),
          ),
        ];
        return '\uFEFF' + lines.join('\r\n') + '\r\n';
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  /** DELETE /variants/:id: soft delete; downstream sees catalog.variant.deactivated (ARCHIVED). */
  async softDeleteVariant(id: string): Promise<void> {
    try {
      await runInTenantTransaction(this.dataSource, async (em) => {
        const scoped = TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        );
        const variant = await scoped.findOne({
          where: { id, deletedAt: IsNull() },
        });
        if (!variant) {
          throw new CatalogDomainError(
            CatalogErrorCode.VARIANT_NOT_FOUND,
            'Variant not found',
            'NOT_FOUND',
          );
        }
        variant.status = 'ARCHIVED';
        variant.version += 1;
        variant.deletedAt = new Date();
        const saved = await scoped.save(variant);
        await this.outbox.add(em, CATALOG_VARIANT_DEACTIVATED, {
          variantId: saved.id,
          productId: saved.productId,
          skuCode: saved.skuCode,
          barcode: saved.barcode,
          name: saved.name,
          basePrice: saved.basePrice,
          status: saved.status,
          isDefault: saved.isDefault,
          aggregateVersion: saved.version,
          updatedAt: saved.updatedAt.toISOString(),
        });
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async createProduct(dto: CreateProductReqDto): Promise<ProductRes> {
    try {
      const normalizedName = normalizeName(dto.name);
      const baseUnit = (dto.baseUnit ?? 'piece').trim() || 'piece';
      if (dto.images && dto.images.length > MAX_PRODUCT_IMAGES) {
        throw new CatalogDomainError(
          CatalogErrorCode.INVALID_PRODUCT_LIFECYCLE,
          `A product can have at most ${MAX_PRODUCT_IMAGES} images`,
          'BAD_REQUEST',
        );
      }

      return await runInTenantTransaction(this.dataSource, async (em) => {
        await this.verifyCategoryAndBrand(em, dto.categoryId, dto.brandId);

        const scopedProducts = TenantScopedRepository.forEntity(
          em,
          ProductEntity,
        );
        const scopedVariants = TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        );
        const scopedUnits = TenantScopedRepository.forEntity(
          em,
          UnitConversionEntity,
        );

        const product = await scopedProducts.save({
          name: dto.name.trim(),
          normalizedName,
          description: dto.description?.trim() ?? null,
          categoryId: dto.categoryId ?? null,
          brandId: dto.brandId ?? null,
          baseUnit,
          isCombo: false,
          status: dto.status ?? 'ACTIVE',
          images: dto.imageIds?.length
            ? await this.resolveImageIds(em, dto.imageIds)
            : (dto.images ?? []),
          version: 1,
        });

        const baseUnitConv = await scopedUnits.save({
          productId: product.id,
          unitName: baseUnit,
          normalizedUnitName: normalizeName(baseUnit),
          conversionFactor: '1.0000',
          isBase: true,
        });

        await this.outbox.add(em, CATALOG_PRODUCT_CREATED, {
          productId: product.id,
          name: product.name,
          baseUnit: product.baseUnit,
          categoryId: product.categoryId,
          brandId: product.brandId,
          status: product.status,
          aggregateVersion: product.version,
          updatedAt: product.updatedAt.toISOString(),
        });

        const createdVariants: VariantRes[] = [];
        const shouldCreateDefault =
          dto.createDefaultVariant === true ||
          dto.defaultSkuCode !== undefined ||
          dto.defaultBarcode !== undefined ||
          dto.defaultBasePrice !== undefined;

        if (shouldCreateDefault) {
          const skuCode = normalizeSku(
            dto.defaultSkuCode ?? `PRD-${product.id.slice(0, 8)}`,
          );
          const barcode = validateAndNormalizeBarcode(dto.defaultBarcode);
          const basePrice = parseAndFormatMoney(dto.defaultBasePrice ?? 0);

          const variant = await scopedVariants.save({
            productId: product.id,
            skuCode,
            barcode,
            name: product.name,
            basePrice,
            combinationSignature: 'DEFAULT',
            isDefault: true,
            status: product.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
            version: 1,
          });

          await this.outbox.add(em, CATALOG_VARIANT_CREATED, {
            variantId: variant.id,
            productId: product.id,
            skuCode: variant.skuCode,
            barcode: variant.barcode,
            name: variant.name,
            basePrice: variant.basePrice,
            status: variant.status,
            isDefault: variant.isDefault,
            aggregateVersion: variant.version,
            updatedAt: variant.updatedAt.toISOString(),
          });

          createdVariants.push(this.toVariantRes(variant, []));
        }

        return this.toProductRes(product, createdVariants, [
          this.toUnitRes(baseUnitConv),
        ]);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async listProducts(query: ListProductsReqDto): Promise<ProductListResponse> {
    try {
      return await this.productsRepo.transaction(async (scoped) => {
        const qb = scoped.createQueryBuilder('p').where('p.deleted_at IS NULL');

        if (query.status) {
          qb.andWhere('p.status = :status', { status: query.status });
        }
        if (query.categoryId) {
          qb.andWhere('p.category_id = :categoryId', {
            categoryId: query.categoryId,
          });
        }
        if (query.brandId) {
          qb.andWhere('p.brand_id = :brandId', { brandId: query.brandId });
        }
        if (query.q?.trim()) {
          qb.andWhere('p.normalized_name LIKE :q', {
            q: `%${query.q.trim().toLowerCase()}%`,
          });
        }

        if (query.afterCursor) {
          const sepIdx = query.afterCursor.lastIndexOf('_');
          if (sepIdx > 0) {
            const cursorDate = query.afterCursor.slice(0, sepIdx);
            const cursorId = query.afterCursor.slice(sepIdx + 1);
            if (query.order === 'DESC') {
              qb.andWhere(
                '(p.created_at < :cursorDate OR (p.created_at = :cursorDate AND p.id < :cursorId))',
                { cursorDate, cursorId },
              );
            } else {
              qb.andWhere(
                '(p.created_at > :cursorDate OR (p.created_at = :cursorDate AND p.id > :cursorId))',
                { cursorDate, cursorId },
              );
            }
          }
        }

        const sortColumn =
          query.sort === 'name'
            ? 'p.normalized_name'
            : query.sort === 'updatedAt'
              ? 'p.updated_at'
              : 'p.created_at';

        qb.orderBy(sortColumn, query.order).addOrderBy('p.id', query.order);

        if (query.afterCursor) {
          qb.take(query.limit);
          const rows = await qb.getMany();
          const last = rows[rows.length - 1];
          const nextCursor =
            rows.length === query.limit && last
              ? `${last.createdAt.toISOString()}_${last.id}`
              : null;
          return {
            items: rows.map((r) => this.toProductRes(r)),
            page: 1,
            limit: query.limit,
            total: rows.length,
            nextCursor,
          };
        }

        qb.skip((query.page - 1) * query.limit).take(query.limit);
        const [rows, total] = await qb.getManyAndCount();
        const last = rows[rows.length - 1];
        const nextCursor =
          rows.length === query.limit && last
            ? `${last.createdAt.toISOString()}_${last.id}`
            : null;

        return {
          items: rows.map((r) => this.toProductRes(r)),
          page: query.page,
          limit: query.limit,
          total,
          nextCursor,
        };
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async lookupBySkuOrBarcode(
    query: LookupProductReqDto,
  ): Promise<ProductLookupResponse> {
    try {
      const hasSku = Boolean(query.sku?.trim());
      const hasBarcode = Boolean(query.barcode?.trim());
      if (!hasSku && !hasBarcode) {
        throw new CatalogDomainError(
          CatalogErrorCode.INVALID_SKU,
          'Either sku or barcode query parameter is required',
          'BAD_REQUEST',
        );
      }

      return await runInTenantTransaction(this.dataSource, async (em) => {
        const scopedVariants = TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        );
        const scopedProducts = TenantScopedRepository.forEntity(
          em,
          ProductEntity,
        );

        const variant = hasSku
          ? await scopedVariants.findOne({
              where: {
                skuCode: normalizeSku(query.sku!),
                deletedAt: IsNull(),
              },
            })
          : await scopedVariants.findOne({
              where: {
                barcode: validateAndNormalizeBarcode(query.barcode!)!,
                deletedAt: IsNull(),
              },
            });

        if (!variant) {
          throw new CatalogDomainError(
            CatalogErrorCode.VARIANT_NOT_FOUND,
            'No matching product variant found for the given SKU or barcode',
            'NOT_FOUND',
          );
        }

        const product = await scopedProducts.findOne({
          where: { id: variant.productId, deletedAt: IsNull() },
        });
        if (!product) {
          throw new CatalogDomainError(
            CatalogErrorCode.PRODUCT_NOT_FOUND,
            'Parent product not found',
            'NOT_FOUND',
          );
        }

        const attrsMap = await this.loadVariantAttributesMap(em, [variant.id]);
        return {
          variant: this.toVariantRes(variant, attrsMap.get(variant.id) ?? []),
          product: this.toProductRes(product),
        };
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async getProductById(id: string): Promise<ProductRes> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) => {
        const product = await TenantScopedRepository.forEntity(
          em,
          ProductEntity,
        ).findOne({
          where: { id, deletedAt: IsNull() },
        });
        if (!product) {
          throw new CatalogDomainError(
            CatalogErrorCode.PRODUCT_NOT_FOUND,
            'Product not found',
            'NOT_FOUND',
          );
        }

        const [variants, units] = await Promise.all([
          TenantScopedRepository.forEntity(em, ProductVariantEntity).find({
            where: { productId: id, deletedAt: IsNull() },
            order: { isDefault: 'DESC', skuCode: 'ASC' },
          }),
          TenantScopedRepository.forEntity(em, UnitConversionEntity).find({
            where: { productId: id },
            order: { isBase: 'DESC', unitName: 'ASC' },
          }),
        ]);

        const attrsMap = await this.loadVariantAttributesMap(
          em,
          variants.map((v) => v.id),
        );

        return this.toProductRes(
          product,
          variants.map((v) => this.toVariantRes(v, attrsMap.get(v.id) ?? [])),
          units.map((u) => this.toUnitRes(u)),
        );
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async updateProduct(
    id: string,
    dto: UpdateProductReqDto,
  ): Promise<ProductRes> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) => {
        const scoped = TenantScopedRepository.forEntity(em, ProductEntity);
        const product = await scoped.findOne({
          where: { id, deletedAt: IsNull() },
        });
        if (!product) {
          throw new CatalogDomainError(
            CatalogErrorCode.PRODUCT_NOT_FOUND,
            'Product not found',
            'NOT_FOUND',
          );
        }

        if (dto.version !== undefined && dto.version !== product.version) {
          throw new CatalogDomainError(
            CatalogErrorCode.RESOURCE_VERSION_CONFLICT,
            `Product version conflict: expected ${dto.version}, current is ${product.version}`,
            'CONFLICT',
            { expectedVersion: dto.version, currentVersion: product.version },
          );
        }

        await this.verifyCategoryAndBrand(em, dto.categoryId, dto.brandId);

        if (dto.name !== undefined) {
          product.name = dto.name.trim();
          product.normalizedName = normalizeName(dto.name);
        }
        if (dto.description !== undefined) {
          product.description = dto.description?.trim() ?? null;
        }
        if (dto.categoryId !== undefined) {
          product.categoryId = dto.categoryId;
        }
        if (dto.brandId !== undefined) {
          product.brandId = dto.brandId;
        }
        if (dto.baseUnit !== undefined) {
          product.baseUnit = dto.baseUnit.trim();
        }
        if (dto.imageIds !== undefined) {
          product.images = await this.resolveImageIds(em, dto.imageIds);
        } else if (dto.images !== undefined) {
          product.images = dto.images;
        }
        product.version += 1;

        const saved = await scoped.save(product);

        await this.outbox.add(em, CATALOG_PRODUCT_UPDATED, {
          productId: saved.id,
          name: saved.name,
          baseUnit: saved.baseUnit,
          categoryId: saved.categoryId,
          brandId: saved.brandId,
          status: saved.status,
          aggregateVersion: saved.version,
          updatedAt: saved.updatedAt.toISOString(),
        });

        return this.toProductRes(saved);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async updateProductStatus(
    id: string,
    dto: UpdateProductStatusReqDto,
  ): Promise<ProductRes> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) => {
        const scoped = TenantScopedRepository.forEntity(em, ProductEntity);
        const product = await scoped.findOne({
          where: { id, deletedAt: IsNull() },
        });
        if (!product) {
          throw new CatalogDomainError(
            CatalogErrorCode.PRODUCT_NOT_FOUND,
            'Product not found',
            'NOT_FOUND',
          );
        }

        if (dto.version !== undefined && dto.version !== product.version) {
          throw new CatalogDomainError(
            CatalogErrorCode.RESOURCE_VERSION_CONFLICT,
            `Product version conflict: expected ${dto.version}, current is ${product.version}`,
            'CONFLICT',
          );
        }

        validateProductLifecycleTransition(product.status, dto.status);
        product.status = dto.status;
        product.version += 1;
        const saved = await scoped.save(product);

        if (dto.status === 'INACTIVE' || dto.status === 'ARCHIVED') {
          const scopedVariants = TenantScopedRepository.forEntity(
            em,
            ProductVariantEntity,
          );
          const activeVariants = await scopedVariants.find({
            where: { productId: id, deletedAt: IsNull() },
          });
          for (const v of activeVariants) {
            if (v.status === 'ACTIVE') {
              v.status = dto.status === 'ARCHIVED' ? 'ARCHIVED' : 'INACTIVE';
              v.version += 1;
              await scopedVariants.save(v);
              await this.outbox.add(em, CATALOG_VARIANT_DEACTIVATED, {
                variantId: v.id,
                productId: id,
                skuCode: v.skuCode,
                barcode: v.barcode,
                name: v.name,
                basePrice: v.basePrice,
                status: v.status,
                isDefault: v.isDefault,
                aggregateVersion: v.version,
                updatedAt: v.updatedAt.toISOString(),
              });
            }
          }
        }

        const eventDef =
          dto.status === 'INACTIVE' || dto.status === 'ARCHIVED'
            ? CATALOG_PRODUCT_DEACTIVATED
            : CATALOG_PRODUCT_UPDATED;

        await this.outbox.add(em, eventDef, {
          productId: saved.id,
          name: saved.name,
          baseUnit: saved.baseUnit,
          categoryId: saved.categoryId,
          brandId: saved.brandId,
          status: saved.status,
          aggregateVersion: saved.version,
          updatedAt: saved.updatedAt.toISOString(),
        });

        return this.toProductRes(saved);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async softDeleteProduct(id: string): Promise<void> {
    try {
      await runInTenantTransaction(this.dataSource, async (em) => {
        const scoped = TenantScopedRepository.forEntity(em, ProductEntity);
        const product = await scoped.findOne({
          where: { id, deletedAt: IsNull() },
        });
        if (!product) {
          throw new CatalogDomainError(
            CatalogErrorCode.PRODUCT_NOT_FOUND,
            'Product not found',
            'NOT_FOUND',
          );
        }

        product.status = 'ARCHIVED';
        product.version += 1;
        product.deletedAt = new Date();
        await scoped.save(product);

        const scopedVariants = TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        );
        const variants = await scopedVariants.find({
          where: { productId: id, deletedAt: IsNull() },
        });
        for (const v of variants) {
          v.status = 'ARCHIVED';
          v.version += 1;
          await scopedVariants.save(v);
          await this.outbox.add(em, CATALOG_VARIANT_DEACTIVATED, {
            variantId: v.id,
            productId: id,
            skuCode: v.skuCode,
            barcode: v.barcode,
            name: v.name,
            basePrice: v.basePrice,
            status: v.status,
            isDefault: v.isDefault,
            aggregateVersion: v.version,
            updatedAt: v.updatedAt.toISOString(),
          });
        }

        await this.outbox.add(em, CATALOG_PRODUCT_DEACTIVATED, {
          productId: product.id,
          name: product.name,
          baseUnit: product.baseUnit,
          categoryId: product.categoryId,
          brandId: product.brandId,
          status: product.status,
          aggregateVersion: product.version,
          updatedAt: product.updatedAt.toISOString(),
        });
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  private async verifyAndResolveVariantAttributes(
    em: EntityManager,
    pairs: VariantAttributeInputDto[],
  ): Promise<VariantAttributeRes[]> {
    if (!pairs || pairs.length === 0) return [];
    // Validates no duplicate attributeId in pairs
    buildCombinationSignature(pairs);

    const attrIds = pairs.map((p) => p.attributeId);
    const valIds = pairs.map((p) => p.attributeValueId);

    const [attrs, vals] = await Promise.all([
      TenantScopedRepository.forEntity(em, AttributeEntity).find({
        where: { id: In(attrIds) },
      }),
      TenantScopedRepository.forEntity(em, AttributeValueEntity).find({
        where: { id: In(valIds) },
      }),
    ]);

    const attrById = new Map(attrs.map((a) => [a.id, a]));
    const valById = new Map(vals.map((v) => [v.id, v]));

    const resolved: VariantAttributeRes[] = [];
    for (const pair of pairs) {
      const attr = attrById.get(pair.attributeId);
      if (!attr) {
        throw new CatalogDomainError(
          CatalogErrorCode.ATTRIBUTE_NOT_FOUND,
          `Attribute ${pair.attributeId} not found in this tenant`,
          'NOT_FOUND',
        );
      }
      const val = valById.get(pair.attributeValueId);
      if (!val || val.attributeId !== pair.attributeId) {
        throw new CatalogDomainError(
          CatalogErrorCode.INVALID_VARIANT_COMBINATION,
          `Attribute value ${pair.attributeValueId} does not belong to attribute ${attr.name}`,
          'BAD_REQUEST',
        );
      }
      resolved.push({
        attributeId: attr.id,
        attributeName: attr.name,
        attributeValueId: val.id,
        value: val.value,
      });
    }
    return resolved;
  }

  async createVariant(
    productId: string,
    dto: CreateVariantReqDto,
  ): Promise<VariantRes> {
    try {
      const skuCode = normalizeSku(dto.skuCode);
      const barcode = validateAndNormalizeBarcode(dto.barcode);
      const basePrice = parseAndFormatMoney(dto.basePrice ?? 0);
      const pairs = dto.attributes ?? [];
      const combinationSignature = buildCombinationSignature(pairs);

      return await runInTenantTransaction(this.dataSource, async (em) => {
        const product = await TenantScopedRepository.forEntity(
          em,
          ProductEntity,
        ).findOne({
          where: { id: productId, deletedAt: IsNull() },
        });
        if (!product) {
          throw new CatalogDomainError(
            CatalogErrorCode.PRODUCT_NOT_FOUND,
            'Product not found',
            'NOT_FOUND',
          );
        }
        validateVariantWithProductLifecycle(product.status, 'ACTIVE');

        const resolvedAttrs = await this.verifyAndResolveVariantAttributes(
          em,
          pairs,
        );

        const defaultName =
          resolvedAttrs.length > 0
            ? `${product.name} (${resolvedAttrs.map((a) => a.value).join(' / ')})`
            : product.name;

        const scopedVariants = TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        );
        const variant = await scopedVariants.save({
          productId,
          skuCode,
          barcode,
          name: (dto.name?.trim() || defaultName).slice(0, 240),
          basePrice,
          weight: dto.weight ?? null,
          imageUrl: dto.imageUrl ?? null,
          combinationSignature,
          isDefault: dto.isDefault ?? pairs.length === 0,
          status: 'ACTIVE',
          version: 1,
        });

        if (resolvedAttrs.length > 0) {
          const scopedVav = TenantScopedRepository.forEntity(
            em,
            VariantAttributeValueEntity,
          );
          await scopedVav.save(
            resolvedAttrs.map((a) => ({
              variantId: variant.id,
              attributeId: a.attributeId,
              attributeValueId: a.attributeValueId,
            })),
          );
        }

        await this.outbox.add(em, CATALOG_VARIANT_CREATED, {
          variantId: variant.id,
          productId,
          skuCode: variant.skuCode,
          barcode: variant.barcode,
          name: variant.name,
          basePrice: variant.basePrice,
          status: variant.status,
          isDefault: variant.isDefault,
          aggregateVersion: variant.version,
          updatedAt: variant.updatedAt.toISOString(),
        });

        return this.toVariantRes(variant, resolvedAttrs);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async generateVariants(
    productId: string,
    dto: GenerateVariantsReqDto,
  ): Promise<VariantRes[]> {
    try {
      const basePrice = parseAndFormatMoney(dto.basePrice ?? 0);

      return await runInTenantTransaction(this.dataSource, async (em) => {
        const product = await TenantScopedRepository.forEntity(
          em,
          ProductEntity,
        ).findOne({
          where: { id: productId, deletedAt: IsNull() },
        });
        if (!product) {
          throw new CatalogDomainError(
            CatalogErrorCode.PRODUCT_NOT_FOUND,
            'Product not found',
            'NOT_FOUND',
          );
        }
        validateVariantWithProductLifecycle(product.status, 'ACTIVE');

        const attrIds = dto.axes.map((a) => a.attributeId);
        const allValueIds = dto.axes.flatMap((a) => a.valueIds);

        const [attrs, vals] = await Promise.all([
          TenantScopedRepository.forEntity(em, AttributeEntity).find({
            where: { id: In(attrIds) },
          }),
          TenantScopedRepository.forEntity(em, AttributeValueEntity).find({
            where: { id: In(allValueIds) },
          }),
        ]);

        const attrById = new Map(attrs.map((a) => [a.id, a]));
        const valById = new Map(vals.map((v) => [v.id, v]));

        const domainAxes: VariantGenerationAxis[] = dto.axes.map(
          (axisInput) => {
            const attr = attrById.get(axisInput.attributeId);
            if (!attr) {
              throw new CatalogDomainError(
                CatalogErrorCode.ATTRIBUTE_NOT_FOUND,
                `Attribute ${axisInput.attributeId} not found in this tenant`,
                'NOT_FOUND',
              );
            }
            const axisValues = axisInput.valueIds.map((vid) => {
              const val = valById.get(vid);
              if (!val || val.attributeId !== attr.id) {
                throw new CatalogDomainError(
                  CatalogErrorCode.INVALID_VARIANT_COMBINATION,
                  `Attribute value ${vid} does not belong to attribute ${attr.name}`,
                  'BAD_REQUEST',
                );
              }
              return {
                id: val.id,
                value: val.value,
                skuToken: dto.skuTokens?.[val.value],
              };
            });
            return {
              attributeId: attr.id,
              attributeName: attr.name,
              values: axisValues,
            };
          },
        );

        const specs = generateCartesianVariantSpecs(
          dto.skuPrefix,
          product.name,
          domainAxes,
        );

        const scopedVariants = TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        );
        const scopedVav = TenantScopedRepository.forEntity(
          em,
          VariantAttributeValueEntity,
        );

        const created: VariantRes[] = [];
        for (const [idx, spec] of specs.entries()) {
          const variant = await scopedVariants.save({
            productId,
            skuCode: spec.skuCode,
            barcode: null,
            name: spec.name,
            basePrice,
            combinationSignature: spec.combinationSignature,
            isDefault: idx === 0,
            status: 'ACTIVE',
            version: 1,
          });

          await scopedVav.save(
            spec.attributes.map((pair) => ({
              variantId: variant.id,
              attributeId: pair.attributeId,
              attributeValueId: pair.attributeValueId,
            })),
          );

          await this.outbox.add(em, CATALOG_VARIANT_CREATED, {
            variantId: variant.id,
            productId,
            skuCode: variant.skuCode,
            barcode: null,
            name: variant.name,
            basePrice: variant.basePrice,
            status: variant.status,
            isDefault: variant.isDefault,
            aggregateVersion: variant.version,
            updatedAt: variant.updatedAt.toISOString(),
          });

          const resolvedAttrs: VariantAttributeRes[] = spec.attributes.map(
            (p) => ({
              attributeId: p.attributeId,
              attributeName: attrById.get(p.attributeId)!.name,
              attributeValueId: p.attributeValueId,
              value: valById.get(p.attributeValueId)!.value,
            }),
          );
          created.push(this.toVariantRes(variant, resolvedAttrs));
        }

        return created;
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async listProductVariants(productId: string): Promise<VariantRes[]> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) => {
        const product = await TenantScopedRepository.forEntity(
          em,
          ProductEntity,
        ).findOne({
          where: { id: productId, deletedAt: IsNull() },
        });
        if (!product) {
          throw new CatalogDomainError(
            CatalogErrorCode.PRODUCT_NOT_FOUND,
            'Product not found',
            'NOT_FOUND',
          );
        }

        const variants = await TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        ).find({
          where: { productId, deletedAt: IsNull() },
          order: { isDefault: 'DESC', skuCode: 'ASC' },
        });

        const attrsMap = await this.loadVariantAttributesMap(
          em,
          variants.map((v) => v.id),
        );
        return variants.map((v) =>
          this.toVariantRes(v, attrsMap.get(v.id) ?? []),
        );
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async getVariantById(id: string): Promise<VariantRes> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) => {
        const variant = await TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        ).findOne({
          where: { id, deletedAt: IsNull() },
        });
        if (!variant) {
          throw new CatalogDomainError(
            CatalogErrorCode.VARIANT_NOT_FOUND,
            'Variant not found',
            'NOT_FOUND',
          );
        }
        const attrsMap = await this.loadVariantAttributesMap(em, [variant.id]);
        return this.toVariantRes(variant, attrsMap.get(variant.id) ?? []);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async updateVariant(
    id: string,
    dto: UpdateVariantReqDto,
  ): Promise<VariantRes> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) => {
        const scoped = TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        );
        const variant = await scoped.findOne({
          where: { id, deletedAt: IsNull() },
        });
        if (!variant) {
          throw new CatalogDomainError(
            CatalogErrorCode.VARIANT_NOT_FOUND,
            'Variant not found',
            'NOT_FOUND',
          );
        }

        if (dto.version !== undefined && dto.version !== variant.version) {
          throw new CatalogDomainError(
            CatalogErrorCode.RESOURCE_VERSION_CONFLICT,
            `Variant version conflict: expected ${dto.version}, current is ${variant.version}`,
            'CONFLICT',
          );
        }

        let previousSkuCode: string | undefined;
        if (dto.skuCode !== undefined) {
          const nextSku = normalizeSku(dto.skuCode);
          if (nextSku !== variant.skuCode) {
            previousSkuCode = variant.skuCode;
            variant.skuCode = nextSku;
          }
        }
        if (dto.barcode !== undefined) {
          variant.barcode = validateAndNormalizeBarcode(dto.barcode);
        }
        if (dto.name !== undefined) {
          variant.name = dto.name.trim();
        }
        if (dto.basePrice !== undefined) {
          variant.basePrice = parseAndFormatMoney(dto.basePrice);
        }
        if (dto.weight !== undefined) {
          variant.weight = dto.weight;
        }
        if (dto.imageUrl !== undefined) {
          variant.imageUrl = dto.imageUrl;
        }
        variant.version += 1;

        const saved = await scoped.save(variant);

        await this.outbox.add(em, CATALOG_VARIANT_UPDATED, {
          variantId: saved.id,
          productId: saved.productId,
          skuCode: saved.skuCode,
          ...(previousSkuCode ? { previousSkuCode } : {}),
          barcode: saved.barcode,
          name: saved.name,
          basePrice: saved.basePrice,
          status: saved.status,
          isDefault: saved.isDefault,
          aggregateVersion: saved.version,
          updatedAt: saved.updatedAt.toISOString(),
        });

        const attrsMap = await this.loadVariantAttributesMap(em, [saved.id]);
        return this.toVariantRes(saved, attrsMap.get(saved.id) ?? []);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async updateVariantStatus(
    id: string,
    dto: UpdateVariantStatusReqDto,
  ): Promise<VariantRes> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) => {
        const scoped = TenantScopedRepository.forEntity(
          em,
          ProductVariantEntity,
        );
        const variant = await scoped.findOne({
          where: { id, deletedAt: IsNull() },
        });
        if (!variant) {
          throw new CatalogDomainError(
            CatalogErrorCode.VARIANT_NOT_FOUND,
            'Variant not found',
            'NOT_FOUND',
          );
        }

        if (dto.version !== undefined && dto.version !== variant.version) {
          throw new CatalogDomainError(
            CatalogErrorCode.RESOURCE_VERSION_CONFLICT,
            `Variant version conflict: expected ${dto.version}, current is ${variant.version}`,
            'CONFLICT',
          );
        }

        const product = await TenantScopedRepository.forEntity(
          em,
          ProductEntity,
        ).findOneBy({ id: variant.productId });
        if (product) {
          validateVariantWithProductLifecycle(product.status, dto.status);
        }

        variant.status = dto.status;
        variant.version += 1;
        const saved = await scoped.save(variant);

        const eventDef =
          dto.status === 'INACTIVE' || dto.status === 'ARCHIVED'
            ? CATALOG_VARIANT_DEACTIVATED
            : CATALOG_VARIANT_UPDATED;

        await this.outbox.add(em, eventDef, {
          variantId: saved.id,
          productId: saved.productId,
          skuCode: saved.skuCode,
          barcode: saved.barcode,
          name: saved.name,
          basePrice: saved.basePrice,
          status: saved.status,
          isDefault: saved.isDefault,
          aggregateVersion: saved.version,
          updatedAt: saved.updatedAt.toISOString(),
        });

        const attrsMap = await this.loadVariantAttributesMap(em, [saved.id]);
        return this.toVariantRes(saved, attrsMap.get(saved.id) ?? []);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async addUnitConversion(
    productId: string,
    dto: CreateUnitConversionReqDto,
  ): Promise<UnitConversionRes> {
    try {
      const normalizedUnitName = normalizeName(dto.unitName);
      const isBase = dto.isBase ?? false;
      const conversionFactor = parseAndFormatConversionFactor(
        dto.conversionFactor,
        isBase,
      );

      return await this.unitsRepo.transaction(async (scoped, em) => {
        const product = await TenantScopedRepository.forEntity(
          em,
          ProductEntity,
        ).findOne({
          where: { id: productId, deletedAt: IsNull() },
        });
        if (!product) {
          throw new CatalogDomainError(
            CatalogErrorCode.PRODUCT_NOT_FOUND,
            'Product not found',
            'NOT_FOUND',
          );
        }

        const saved = await scoped.save({
          productId,
          unitName: dto.unitName.trim(),
          normalizedUnitName,
          conversionFactor,
          isBase,
        });
        return this.toUnitRes(saved);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async listUnitConversions(productId: string): Promise<UnitConversionRes[]> {
    try {
      return await this.unitsRepo.transaction(async (scoped, em) => {
        const product = await TenantScopedRepository.forEntity(
          em,
          ProductEntity,
        ).findOne({
          where: { id: productId, deletedAt: IsNull() },
        });
        if (!product) {
          throw new CatalogDomainError(
            CatalogErrorCode.PRODUCT_NOT_FOUND,
            'Product not found',
            'NOT_FOUND',
          );
        }
        const rows = await scoped.find({
          where: { productId },
          order: { isBase: 'DESC', unitName: 'ASC' },
        });
        return rows.map((r) => this.toUnitRes(r));
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }
}
