import { Injectable } from '@nestjs/common';
import { TenantScopedRepository, runInTenantTransaction } from '@pbl/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import {
  CatalogDomainError,
  CatalogErrorCode,
} from '../../domain/catalog-domain';
import {
  AttributeEntity,
  AttributeValueEntity,
  ProductAttributeEntity,
  ProductEntity,
  ProductVariantEntity,
  VariantAttributeValueEntity,
} from '../../infrastructure/persistence/catalog.entities';
import { toCatalogHttpException } from '../../presentation/catalog-http-error';
import {
  ProductAttributeRes,
  ProductAttributesRes,
} from './product-attributes.dto';

/**
 * Attributes and their values are shared by the whole store; a product only uses some of them. This file keeps that
 * rule in one place: the helpers below are called inside the transactions of ProductsService, and
 * ProductAttributesService serves `GET/PUT /products/:id/attributes`.
 */

/** Checks that every attribute exists in this store, and returns them */
async function loadAttributes(
  em: EntityManager,
  attributeIds: string[],
): Promise<AttributeEntity[]> {
  const unique = [...new Set(attributeIds)];
  if (unique.length === 0) return [];
  const found = await TenantScopedRepository.forEntity(
    em,
    AttributeEntity,
  ).find({ where: { id: In(unique) } });
  const known = new Set(found.map((a) => a.id));
  const missing = unique.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new CatalogDomainError(
      CatalogErrorCode.ATTRIBUTE_NOT_FOUND,
      `Attribute ${missing[0]} not found in this tenant`,
      'NOT_FOUND',
      { attributeIds: missing },
    );
  }
  return found;
}

/** Gives a new product its attributes, in the order given (used by `POST /products`) */
export async function enableAttributesForNewProduct(
  em: EntityManager,
  productId: string,
  attributeIds: string[] | undefined,
): Promise<void> {
  if (!attributeIds || attributeIds.length === 0) return;
  assertNoDuplicates(attributeIds);
  await loadAttributes(em, attributeIds);
  await TenantScopedRepository.forEntity(em, ProductAttributeEntity).save(
    attributeIds.map((attributeId, position) => ({
      productId,
      attributeId,
      position,
    })),
  );
}

/** A variant may only carry attributes its product has enabled (400 otherwise) */
export async function assertAttributesEnabledForProduct(
  em: EntityManager,
  productId: string,
  attributeIds: string[],
): Promise<void> {
  if (attributeIds.length === 0) return;
  const enabled = await TenantScopedRepository.forEntity(
    em,
    ProductAttributeEntity,
  ).find({ where: { productId } });
  const enabledIds = new Set(enabled.map((e) => e.attributeId));
  const missing = [...new Set(attributeIds)].filter(
    (id) => !enabledIds.has(id),
  );
  if (missing.length > 0) {
    throw new CatalogDomainError(
      CatalogErrorCode.ATTRIBUTE_NOT_ENABLED_FOR_PRODUCT,
      'The product does not use this attribute: add it with PUT /products/:id/attributes first',
      'BAD_REQUEST',
      { attributeIds: missing },
    );
  }
}

function assertNoDuplicates(attributeIds: string[]): void {
  if (new Set(attributeIds).size !== attributeIds.length) {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_VARIANT_COMBINATION,
      'The same attribute was listed twice',
      'BAD_REQUEST',
    );
  }
}

@Injectable()
export class ProductAttributesService {
  constructor(private readonly dataSource: DataSource) {}

  /** The attributes of the product, each with every value of the store and how many variants of this product use it */
  async list(productId: string): Promise<ProductAttributesRes> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) => {
        await this.requireProduct(em, productId);
        return this.load(em, productId);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  /**
   * Replaces the attributes of the product. An attribute can only be removed when none of the product's variants
   * carries a value of it (409), so no variant ever ends up with an attribute the product does not use.
   */
  async replace(
    productId: string,
    attributeIds: string[],
  ): Promise<ProductAttributesRes> {
    try {
      return await runInTenantTransaction(this.dataSource, async (em) => {
        await this.requireProduct(em, productId);
        assertNoDuplicates(attributeIds);
        await loadAttributes(em, attributeIds);

        const repo = TenantScopedRepository.forEntity(
          em,
          ProductAttributeEntity,
        );
        const current = await repo.find({ where: { productId } });
        const wanted = new Set(attributeIds);
        const removed = current.filter((c) => !wanted.has(c.attributeId));

        if (removed.length > 0) {
          const inUse = await this.attributesInUse(
            em,
            productId,
            removed.map((r) => r.attributeId),
          );
          if (inUse.length > 0) {
            throw new CatalogDomainError(
              CatalogErrorCode.ATTRIBUTE_IN_USE_BY_PRODUCT,
              'A variant of this product still carries a value of this attribute',
              'CONFLICT',
              { attributeIds: inUse },
            );
          }
          await repo.delete({
            productId,
            attributeId: In(removed.map((r) => r.attributeId)),
          });
        }

        const byAttribute = new Map(current.map((c) => [c.attributeId, c]));
        for (const [position, attributeId] of attributeIds.entries()) {
          const existing = byAttribute.get(attributeId);
          if (!existing) {
            await repo.save({ productId, attributeId, position });
          } else if (existing.position !== position) {
            await repo.update({ id: existing.id }, { position });
          }
        }
        return this.load(em, productId);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  private async requireProduct(
    em: EntityManager,
    productId: string,
  ): Promise<void> {
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
  }

  /** The attributes among `attributeIds` that a live variant of the product carries */
  private async attributesInUse(
    em: EntityManager,
    productId: string,
    attributeIds: string[],
  ): Promise<string[]> {
    const variants = await TenantScopedRepository.forEntity(
      em,
      ProductVariantEntity,
    ).find({ where: { productId, deletedAt: IsNull() } });
    if (variants.length === 0) return [];
    const links = await TenantScopedRepository.forEntity(
      em,
      VariantAttributeValueEntity,
    ).find({
      where: {
        variantId: In(variants.map((v) => v.id)),
        attributeId: In(attributeIds),
      },
    });
    return [...new Set(links.map((l) => l.attributeId))];
  }

  private async load(
    em: EntityManager,
    productId: string,
  ): Promise<ProductAttributesRes> {
    const enabled = await TenantScopedRepository.forEntity(
      em,
      ProductAttributeEntity,
    ).find({ where: { productId }, order: { position: 'ASC' } });
    if (enabled.length === 0) return { productId, attributes: [] };

    const attributeIds = enabled.map((e) => e.attributeId);
    const [attributes, values, variants] = await Promise.all([
      TenantScopedRepository.forEntity(em, AttributeEntity).find({
        where: { id: In(attributeIds) },
      }),
      TenantScopedRepository.forEntity(em, AttributeValueEntity).find({
        where: { attributeId: In(attributeIds) },
        order: { value: 'ASC' },
      }),
      TenantScopedRepository.forEntity(em, ProductVariantEntity).find({
        where: { productId, deletedAt: IsNull() },
      }),
    ]);
    const links = variants.length
      ? await TenantScopedRepository.forEntity(
          em,
          VariantAttributeValueEntity,
        ).find({ where: { variantId: In(variants.map((v) => v.id)) } })
      : [];
    const usedBy = new Map<string, number>();
    for (const link of links) {
      usedBy.set(
        link.attributeValueId,
        (usedBy.get(link.attributeValueId) ?? 0) + 1,
      );
    }

    const attributeById = new Map(attributes.map((a) => [a.id, a]));
    return {
      productId,
      attributes: enabled.flatMap((e): ProductAttributeRes[] => {
        const attribute = attributeById.get(e.attributeId);
        if (!attribute) return [];
        return [
          {
            attributeId: attribute.id,
            name: attribute.name,
            position: e.position,
            values: values
              .filter((v) => v.attributeId === attribute.id)
              .map((v) => ({
                id: v.id,
                value: v.value,
                usedByVariants: usedBy.get(v.id) ?? 0,
              })),
          },
        ];
      }),
    };
  }
}
