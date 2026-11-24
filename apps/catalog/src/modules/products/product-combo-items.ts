import { Injectable } from '@nestjs/common';
import { TenantScopedRepository, runInTenantTransaction } from '@pbl/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import {
  CatalogDomainError,
  CatalogErrorCode,
} from '../../domain/catalog-domain';
import {
  ComboItemEntity,
  ProductEntity,
  ProductVariantEntity,
} from '../../infrastructure/persistence/catalog.entities';
import { toCatalogHttpException } from '../../presentation/catalog-http-error';
import {
  ComboItemInputDto,
  ComboItemRes,
  MAX_COMBO_ITEMS,
  MAX_COMBO_ITEM_QUANTITY,
} from './product-combo-items.dto';

/**
 * Components of a combo product. A combo is a product with `isCombo = true`; its price lives on its own variant and
 * `combo_items.combo_variant_id` points at that variant (the default one, or the first live variant). Components are
 * single variants of the same store: never the combo itself, never another combo. The helpers below run inside the
 * transactions of ProductsService (`POST /products` with `comboItems`); ProductComboItemsService serves
 * `GET/PUT /products/:id/combo-items`.
 */

async function liveVariantsOf(
  em: EntityManager,
  productId: string,
): Promise<ProductVariantEntity[]> {
  return TenantScopedRepository.forEntity(em, ProductVariantEntity).find({
    where: { productId, deletedAt: IsNull() },
    order: { isDefault: 'DESC', skuCode: 'ASC' },
  });
}

async function toRes(
  em: EntityManager,
  productId: string,
  rows: ComboItemEntity[],
): Promise<ComboItemRes[]> {
  if (rows.length === 0) return [];
  const children = await TenantScopedRepository.forEntity(
    em,
    ProductVariantEntity,
  ).find({
    where: {
      id: In(rows.map((r) => r.childVariantId)),
      deletedAt: IsNull(),
    },
  });
  const byId = new Map(children.map((c) => [c.id, c]));
  return [...rows]
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        (byId.get(a.childVariantId)?.skuCode ?? '').localeCompare(
          byId.get(b.childVariantId)?.skuCode ?? '',
        ),
    )
    .flatMap((row) => {
      const child = byId.get(row.childVariantId);
      if (!child) return [];
      return [
        {
          id: row.id,
          comboProductId: productId,
          childVariantId: child.id,
          childProductId: child.productId,
          skuCode: child.skuCode,
          variantName: child.name,
          basePrice: child.basePrice,
          imageUrl: child.imageUrl,
          quantity: row.quantity,
          lineTotal: child.basePrice * row.quantity,
          sortOrder: row.sortOrder,
        },
      ];
    });
}

/** Components of the product (every live variant of it), in display order; empty for a product that is not a combo */
export async function listComboItems(
  em: EntityManager,
  product: ProductEntity,
): Promise<ComboItemRes[]> {
  if (!product.isCombo) return [];
  const variants = await liveVariantsOf(em, product.id);
  if (variants.length === 0) return [];
  const rows = await TenantScopedRepository.forEntity(em, ComboItemEntity).find(
    { where: { comboVariantId: In(variants.map((v) => v.id)) } },
  );
  return toRes(em, product.id, rows);
}

function invalid(
  code: (typeof CatalogErrorCode)[keyof typeof CatalogErrorCode],
  message: string,
  details?: unknown,
): CatalogDomainError {
  return new CatalogDomainError(code, message, 'UNPROCESSABLE', details);
}

/**
 * Replaces the whole component list of a combo, all or nothing. Calling it again with the same list changes nothing
 * (rows are rewritten, ids are new). Tenant isolation: every read goes through the tenant-scoped repositories, so a
 * variant of another store is simply "not found".
 */
export async function replaceComboItems(
  em: EntityManager,
  product: ProductEntity,
  items: ComboItemInputDto[],
): Promise<ComboItemRes[]> {
  if (!product.isCombo) {
    throw invalid(
      CatalogErrorCode.PRODUCT_NOT_COMBO,
      'Only a combo product has components',
    );
  }
  if (items.length < 1 || items.length > MAX_COMBO_ITEMS) {
    throw invalid(
      CatalogErrorCode.INVALID_PRODUCT_LIFECYCLE,
      `A combo needs between 1 and ${MAX_COMBO_ITEMS} components`,
    );
  }
  for (const item of items) {
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_COMBO_ITEM_QUANTITY
    ) {
      throw invalid(
        CatalogErrorCode.INVALID_PRODUCT_LIFECYCLE,
        `Quantity must be a whole number between 1 and ${MAX_COMBO_ITEM_QUANTITY}`,
        { childVariantId: item.childVariantId },
      );
    }
  }
  const ids = items.map((i) => i.childVariantId);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw invalid(
      CatalogErrorCode.COMBO_DUPLICATE_ITEM,
      'The same variant is listed twice: raise its quantity instead',
      { childVariantIds: [...new Set(duplicates)] },
    );
  }

  const ownVariants = await liveVariantsOf(em, product.id);
  if (ownVariants.length === 0) {
    throw invalid(
      CatalogErrorCode.COMBO_VARIANT_REQUIRED,
      'Give the combo a variant (its sellable SKU and price) before adding components',
    );
  }
  const ownIds = new Set(ownVariants.map((v) => v.id));
  if (ids.some((id) => ownIds.has(id))) {
    throw invalid(
      CatalogErrorCode.COMBO_SELF_REFERENCE,
      'A combo cannot contain itself',
    );
  }

  const children = await TenantScopedRepository.forEntity(
    em,
    ProductVariantEntity,
  ).find({ where: { id: In(ids), deletedAt: IsNull() } });
  const products = children.length
    ? await TenantScopedRepository.forEntity(em, ProductEntity).find({
        where: {
          id: In([...new Set(children.map((c) => c.productId))]),
          deletedAt: IsNull(),
        },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const usable = new Map(
    children
      .filter((c) => c.status !== 'ARCHIVED' && productById.has(c.productId))
      .map((c) => [c.id, c]),
  );
  const missing = ids.filter((id) => !usable.has(id));
  if (missing.length > 0) {
    throw new CatalogDomainError(
      CatalogErrorCode.VARIANT_NOT_FOUND,
      `Variant ${missing[0]} not found in this tenant`,
      'NOT_FOUND',
      { variantIds: missing },
    );
  }
  const nested = ids.filter((id) => {
    const child = usable.get(id) as ProductVariantEntity;
    return (productById.get(child.productId) as ProductEntity).isCombo;
  });
  if (nested.length > 0) {
    throw invalid(
      CatalogErrorCode.COMBO_NESTING_NOT_ALLOWED,
      'A component cannot be a combo: combos do not nest',
      { variantIds: nested },
    );
  }

  const repo = TenantScopedRepository.forEntity(em, ComboItemEntity);
  await repo.delete({ comboVariantId: In([...ownIds]) });
  const primary = ownVariants[0];
  const rows = await repo.save(
    items.map((item, sortOrder) => ({
      comboVariantId: primary.id,
      childVariantId: item.childVariantId,
      quantity: item.quantity,
      sortOrder,
    })),
  );
  return toRes(em, product.id, rows);
}

@Injectable()
export class ProductComboItemsService {
  constructor(private readonly dataSource: DataSource) {}

  /** 404 when the product is not in the tenant; `[]` for a product that is not a combo or has no components yet */
  async list(productId: string): Promise<ComboItemRes[]> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) =>
        listComboItems(em, await this.requireProduct(em, productId)),
      );
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async replace(
    productId: string,
    items: ComboItemInputDto[],
  ): Promise<ComboItemRes[]> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) =>
        replaceComboItems(em, await this.requireProduct(em, productId), items),
      );
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  private async requireProduct(
    em: EntityManager,
    productId: string,
  ): Promise<ProductEntity> {
    const product = await TenantScopedRepository.forEntity(
      em,
      ProductEntity,
    ).findOne({ where: { id: productId, deletedAt: IsNull() } });
    if (!product) {
      throw new CatalogDomainError(
        CatalogErrorCode.PRODUCT_NOT_FOUND,
        'Product not found',
        'NOT_FOUND',
      );
    }
    return product;
  }
}
