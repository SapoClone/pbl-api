import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  InjectTenantScopedRepository,
  TenantScopedRepository,
} from '@pbl/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import {
  CatalogErrorCode,
  badRequest,
  conflict,
  notFound,
  translateUnique,
} from '../common/catalog-errors';
import { Page, likePattern, toPage } from '../common/page';
import {
  AttributeEntity,
  AttributeValueEntity,
  BrandEntity,
  CategoryEntity,
  ProductChannelListingEntity,
  ProductEntity,
  ProductImageEntity,
  ProductStatus,
  ProductVariantEntity,
  VariantAttribute,
} from '../entities/catalog.entities';
import {
  CreateProductReqDto,
  ExportProductsReqDto,
  ListProductsReqDto,
  ListVariantsReqDto,
  UpdateProductReqDto,
  UpdateVariantReqDto,
  VariantReqDto,
} from './products.dto';
import {
  Axis,
  MAX_VARIANTS,
  TooManyVariantsError,
  combinationKey,
  generateVariants,
  variantLabel,
} from './variant-generation';

export const EXPORT_LIMIT = 10_000;
const CSV_BOM = String.fromCharCode(0xfeff);

export interface VariantRes {
  id: string;
  productId: string;
  skuCode: string;
  barcode: string | null;
  label: string | null;
  attributes: VariantAttribute[];
  price: number;
  avgCostPrice: number | null;
  weight: number | null;
  status: ProductStatus;
  channels: string[];
}

export interface ProductRes {
  id: string;
  name: string;
  description: string | null;
  baseUnit: string;
  status: ProductStatus;
  isCombo: boolean;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  /** Derived from the variants: the axes and the values in use */
  attributes: { name: string; values: string[] }[];
  images: { id: string; url: string; isCover: boolean; sortOrder: number }[];
  variants: VariantRes[];
  createdAt: string;
  updatedAt: string;
}

/**
 * One row per variant. There is no `available`/`stockLevel`: stock belongs to inventory,
 * so the client asks `GET /inventory/api/v1/stock` for these variants' SKUs and merges.
 */
export interface ProductRowRes {
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string | null;
  skuCode: string;
  barcode: string | null;
  imageUrl: string | null;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  price: number;
  avgCostPrice: number | null;
  status: ProductStatus;
  channels: string[];
  /** Price lists are not built yet */
  hasMemberPrice: boolean;
}

export interface VariantLookupRes {
  variantId: string;
  productId: string;
  name: string;
  label: string | null;
  skuCode: string;
  barcode: string | null;
  imageUrl: string | null;
  price: number;
  avgCostPrice: number | null;
  status: ProductStatus;
  category: { id: string; name: string } | null;
}

interface Filters {
  q?: string;
  status?: ProductStatus;
  categoryIds?: string[];
  brandId?: string;
  channels?: string[];
  barcode?: string;
  sku?: string;
  ids?: string[];
}

interface Draft {
  skuCode: string;
  barcode: string | null;
  price: number;
  costPrice: number | null;
  weight: number | null;
  status: ProductStatus;
  attributes: VariantAttribute[];
  channels?: string[];
}

const SORT_COLUMNS = {
  createdAt: 'v.createdAt',
  price: 'v.price',
  name: 'p.name',
  skuCode: 'v.skuCode',
} as const;

@Injectable()
export class ProductsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectTenantScopedRepository(ProductEntity)
    private readonly products: TenantScopedRepository<ProductEntity>,
    @InjectTenantScopedRepository(ProductVariantEntity)
    private readonly variants: TenantScopedRepository<ProductVariantEntity>,
    @InjectTenantScopedRepository(ProductImageEntity)
    private readonly images: TenantScopedRepository<ProductImageEntity>,
    @InjectTenantScopedRepository(ProductChannelListingEntity)
    private readonly listings: TenantScopedRepository<ProductChannelListingEntity>,
    @InjectTenantScopedRepository(CategoryEntity)
    private readonly categories: TenantScopedRepository<CategoryEntity>,
    @InjectTenantScopedRepository(BrandEntity)
    private readonly brands: TenantScopedRepository<BrandEntity>,
    @InjectTenantScopedRepository(AttributeEntity)
    private readonly attributes: TenantScopedRepository<AttributeEntity>,
    @InjectTenantScopedRepository(AttributeValueEntity)
    private readonly attributeValues: TenantScopedRepository<AttributeValueEntity>,
  ) {}

  // ---- lists ---------------------------------------------------------

  async list(query: ListProductsReqDto): Promise<Page<ProductRowRes>> {
    const qb = await this.filtered({
      q: query.q,
      status: query.status,
      categoryIds: await this.categoryTree(query.categoryId),
      brandId: query.brandId,
      channels: query.channel,
    });
    const [rows, total] = await qb
      .orderBy(SORT_COLUMNS[query.sort], query.order)
      .addOrderBy('v.id', 'ASC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .getManyAndCount();
    const view = await this.hydrate(rows);
    return toPage(
      rows.map((row) => view.row(row)),
      total,
      query.page,
      query.limit,
    );
  }

  async summary() {
    const [productCount, variantCount, activeVariantCount] = await Promise.all([
      this.products.count(),
      this.variants.count(),
      this.variants.count({ where: { status: 'active' } }),
    ]);
    return {
      productCount,
      variantCount,
      activeVariantCount,
      inactiveVariantCount: variantCount - activeVariantCount,
    };
  }

  /** The list's filters without paging, as CSV text (UTF-8 with BOM), at most 10,000 rows */
  async exportCsv(query: ExportProductsReqDto): Promise<string> {
    const qb = (
      await this.filtered({
        q: query.q,
        status: query.status,
        categoryIds: await this.categoryTree(query.categoryId),
        brandId: query.brandId,
        channels: query.channel,
      })
    )
      .orderBy(SORT_COLUMNS[query.sort], query.order)
      .addOrderBy('v.id', 'ASC');
    if ((await qb.getCount()) > EXPORT_LIMIT) {
      throw badRequest(
        CatalogErrorCode.EXPORT_TOO_LARGE,
        `The export is limited to ${EXPORT_LIMIT} rows; narrow the filters`,
      );
    }
    const rows = await qb.limit(EXPORT_LIMIT).getMany();
    const view = await this.hydrate(rows);
    const header = [
      'name',
      'variantLabel',
      'skuCode',
      'barcode',
      'category',
      'brand',
      'baseUnit',
      'price',
      'avgCostPrice',
      'weight',
      'status',
      'channels',
    ];
    const lines = rows.map((variant) => {
      const row = view.row(variant);
      return [
        row.name,
        row.variantLabel,
        row.skuCode,
        row.barcode,
        row.category?.name,
        row.brand?.name,
        view.products.get(variant.productId)?.baseUnit,
        row.price,
        row.avgCostPrice,
        variant.weight,
        row.status,
        row.channels.join('|'),
      ]
        .map(csvCell)
        .join(',');
    });
    return `${CSV_BOM}${[header.join(','), ...lines].join('\r\n')}\r\n`;
  }

  /** Lookup for POS, manual orders and receipts: text search, an exact SKU or barcode, or a list of ids */
  async lookupVariants(
    query: ListVariantsReqDto,
  ): Promise<Page<VariantLookupRes>> {
    const qb = await this.filtered({
      q: query.q,
      status: query.status,
      categoryIds: await this.categoryTree(query.categoryId),
      barcode: query.barcode,
      sku: query.sku,
      ids: query.ids,
    });
    const [rows, total] = await qb
      .orderBy('p.name', 'ASC')
      .addOrderBy('v.skuCode', 'ASC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .getManyAndCount();
    const view = await this.hydrate(rows);
    return toPage(
      rows.map((row) => {
        const item = view.row(row);
        return {
          variantId: item.variantId,
          productId: item.productId,
          name: item.name,
          label: item.variantLabel,
          skuCode: item.skuCode,
          barcode: item.barcode,
          imageUrl: item.imageUrl,
          price: item.price,
          avgCostPrice: item.avgCostPrice,
          status: item.status,
          category: item.category,
        };
      }),
      total,
      query.page,
      query.limit,
    );
  }

  // ---- one product -----------------------------------------------------

  async get(id: string): Promise<ProductRes> {
    const product = await this.products.findOneBy({ id });
    if (!product) throw notFound('Product');
    return this.detail(product);
  }

  async create(dto: CreateProductReqDto): Promise<ProductRes> {
    await this.assertReferences(dto.categoryId, dto.brandId);
    const status = dto.status ?? 'active';
    const drafts = await this.draftsOf(dto, status);
    assertDistinct(drafts);

    const productId = await translateUnique(() =>
      this.dataSource.transaction(async (em) => {
        const repos = this.on(em);
        const product = await repos.products.save({
          id: randomUUID(),
          categoryId: dto.categoryId ?? null,
          brandId: dto.brandId ?? null,
          name: dto.name,
          description: dto.description ?? null,
          baseUnit: dto.baseUnit ?? 'Cái',
          isCombo: dto.isCombo ?? false,
          status,
        });
        await this.replaceImages(repos.images, product.id, dto.images ?? []);
        for (const draft of drafts) {
          const variant = await repos.variants.save(
            this.newVariant(product.id, draft),
          );
          await this.setChannels(
            repos.listings,
            [variant.id],
            draft.channels ?? dto.channels,
          );
        }
        return product.id;
      }),
    );
    return this.get(productId);
  }

  async update(id: string, dto: UpdateProductReqDto): Promise<ProductRes> {
    const product = await this.products.findOneBy({ id });
    if (!product) throw notFound('Product');
    await this.assertReferences(dto.categoryId, dto.brandId);

    await translateUnique(() =>
      this.dataSource.transaction(async (em) => {
        const repos = this.on(em);
        if (dto.name !== undefined) product.name = dto.name;
        if (dto.description !== undefined)
          product.description = dto.description;
        if (dto.categoryId !== undefined) product.categoryId = dto.categoryId;
        if (dto.brandId !== undefined) product.brandId = dto.brandId;
        if (dto.baseUnit !== undefined) product.baseUnit = dto.baseUnit;
        if (dto.status !== undefined) {
          product.status = dto.status;
          await repos.variants.update(
            { productId: id },
            { status: dto.status },
          );
        }
        await repos.products.save(product);
        if (dto.images) await this.replaceImages(repos.images, id, dto.images);
        if (dto.channels) {
          const ids = (
            await repos.variants.find({ where: { productId: id } })
          ).map((v) => v.id);
          await this.setChannels(repos.listings, ids, dto.channels);
        }
      }),
    );
    return this.get(id);
  }

  /** Soft delete: the product and its variants; their SKUs and barcodes become free again */
  async remove(id: string): Promise<void> {
    if (!(await this.products.exists({ where: { id } }))) {
      throw notFound('Product');
    }
    await this.dataSource.transaction(async (em) => {
      const repos = this.on(em);
      await repos.variants.softDelete({ productId: id });
      await repos.products.softDelete({ id });
    });
  }

  // ---- variants --------------------------------------------------------

  async addVariant(productId: string, dto: VariantReqDto): Promise<VariantRes> {
    const product = await this.products.findOneBy({ id: productId });
    if (!product) throw notFound('Product');
    const [draft] = await this.draftsFromRequests([dto], product.status, {
      price: 0,
    });
    const existing = await this.variants.find({ where: { productId } });
    if (existing.length >= MAX_VARIANTS) {
      throw badRequest(
        CatalogErrorCode.TOO_MANY_VARIANTS,
        `A product has at most ${MAX_VARIANTS} variants`,
      );
    }
    const key = combinationKey(draft.attributes);
    if (
      draft.attributes.length > 0 &&
      existing.some((v) => combinationKey(v.attributes) === key)
    ) {
      throw conflict(
        CatalogErrorCode.DUPLICATE_COMBINATION,
        'This attribute combination already exists on the product',
      );
    }
    const id = await translateUnique(() =>
      this.dataSource.transaction(async (em) => {
        const repos = this.on(em);
        const variant = await repos.variants.save(
          this.newVariant(productId, draft),
        );
        await this.setChannels(repos.listings, [variant.id], draft.channels);
        return variant.id;
      }),
    );
    return this.variantOf(id);
  }

  async updateVariant(
    id: string,
    dto: UpdateVariantReqDto,
  ): Promise<VariantRes> {
    const variant = await this.variants.findOneBy({ id });
    if (!variant) throw notFound('Variant');
    if (dto.skuCode !== undefined) variant.skuCode = dto.skuCode;
    if (dto.barcode !== undefined) variant.barcode = dto.barcode || null;
    if (dto.price !== undefined) variant.price = dto.price;
    if (dto.costPrice !== undefined) variant.avgCostPrice = dto.costPrice;
    if (dto.weight !== undefined) variant.weight = dto.weight;
    if (dto.status !== undefined) variant.status = dto.status;
    await translateUnique(() =>
      this.dataSource.transaction(async (em) => {
        const repos = this.on(em);
        await repos.variants.save(variant);
        if (dto.channels)
          await this.setChannels(repos.listings, [id], dto.channels);
      }),
    );
    return this.variantOf(id);
  }

  async removeVariant(id: string): Promise<void> {
    const variant = await this.variants.findOneBy({ id });
    if (!variant) throw notFound('Variant');
    const siblings = await this.variants.count({
      where: { productId: variant.productId },
    });
    if (siblings <= 1) {
      throw badRequest(
        CatalogErrorCode.INVALID_PRODUCT,
        'A product keeps at least one variant; delete the product instead',
      );
    }
    await this.variants.softDelete({ id });
  }

  // ---- internals -------------------------------------------------------

  private on(em: EntityManager) {
    return {
      products: this.products.withManager(em),
      variants: this.variants.withManager(em),
      images: this.images.withManager(em),
      listings: this.listings.withManager(em),
    };
  }

  /** Variants joined to their live product, with the list's filters applied */
  private async filtered(
    f: Filters,
  ): Promise<SelectQueryBuilder<ProductVariantEntity>> {
    const qb = this.variants
      .createQueryBuilder('v')
      .innerJoin(
        ProductEntity,
        'p',
        'p.id = v.productId AND p.deletedAt IS NULL',
      );
    if (f.q) {
      qb.andWhere(
        `(p.name ILIKE :q ESCAPE '\\' OR v.skuCode ILIKE :q ESCAPE '\\' OR v.barcode ILIKE :q ESCAPE '\\')`,
        { q: likePattern(f.q) },
      );
    }
    if (f.status) qb.andWhere('v.status = :status', { status: f.status });
    if (f.categoryIds) {
      qb.andWhere('p.categoryId IN (:...categoryIds)', {
        categoryIds: f.categoryIds,
      });
    }
    if (f.brandId) qb.andWhere('p.brandId = :brandId', { brandId: f.brandId });
    if (f.barcode) qb.andWhere('v.barcode = :barcode', { barcode: f.barcode });
    if (f.sku) qb.andWhere('v.skuCode = :sku', { sku: f.sku });
    if (f.ids) {
      // `IN ()` is a syntax error: an empty list matches nothing
      if (f.ids.length === 0) qb.andWhere('1 = 0');
      else qb.andWhere('v.id IN (:...ids)', { ids: f.ids });
    }
    if (f.channels?.length) {
      const listed = qb
        .subQuery()
        .select('l.variantId')
        .from(ProductChannelListingEntity, 'l')
        .where('l.isListed = true')
        .andWhere('l.channel IN (:...channels)')
        .getQuery();
      qb.andWhere(`v.id IN ${listed}`, { channels: f.channels });
    }
    return qb;
  }

  /** The category and everything below it; undefined when no category filter is set */
  private async categoryTree(id?: string): Promise<string[] | undefined> {
    if (!id) return undefined;
    const all = await this.categories.find({
      select: { id: true, parentId: true },
    });
    const ids = [id];
    for (let i = 0; i < ids.length; i++) {
      for (const category of all) {
        if (category.parentId === ids[i] && !ids.includes(category.id)) {
          ids.push(category.id);
        }
      }
    }
    return ids;
  }

  /** Loads what a page of variants shows (product, category, brand, cover, channels) in a few queries */
  private async hydrate(variants: ProductVariantEntity[]) {
    const productIds = [...new Set(variants.map((v) => v.productId))];
    const products = new Map<string, ProductEntity>();
    const categories = new Map<string, CategoryEntity>();
    const brands = new Map<string, BrandEntity>();
    const covers = new Map<string, string>();
    const channels = new Map<string, string[]>();
    if (variants.length > 0) {
      const prods = await this.products
        .createQueryBuilder('p')
        .where('p.id IN (:...productIds)', { productIds })
        .getMany();
      prods.forEach((p) => products.set(p.id, p));
      const categoryIds = [
        ...new Set(prods.map((p) => p.categoryId).filter(isString)),
      ];
      const brandIds = [
        ...new Set(prods.map((p) => p.brandId).filter(isString)),
      ];
      if (categoryIds.length) {
        (
          await this.categories
            .createQueryBuilder('c')
            .where('c.id IN (:...categoryIds)', { categoryIds })
            .getMany()
        ).forEach((c) => categories.set(c.id, c));
      }
      if (brandIds.length) {
        (
          await this.brands
            .createQueryBuilder('b')
            .where('b.id IN (:...brandIds)', { brandIds })
            .getMany()
        ).forEach((b) => brands.set(b.id, b));
      }
      (
        await this.images
          .createQueryBuilder('i')
          .where('i.productId IN (:...productIds) AND i.isCover = true', {
            productIds,
          })
          .getMany()
      ).forEach((i) => covers.set(i.productId, i.url));
      (
        await this.listings
          .createQueryBuilder('l')
          .where('l.variantId IN (:...ids) AND l.isListed = true', {
            ids: variants.map((v) => v.id),
          })
          .orderBy('l.channel', 'ASC')
          .getMany()
      ).forEach((l) =>
        channels.set(l.variantId, [
          ...(channels.get(l.variantId) ?? []),
          l.channel,
        ]),
      );
    }
    return {
      products,
      row: (v: ProductVariantEntity): ProductRowRes => {
        const p = products.get(v.productId)!;
        const category = p.categoryId
          ? categories.get(p.categoryId)
          : undefined;
        const brand = p.brandId ? brands.get(p.brandId) : undefined;
        return {
          productId: p.id,
          variantId: v.id,
          name: p.name,
          variantLabel: variantLabel(v.attributes),
          skuCode: v.skuCode,
          barcode: v.barcode,
          imageUrl: covers.get(p.id) ?? null,
          category: category ? { id: category.id, name: category.name } : null,
          brand: brand ? { id: brand.id, name: brand.name } : null,
          price: v.price,
          avgCostPrice: v.avgCostPrice,
          status: v.status,
          channels: channels.get(v.id) ?? [],
          hasMemberPrice: false,
        };
      },
    };
  }

  private async detail(product: ProductEntity): Promise<ProductRes> {
    const [variants, images, category, brand] = await Promise.all([
      this.variants.find({
        where: { productId: product.id },
        order: { createdAt: 'ASC', skuCode: 'ASC' },
      }),
      this.images.find({
        where: { productId: product.id },
        order: { sortOrder: 'ASC' },
      }),
      product.categoryId
        ? this.categories.findOneBy({ id: product.categoryId })
        : null,
      product.brandId ? this.brands.findOneBy({ id: product.brandId }) : null,
    ]);
    const channels = await this.channelsOf(variants.map((v) => v.id));
    const axes = new Map<string, string[]>();
    for (const variant of variants) {
      for (const { name, value } of variant.attributes) {
        const values = axes.get(name) ?? [];
        if (!values.includes(value)) values.push(value);
        axes.set(name, values);
      }
    }
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      baseUnit: product.baseUnit,
      status: product.status,
      isCombo: product.isCombo,
      category: category ? { id: category.id, name: category.name } : null,
      brand: brand ? { id: brand.id, name: brand.name } : null,
      attributes: [...axes].map(([name, values]) => ({ name, values })),
      images: images.map((i) => ({
        id: i.id,
        url: i.url,
        isCover: i.isCover,
        sortOrder: i.sortOrder,
      })),
      variants: variants.map((v) => toVariantRes(v, channels.get(v.id) ?? [])),
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  private async variantOf(id: string): Promise<VariantRes> {
    const variant = await this.variants.findOneBy({ id });
    if (!variant) throw notFound('Variant');
    return toVariantRes(variant, (await this.channelsOf([id])).get(id) ?? []);
  }

  private async channelsOf(
    variantIds: string[],
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (variantIds.length === 0) return map;
    const rows = await this.listings
      .createQueryBuilder('l')
      .where('l.variantId IN (:...variantIds) AND l.isListed = true', {
        variantIds,
      })
      .orderBy('l.channel', 'ASC')
      .getMany();
    for (const row of rows) {
      map.set(row.variantId, [...(map.get(row.variantId) ?? []), row.channel]);
    }
    return map;
  }

  private newVariant(productId: string, draft: Draft) {
    return {
      id: randomUUID(),
      productId,
      skuCode: draft.skuCode,
      barcode: draft.barcode,
      price: draft.price,
      avgCostPrice: draft.costPrice,
      weight: draft.weight,
      status: draft.status,
      attributes: draft.attributes,
    };
  }

  /** Listed on exactly these channels: others the variants had are switched off. `undefined` leaves them be. */
  private async setChannels(
    listings: TenantScopedRepository<ProductChannelListingEntity>,
    variantIds: string[],
    channels: string[] | undefined,
  ): Promise<void> {
    if (!channels || variantIds.length === 0) return;
    const wanted = new Set(channels);
    const existing = await listings.find({
      where: variantIds.map((variantId) => ({ variantId })),
    });
    for (const variantId of variantIds) {
      const mine = existing.filter((row) => row.variantId === variantId);
      for (const row of mine) {
        if (row.isListed !== wanted.has(row.channel)) {
          row.isListed = wanted.has(row.channel);
          await listings.save(row);
        }
      }
      for (const channel of wanted) {
        if (!mine.some((row) => row.channel === channel)) {
          await listings.save({
            id: randomUUID(),
            variantId,
            channel,
            isListed: true,
          });
        }
      }
    }
  }

  private async replaceImages(
    images: TenantScopedRepository<ProductImageEntity>,
    productId: string,
    urls: { url: string }[],
  ): Promise<void> {
    await images.delete({ productId });
    for (const [index, image] of urls.entries()) {
      await images.save({
        id: randomUUID(),
        productId,
        variantId: null,
        url: image.url,
        sortOrder: index,
        isCover: index === 0,
      });
    }
  }

  private async assertReferences(
    categoryId?: string | null,
    brandId?: string | null,
  ): Promise<void> {
    if (
      categoryId &&
      !(await this.categories.exists({ where: { id: categoryId } }))
    ) {
      throw badRequest(CatalogErrorCode.UNKNOWN_REFERENCE, 'Unknown category');
    }
    if (brandId && !(await this.brands.exists({ where: { id: brandId } }))) {
      throw badRequest(CatalogErrorCode.UNKNOWN_REFERENCE, 'Unknown brand');
    }
  }

  /** The variants a create request means: generated from the axes, sent by the client, or one default */
  private async draftsOf(
    dto: CreateProductReqDto,
    status: ProductStatus,
  ): Promise<Draft[]> {
    const defaults = {
      price: dto.price ?? 0,
      costPrice: dto.costPrice ?? null,
      weight: dto.weight ?? null,
    };
    if (dto.generateVariants) {
      if (!dto.baseSku || !dto.attributes?.length) {
        throw badRequest(
          CatalogErrorCode.INVALID_PRODUCT,
          'generateVariants needs baseSku and at least one attribute',
        );
      }
      const axes = await this.axesOf(dto.attributes);
      try {
        return generateVariants(dto.baseSku, axes).map((g) => ({
          ...defaults,
          barcode: null,
          status,
          skuCode: g.skuCode,
          attributes: g.attributes,
        }));
      } catch (error) {
        if (error instanceof TooManyVariantsError) {
          throw badRequest(
            CatalogErrorCode.TOO_MANY_VARIANTS,
            `A product has at most ${MAX_VARIANTS} variants`,
          );
        }
        throw error;
      }
    }
    if (dto.variants?.length) {
      if (dto.variants.length > MAX_VARIANTS) {
        throw badRequest(
          CatalogErrorCode.TOO_MANY_VARIANTS,
          `A product has at most ${MAX_VARIANTS} variants`,
        );
      }
      return this.draftsFromRequests(dto.variants, status, defaults);
    }
    if (!dto.baseSku) {
      throw badRequest(
        CatalogErrorCode.INVALID_PRODUCT,
        'Send variants, or baseSku for a product with a single variant',
      );
    }
    return [
      {
        ...defaults,
        skuCode: dto.baseSku,
        barcode: dto.barcode || null,
        status,
        attributes: [],
      },
    ];
  }

  private async draftsFromRequests(
    requests: VariantReqDto[],
    status: ProductStatus,
    defaults: {
      price: number;
      costPrice?: number | null;
      weight?: number | null;
    },
  ): Promise<Draft[]> {
    const valueIds = [
      ...new Set(requests.flatMap((r) => r.attributeValueIds ?? [])),
    ];
    const resolved = await this.resolveValues(valueIds);
    return requests.map((r) => ({
      skuCode: r.skuCode,
      barcode: r.barcode || null,
      price: r.price ?? defaults.price,
      costPrice:
        r.costPrice === undefined ? (defaults.costPrice ?? null) : r.costPrice,
      weight: r.weight === undefined ? (defaults.weight ?? null) : r.weight,
      status: r.status ?? status,
      attributes: [
        ...(r.attributeValueIds ?? []).map((id) => resolved.get(id)!),
        ...(r.attributes ?? []).map((a) => ({ name: a.name, value: a.value })),
      ],
      channels: r.channels,
    }));
  }

  private async resolveValues(
    ids: string[],
  ): Promise<Map<string, VariantAttribute>> {
    const map = new Map<string, VariantAttribute>();
    if (ids.length === 0) return map;
    const values = await this.attributeValues
      .createQueryBuilder('v')
      .where('v.id IN (:...ids)', { ids })
      .getMany();
    const attributes = await this.attributes
      .createQueryBuilder('a')
      .where('a.id IN (:...ids)', {
        ids: [...new Set(values.map((v) => v.attributeId))],
      })
      .getMany();
    for (const value of values) {
      const attribute = attributes.find((a) => a.id === value.attributeId);
      if (attribute)
        map.set(value.id, { name: attribute.name, value: value.value });
    }
    if (ids.some((id) => !map.has(id))) {
      throw badRequest(
        CatalogErrorCode.UNKNOWN_REFERENCE,
        'Unknown attribute value',
      );
    }
    return map;
  }

  private async axesOf(
    axes: { attributeId: string; valueIds: string[] }[],
  ): Promise<Axis[]> {
    const result: Axis[] = [];
    for (const axis of axes) {
      const attribute = await this.attributes.findOneBy({
        id: axis.attributeId,
      });
      const values = await this.attributeValues
        .createQueryBuilder('v')
        .where('v.attributeId = :id AND v.id IN (:...ids)', {
          id: axis.attributeId,
          ids: axis.valueIds,
        })
        .getMany();
      const unique = [...new Set(axis.valueIds)];
      if (!attribute || values.length !== unique.length) {
        throw badRequest(
          CatalogErrorCode.UNKNOWN_REFERENCE,
          'Unknown attribute or attribute value',
        );
      }
      result.push({
        attributeName: attribute.name,
        // keep the order the client chose
        values: unique.map((id) => values.find((v) => v.id === id)!),
      });
    }
    return result;
  }
}

/** The same SKU, barcode or attribute combination twice inside one request */
function assertDistinct(drafts: Draft[]): void {
  const skus = new Set<string>();
  const barcodes = new Set<string>();
  const combos = new Set<string>();
  for (const draft of drafts) {
    const sku = draft.skuCode;
    if (skus.has(sku)) {
      throw conflict(
        CatalogErrorCode.DUPLICATE_SKU,
        `SKU ${draft.skuCode} appears twice`,
      );
    }
    skus.add(sku);
    if (draft.barcode) {
      if (barcodes.has(draft.barcode)) {
        throw conflict(
          CatalogErrorCode.DUPLICATE_BARCODE,
          `Barcode ${draft.barcode} appears twice`,
        );
      }
      barcodes.add(draft.barcode);
    }
    if (draft.attributes.length > 0) {
      const key = combinationKey(draft.attributes);
      if (combos.has(key)) {
        throw conflict(
          CatalogErrorCode.DUPLICATE_COMBINATION,
          'Two variants have the same attribute combination',
        );
      }
      combos.add(key);
    }
  }
}

const isString = (value: string | null): value is string => value !== null;

function toVariantRes(v: ProductVariantEntity, channels: string[]): VariantRes {
  return {
    id: v.id,
    productId: v.productId,
    skuCode: v.skuCode,
    barcode: v.barcode,
    label: variantLabel(v.attributes),
    attributes: v.attributes,
    price: v.price,
    avgCostPrice: v.avgCostPrice,
    weight: v.weight,
    status: v.status,
    channels,
  };
}

/**
 * One CSV cell. A text cell that starts with `=`, `+`, `-`, `@`, tab or CR would run as a
 * formula in a spreadsheet, so it gets a leading quote; numbers are written as they are.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
