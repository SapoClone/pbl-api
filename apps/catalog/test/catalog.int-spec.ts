import { CreateTenantPlanQuota1792800000000 } from '../src/migrations/1792800000000-create-tenant-plan-quota';
import { CreateProductAttributes1793400000000 } from '../src/migrations/1793400000000-create-product-attributes';
import { PlanQuotaService } from '../src/quota/plan-quota.service';
/**
 * Real PostgreSQL Integration, Concurrency, Row-Level Security (non-superuser role),
 * Outbox Event, and End-to-End Business Demo Test Suite for M1 Catalog Core.
 *
 * Run with: `pnpm test:int` or `npx jest --config libs/events/test/jest-int.json apps/catalog/test/catalog.int-spec.ts`
 */
import { HttpException } from '@nestjs/common';
import {
  RequestContext,
  runInTenantTransaction,
  TenantScopedRepository,
} from '@pbl/common';
import {
  CATALOG_PRICE_CHANGED,
  CATALOG_PRODUCT_CREATED,
  CATALOG_PRODUCT_UPDATED,
  CATALOG_VARIANT_CREATED,
  CATALOG_VARIANT_DEACTIVATED,
} from '@pbl/contracts';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  databaseOptions,
  EventOutbox,
  initializeDatabase,
  OutboxEventEntity,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  provisionServiceRole,
} from '@pbl/events';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import {
  CatalogDomainError,
  CatalogErrorCode,
} from '../src/domain/catalog-domain';
import {
  AttributeEntity,
  AttributeValueEntity,
  BrandEntity,
  CATALOG_ENTITIES,
  CategoryEntity,
  PriceListEntity,
  ProductEntity,
  ProductVariantEntity,
  UnitConversionEntity,
} from '../src/infrastructure/persistence/catalog.entities';
import { CreateCatalogTables1791900000200 } from '../src/migrations/1791900000200-create-catalog-tables';
import { AttributesService } from '../src/modules/attributes/attributes.service';
import { BrandsService } from '../src/modules/brands/brands.service';
import { CategoriesService } from '../src/modules/categories/categories.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { ProductsService } from '../src/modules/products/products.service';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // Fashion Store A
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // Fashion Store B

function expectCatalogError(err: unknown, status: number, errorCode: string) {
  expect(err).toBeInstanceOf(HttpException);
  const httpErr = err as HttpException;
  expect(httpErr.getStatus()).toBe(status);
  const body = httpErr.getResponse() as Record<string, unknown>;
  expect(body.errorCode).toBe(errorCode);
}

describe('Catalog M1 Microservice (Real PostgreSQL + Non-Superuser RLS + Concurrency + Demo)', () => {
  const schema = uniqueSchema('catalog_it');
  const catalogAppRole = `${schema}_app`;

  let adminDs: DataSource;
  let appDs: DataSource;

  let categoriesService: CategoriesService;
  let brandsService: BrandsService;
  let attributesService: AttributesService;
  let productsService: ProductsService;
  let pricingService: PricingService;

  const asTenant = <T>(tenantId: string, work: () => Promise<T>): Promise<T> =>
    RequestContext.run(
      { tenantId, requestId: `req-${tenantId.slice(0, 8)}` },
      work,
    );

  beforeAll(async () => {
    useDatabase(schema);
    adminDs = await initializeDatabase(
      databaseOptions({
        entities: [
          ...CATALOG_ENTITIES,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateCatalogTables1791900000200,
          CreateTenantPlanQuota1792800000000,
          CreateProductAttributes1793400000000,
        ],
      }),
    );

    // Provision a non-superuser runtime role (`NOSUPERUSER NOBYPASSRLS`) to prove
    // PostgreSQL FORCE ROW LEVEL SECURITY is genuinely enforced on every query.
    await provisionServiceRole(adminDs, schema, catalogAppRole);

    appDs = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      username: catalogAppRole,
      password: catalogAppRole,
      database: 'pbl',
      schema,
      entities: [
        ...CATALOG_ENTITIES,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
    });
    await appDs.initialize();

    const outbox = new EventOutbox();
    categoriesService = new CategoriesService(
      appDs,
      TenantScopedRepository.forEntity(appDs, CategoryEntity),
    );
    brandsService = new BrandsService(
      TenantScopedRepository.forEntity(appDs, BrandEntity),
    );
    attributesService = new AttributesService(
      TenantScopedRepository.forEntity(appDs, AttributeEntity),
      TenantScopedRepository.forEntity(appDs, AttributeValueEntity),
    );
    productsService = new ProductsService(
      appDs,
      outbox,
      TenantScopedRepository.forEntity(appDs, ProductEntity),
      TenantScopedRepository.forEntity(appDs, ProductVariantEntity),
      TenantScopedRepository.forEntity(appDs, UnitConversionEntity),
      new PlanQuotaService(outbox),
    );
    pricingService = new PricingService(
      appDs,
      outbox,
      TenantScopedRepository.forEntity(appDs, PriceListEntity),
    );
  });

  afterAll(async () => {
    await appDs?.destroy();
    await adminDs?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminDs?.query(`DROP ROLE IF EXISTS "${catalogAppRole}"`);
    await adminDs?.destroy();
  });

  it('creates all 17 Catalog domain tables with RLS enabled and forced', async () => {
    const rlsRows: {
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }[] = await adminDs.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1
           AND c.relkind = 'r'
           AND c.relname NOT IN ('migrations', 'outbox_event', 'inbox_event')
         ORDER BY c.relname`,
      [schema],
    );

    expect(rlsRows.map((r) => r.relname)).toEqual([
      'attribute_values',
      'attributes',
      'brands',
      'categories',
      'combo_items',
      'price_list_channels',
      'price_list_customer_groups',
      'price_list_items',
      'price_lists',
      'product_attributes',
      'product_imports',
      'product_variants',
      'products',
      'tenant_plan_quota',
      'unit_conversions',
      'uploads',
      'variant_attribute_values',
    ]);
    for (const row of rlsRows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  describe('Section 15 — End-to-End Business Demo & Multi-Tenant Isolation', () => {
    let clothingCatId: string;
    let tshirtsCatId: string;
    let brandId: string;
    let colorAttrId: string;
    let blackValId: string;
    let whiteValId: string;
    let sizeAttrId: string;
    let sizeMValId: string;
    let sizeLValId: string;
    let productId: string;
    let variantIdsBySku: Record<string, string> = {};
    let defaultPriceListId: string;

    it('Step 1: Tenant A creates category hierarchy Clothing -> T-Shirts and retrieves tree', async () => {
      await asTenant(TENANT_A, async () => {
        const clothing = await categoriesService.create({
          name: 'Clothing',
        });
        expect(clothing.depth).toBe(1);
        expect(clothing.slug).toBe('clothing');
        clothingCatId = clothing.id;

        const tshirts = await categoriesService.create({
          name: 'T-Shirts',
          parentId: clothing.id,
        });
        expect(tshirts.depth).toBe(2);
        expect(tshirts.parentId).toBe(clothing.id);
        tshirtsCatId = tshirts.id;

        const tree = await categoriesService.getTree();
        expect(tree).toHaveLength(1);
        expect(tree[0].name).toBe('Clothing');
        expect(tree[0].children).toHaveLength(1);
        expect(tree[0].children[0].name).toBe('T-Shirts');
      });
    });

    it('Step 2: Tenant A creates Brand "Local Basic" and Attributes Color (Black, White) & Size (M, L)', async () => {
      await asTenant(TENANT_A, async () => {
        const brand = await brandsService.create({
          name: 'Local Basic',
          description: 'Everyday Vietnamese essentials',
        });
        brandId = brand.id;

        const color = await attributesService.createAttribute({
          name: 'Color',
        });
        colorAttrId = color.id;
        const black = await attributesService.createValue(color.id, {
          value: 'Black',
        });
        const white = await attributesService.createValue(color.id, {
          value: 'White',
        });
        blackValId = black.id;
        whiteValId = white.id;

        const size = await attributesService.createAttribute({ name: 'Size' });
        sizeAttrId = size.id;
        const sizeM = await attributesService.createValue(size.id, {
          value: 'M',
        });
        const sizeL = await attributesService.createValue(size.id, {
          value: 'L',
        });
        sizeMValId = sizeM.id;
        sizeLValId = sizeL.id;

        const allAttrs = await attributesService.listAttributes();
        expect(allAttrs).toHaveLength(2);
      });
    });

    it('Step 3: Tenant A creates Product "Áo thun cotton nam" and generates 4 Cartesian variants', async () => {
      await asTenant(TENANT_A, async () => {
        const product = await productsService.createProduct({
          name: 'Áo thun cotton nam',
          description: '100% compact cotton 250gsm',
          categoryId: tshirtsCatId,
          brandId,
          baseUnit: 'Cái',
          status: 'ACTIVE',
          createDefaultVariant: false,
          attributeIds: [colorAttrId, sizeAttrId],
        });
        productId = product.id;
        expect(product.status).toBe('ACTIVE');
        expect(product.unitConversions).toHaveLength(1);
        expect(product.unitConversions?.[0].unitName).toBe('Cái');
        expect(product.unitConversions?.[0].isBase).toBe(true);

        // Add packaging unit conversion: Thùng = 24 Cái
        const boxUnit = await productsService.addUnitConversion(productId, {
          unitName: 'Thùng',
          conversionFactor: '24',
        });
        expect(boxUnit.conversionFactor).toBe('24.0000');

        const generated = await productsService.generateVariants(productId, {
          skuPrefix: 'TSHIRT',
          basePrice: 199000,
          axes: [
            {
              attributeId: colorAttrId,
              valueIds: [blackValId, whiteValId],
            },
            {
              attributeId: sizeAttrId,
              valueIds: [sizeMValId, sizeLValId],
            },
          ],
          skuTokens: { Black: 'BLK', White: 'WHT', M: 'M', L: 'L' },
        });

        expect(generated).toHaveLength(4);
        expect(generated.map((v) => v.skuCode)).toEqual([
          'TSHIRT-BLK-M',
          'TSHIRT-BLK-L',
          'TSHIRT-WHT-M',
          'TSHIRT-WHT-L',
        ]);
        variantIdsBySku = Object.fromEntries(
          generated.map((v) => [v.skuCode, v.id]),
        );

        // Assign valid EAN-13 barcode to TSHIRT-BLK-M
        const updatedBlkM = await productsService.updateVariant(
          variantIdsBySku['TSHIRT-BLK-M'],
          { barcode: '8934563123451' },
        );
        expect(updatedBlkM.barcode).toBe('8934563123451');
      });
    });

    it('Step 4: Tenant A configures Default Price List and resolves variant prices deterministically', async () => {
      await asTenant(TENANT_A, async () => {
        const defaultList = await pricingService.createPriceList({
          name: 'Default Retail Price List',
          currency: 'VND',
          isDefault: true,
          status: 'ACTIVE',
        });
        defaultPriceListId = defaultList.id;

        const withItems = await pricingService.upsertPriceListItems(
          defaultPriceListId,
          {
            items: [
              {
                variantId: variantIdsBySku['TSHIRT-BLK-M'],
                price: 179000,
              },
              {
                variantId: variantIdsBySku['TSHIRT-BLK-L'],
                price: 179000,
              },
              {
                variantId: variantIdsBySku['TSHIRT-WHT-M'],
                price: 179000,
              },
              {
                variantId: variantIdsBySku['TSHIRT-WHT-L'],
                price: 185000,
              },
            ],
          },
        );
        expect(withItems.items).toHaveLength(4);

        const resolved = await pricingService.resolvePrice(
          variantIdsBySku['TSHIRT-BLK-M'],
          {},
        );
        expect(resolved).toMatchObject({
          variantId: variantIdsBySku['TSHIRT-BLK-M'],
          skuCode: 'TSHIRT-BLK-M',
          currency: 'VND',
          amount: 179000,
          source: 'DEFAULT_PRICE_LIST',
          priceListId: defaultPriceListId,
        });
      });
    });

    it('Step 5: Tenant A queries product list, product detail, SKU/barcode lookup, updates product & price, and deactivates a variant', async () => {
      await asTenant(TENANT_A, async () => {
        const listRes = await productsService.listProducts({
          page: 1,
          limit: 10,
          q: 'áo thun',
          sort: 'createdAt',
          order: 'DESC',
        });
        expect(listRes.total).toBe(1);
        expect(listRes.items[0].id).toBe(productId);

        const detail = await productsService.getProductById(productId);
        expect(detail.variants).toHaveLength(4);
        expect(detail.unitConversions).toHaveLength(2);

        const bySku = await productsService.lookupBySkuOrBarcode({
          sku: 'tshirt-blk-m',
        });
        expect(bySku.variant.id).toBe(variantIdsBySku['TSHIRT-BLK-M']);
        expect(bySku.product.id).toBe(productId);

        const byBarcode = await productsService.lookupBySkuOrBarcode({
          barcode: '8934563123451',
        });
        expect(byBarcode.variant.skuCode).toBe('TSHIRT-BLK-M');

        // Update product master data
        const updatedProduct = await productsService.updateProduct(productId, {
          description: '100% combed cotton 250gsm — Updated',
          version: detail.version,
        });
        expect(updatedProduct.version).toBe(detail.version + 1);

        // Update variant price in default price list
        await pricingService.upsertPriceListItems(defaultPriceListId, {
          items: [
            {
              variantId: variantIdsBySku['TSHIRT-BLK-M'],
              price: 169000,
            },
          ],
        });
        const newResolved = await pricingService.resolvePrice(
          variantIdsBySku['TSHIRT-BLK-M'],
          {},
        );
        expect(newResolved.amount).toBe(169000);

        // Deactivate variant TSHIRT-WHT-L
        const deactivated = await productsService.updateVariantStatus(
          variantIdsBySku['TSHIRT-WHT-L'],
          { status: 'INACTIVE' },
        );
        expect(deactivated.status).toBe('INACTIVE');

        // Resolving sellable price for INACTIVE variant is rejected with 409
        await expect(
          pricingService.resolvePrice(variantIdsBySku['TSHIRT-WHT-L'], {}),
        ).rejects.toThrow(HttpException);

        // Verify transactional outbox recorded all domain events
        const outboxEvents = await adminDs
          .getRepository(OutboxEventEntity)
          .find({
            where: { tenantId: TENANT_A },
            order: { createdAt: 'ASC' },
          });
        const eventTypes = outboxEvents.map((e) => e.type);
        expect(eventTypes).toContain(CATALOG_PRODUCT_CREATED.type);
        expect(eventTypes).toContain(CATALOG_VARIANT_CREATED.type);
        expect(eventTypes).toContain(CATALOG_PRICE_CHANGED.type);
        expect(eventTypes).toContain(CATALOG_PRODUCT_UPDATED.type);
        expect(eventTypes).toContain(CATALOG_VARIANT_DEACTIVATED.type);
      });
    });

    it('Step 6: Enforces duplicate SKU rejection, category max-depth > 3 rejection, cycle rejection, and category-in-use protection', async () => {
      await asTenant(TENANT_A, async () => {
        // Duplicate SKU in Tenant A -> 409 SKU_ALREADY_EXISTS
        try {
          await productsService.createVariant(productId, {
            skuCode: 'TSHIRT-BLK-M',
            name: 'Duplicate SKU',
            basePrice: 199000,
          });
          fail('Expected SKU_ALREADY_EXISTS');
        } catch (err) {
          expectCatalogError(err, 409, CatalogErrorCode.SKU_ALREADY_EXISTS);
        }

        // Create depth-3 category under T-Shirts (depth 2) -> succeeds
        const graphicTees = await categoriesService.create({
          name: 'Graphic Tees',
          parentId: tshirtsCatId,
        });
        expect(graphicTees.depth).toBe(3);

        // Attempt depth-4 category under Graphic Tees -> 409 CATEGORY_DEPTH_EXCEEDED
        try {
          await categoriesService.create({
            name: 'Oversized Graphic Tees',
            parentId: graphicTees.id,
          });
          fail('Expected CATEGORY_DEPTH_EXCEEDED');
        } catch (err) {
          expectCatalogError(
            err,
            409,
            CatalogErrorCode.CATEGORY_DEPTH_EXCEEDED,
          );
        }

        // Attempt cyclic reparent: move Clothing (depth 1) under T-Shirts (its child) -> 409 CATEGORY_CYCLE_DETECTED
        try {
          await categoriesService.reparent(clothingCatId, {
            parentId: tshirtsCatId,
          });
          fail('Expected CATEGORY_CYCLE_DETECTED');
        } catch (err) {
          expectCatalogError(
            err,
            409,
            CatalogErrorCode.CATEGORY_CYCLE_DETECTED,
          );
        }

        // Attempt deleting/deactivating T-Shirts while referenced by active product & active child category -> 409 CATEGORY_IN_USE
        try {
          await categoriesService.remove(tshirtsCatId);
          fail('Expected CATEGORY_IN_USE');
        } catch (err) {
          expectCatalogError(err, 409, CatalogErrorCode.CATEGORY_IN_USE);
        }
      });
    });

    it('Step 7: Tenant B cannot read, update, or delete Tenant A data, and can reuse the same SKU "TSHIRT-BLK-M"', async () => {
      // Unscoped connection without app.tenant_id sees 0 rows due to FORCE ROW LEVEL SECURITY
      const unscopedProducts = await appDs.query(
        `SELECT id FROM "${schema}"."products"`,
      );
      expect(unscopedProducts).toEqual([]);

      await asTenant(TENANT_B, async () => {
        const tenantBList = await productsService.listProducts({
          page: 1,
          limit: 20,
          sort: 'createdAt',
          order: 'DESC',
        });
        expect(tenantBList.total).toBe(0);
        expect(tenantBList.items).toHaveLength(0);

        // Tenant B cannot read Tenant A's product
        try {
          await productsService.getProductById(productId);
          fail('Expected PRODUCT_NOT_FOUND');
        } catch (err) {
          expectCatalogError(err, 404, CatalogErrorCode.PRODUCT_NOT_FOUND);
        }

        // Tenant B cannot update Tenant A's product
        try {
          await productsService.updateProduct(productId, {
            name: 'Hijacked by Tenant B',
          });
          fail('Expected PRODUCT_NOT_FOUND');
        } catch (err) {
          expectCatalogError(err, 404, CatalogErrorCode.PRODUCT_NOT_FOUND);
        }

        // Tenant B cannot delete Tenant A's product
        try {
          await productsService.softDeleteProduct(productId);
          fail('Expected PRODUCT_NOT_FOUND');
        } catch (err) {
          expectCatalogError(err, 404, CatalogErrorCode.PRODUCT_NOT_FOUND);
        }

        // Tenant B can create its own product with the exact same SKU 'TSHIRT-BLK-M' and barcode '8934563123451'
        const tenantBProduct = await productsService.createProduct({
          name: 'Áo thun Tenant B',
          baseUnit: 'Cái',
          status: 'ACTIVE',
          createDefaultVariant: true,
          defaultSkuCode: 'TSHIRT-BLK-M',
          defaultBarcode: '8934563123451',
          defaultBasePrice: 219000,
        });
        expect(tenantBProduct.variants).toHaveLength(1);
        expect(tenantBProduct.variants?.[0].skuCode).toBe('TSHIRT-BLK-M');
      });
    });
  });

  describe('Section 13.3 — Concurrency, Locking & Transactional Rollback Verification', () => {
    it('Concurrency 1: Two concurrent requests creating the same SKU in the same tenant -> one succeeds, one fails with 409 SKU_ALREADY_EXISTS', async () => {
      await asTenant(TENANT_A, async () => {
        const p = await productsService.createProduct({
          name: 'Concurrent SKU Product',
          createDefaultVariant: false,
        });

        const results = await Promise.allSettled([
          productsService.createVariant(p.id, {
            skuCode: 'CONC-SKU-001',
            name: 'Concurrent A',
            basePrice: 100000,
          }),
          productsService.createVariant(p.id, {
            skuCode: 'CONC-SKU-001',
            name: 'Concurrent B',
            basePrice: 100000,
          }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expectCatalogError(
          rejected[0].reason,
          409,
          CatalogErrorCode.SKU_ALREADY_EXISTS,
        );
      });
    });

    it('Concurrency 2: Two concurrent requests creating active default price lists -> one succeeds, one fails with 409 PRICE_LIST_CONFLICT', async () => {
      const freshTenant = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      await asTenant(freshTenant, async () => {
        const results = await Promise.allSettled([
          pricingService.createPriceList({
            name: 'Default List 1',
            isDefault: true,
            status: 'ACTIVE',
          }),
          pricingService.createPriceList({
            name: 'Default List 2',
            isDefault: true,
            status: 'ACTIVE',
          }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expectCatalogError(
          rejected[0].reason,
          409,
          CatalogErrorCode.PRICE_LIST_CONFLICT,
        );
      });
    });

    it('Concurrency 3: Two concurrent requests creating the same variant attribute combination -> one succeeds, one fails with 409 VARIANT_COMBINATION_EXISTS', async () => {
      const combTenant = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      await asTenant(combTenant, async () => {
        const attr = await attributesService.createAttribute({
          name: 'Material',
        });
        const val = await attributesService.createValue(attr.id, {
          value: 'Linen',
        });
        const prod = await productsService.createProduct({
          name: 'Linen Shirt',
          createDefaultVariant: false,
          attributeIds: [attr.id],
        });

        const results = await Promise.allSettled([
          productsService.createVariant(prod.id, {
            skuCode: 'LINEN-01',
            name: 'Linen 1',
            basePrice: 250000,
            attributes: [{ attributeId: attr.id, attributeValueId: val.id }],
          }),
          productsService.createVariant(prod.id, {
            skuCode: 'LINEN-02',
            name: 'Linen 2',
            basePrice: 250000,
            attributes: [{ attributeId: attr.id, attributeValueId: val.id }],
          }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expectCatalogError(
          rejected[0].reason,
          409,
          CatalogErrorCode.VARIANT_COMBINATION_EXISTS,
        );
      });
    });

    it('Concurrency 4: Optimistic concurrency version conflict on product update -> 409 RESOURCE_VERSION_CONFLICT', async () => {
      await asTenant(TENANT_A, async () => {
        const prod = await productsService.createProduct({
          name: 'Versioned Product',
          createDefaultVariant: false,
        });
        expect(prod.version).toBe(1);

        const updated = await productsService.updateProduct(prod.id, {
          name: 'Versioned Product v2',
          version: 1,
        });
        expect(updated.version).toBe(2);

        try {
          await productsService.updateProduct(prod.id, {
            name: 'Stale Update with v1',
            version: 1,
          });
          fail('Expected RESOURCE_VERSION_CONFLICT');
        } catch (err) {
          expectCatalogError(
            err,
            409,
            CatalogErrorCode.RESOURCE_VERSION_CONFLICT,
          );
        }
      });
    });

    it('Concurrency 5: Transaction rollback on failure during variant generation leaves zero partial variants or outbox events', async () => {
      const rollbackTenant = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      await asTenant(rollbackTenant, async () => {
        const sizeAttr = await attributesService.createAttribute({
          name: 'Size',
        });
        const sVal = await attributesService.createValue(sizeAttr.id, {
          value: 'S',
        });
        const mVal = await attributesService.createValue(sizeAttr.id, {
          value: 'M',
        });

        // Pre-create a product with SKU 'ROLLBACK-M' so the 2nd generated variant ('ROLLBACK-M') collides
        await productsService.createProduct({
          name: 'Existing Product Owning ROLLBACK-M',
          createDefaultVariant: true,
          defaultSkuCode: 'ROLLBACK-M',
        });

        const targetProd = await productsService.createProduct({
          name: 'Target Rollback Product',
          createDefaultVariant: false,
          attributeIds: [sizeAttr.id],
        });

        const outboxBefore = await adminDs
          .getRepository(OutboxEventEntity)
          .count({ where: { tenantId: rollbackTenant } });

        await expect(
          productsService.generateVariants(targetProd.id, {
            skuPrefix: 'ROLLBACK',
            basePrice: 150000,
            axes: [
              {
                attributeId: sizeAttr.id,
                valueIds: [sVal.id, mVal.id],
              },
            ],
            skuTokens: { S: 'S', M: 'M' },
          }),
        ).rejects.toThrow(HttpException);

        // Verify zero variants were persisted for targetProd (ROLLBACK-S was rolled back!)
        const reloadTarget = await productsService.getProductById(
          targetProd.id,
        );
        expect(reloadTarget.variants).toHaveLength(0);

        const outboxAfter = await adminDs
          .getRepository(OutboxEventEntity)
          .count({ where: { tenantId: rollbackTenant } });
        expect(outboxAfter).toBe(outboxBefore);
      });
    });
  });

  describe('Plan limits (products)', () => {
    const tenant = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';
    const setLimit = (quotaProducts: number) =>
      adminDs.query(
        `INSERT INTO "${schema}"."tenant_plan_quota"
           ("tenant_id","plan_code","quota_products","quota_storage_mb","source_changed_at")
         VALUES ($1,'free',$2,1024,now())
         ON CONFLICT ("tenant_id") DO UPDATE SET "quota_products" = EXCLUDED."quota_products"`,
        [tenant, quotaProducts],
      );
    const create = (name: string) =>
      asTenant(tenant, () => productsService.createProduct({ name }));
    const usageEvents = () =>
      adminDs
        .getRepository(OutboxEventEntity)
        .find({ where: { tenantId: tenant, type: 'catalog.usage.changed' } });

    it('creates without limit while no plan is known for the store', async () => {
      await create('No plan 1');
      await create('No plan 2');
    });

    it('refuses the product over the limit with 409 Q001 and the facts for the upgrade hint', async () => {
      await setLimit(3); // two products exist already
      await create('Third');
      const error = await create('Fourth').catch((e) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        errorCode: 'Q001',
        details: { key: 'products', used: 3, limit: 3, planCode: 'free' },
      });
    });

    it('does not count archived products', async () => {
      const [first] = await asTenant(tenant, () =>
        productsService.listProducts({
          page: 1,
          limit: 10,
          q: 'No plan 1',
          sort: 'createdAt',
          order: 'ASC',
        }),
      ).then((r) => r.items);
      await asTenant(tenant, () =>
        productsService.updateProductStatus(first.id, { status: 'ARCHIVED' }),
      );
      await create('Fits again');
    });

    it('tells platform what the store uses, in the same transaction as the change', async () => {
      const events = await usageEvents();
      const last = events
        .map(
          (e) =>
            e.payload.payload as {
              products: number;
              storageMb: number;
              measuredAt: string;
            },
        )
        .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
        .pop();
      expect(events.length).toBeGreaterThan(0);
      expect(last).toMatchObject({ products: 3, storageMb: 0 });
    });

    it('is serialised: two creates at limit - 1 let exactly one through', async () => {
      await setLimit(4); // three used
      const results = await Promise.allSettled([
        create('Race A'),
        create('Race B'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });
  describe('Plan limits (storage)', () => {
    const tenant = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
    const MB = 1024 * 1024;
    const quota = () => new PlanQuotaService(new EventOutbox());
    const addUpload = (status: string, kind: string, bytes: number) =>
      adminDs.query(
        `INSERT INTO "${schema}"."uploads"
           ("tenant_id","kind","file_name","content_type","declared_size","stored_size","storage_key","status","expires_at")
         VALUES ($1,$2,'f','image/png',$3,$3,'k-' || gen_random_uuid(),$4, now() + interval '1 day')`,
        [tenant, kind, bytes, status],
      );
    const store = (bytes: number) =>
      asTenant(tenant, () =>
        runInTenantTransaction(appDs, (em) =>
          quota().assertCanStore(em, bytes),
        ),
      );

    beforeAll(async () => {
      await adminDs.query(
        `INSERT INTO "${schema}"."tenant_plan_quota"
           ("tenant_id","plan_code","quota_products","quota_storage_mb","source_changed_at")
         VALUES ($1,'free',100,10,now())`,
        [tenant],
      );
    });

    it('counts UPLOADED and ATTACHED files (images and imports), not PENDING ones', async () => {
      await addUpload('PENDING', 'IMAGE', 5 * MB);
      await addUpload('UPLOADED', 'IMAGE', 4 * MB);
      await addUpload('ATTACHED', 'IMAGE', 3 * MB);
      await addUpload('ATTACHED', 'IMPORT', 2 * MB);
      // 9 MB kept of 10 MB: 1 MB fits, 2 MB does not
      await store(1 * MB);
      const error = await store(2 * MB).catch((e) => e);
      expect(error).toBeInstanceOf(CatalogDomainError);
      expect(error).toMatchObject({
        code: 'Q001',
        details: { key: 'storageGb', planCode: 'free' },
      });
    });

    it('announces the same figure as the usage', async () => {
      await asTenant(tenant, () =>
        runInTenantTransaction(appDs, (em) => quota().announceUsage(em)),
      );
      const events = await adminDs
        .getRepository(OutboxEventEntity)
        .find({ where: { tenantId: tenant, type: 'catalog.usage.changed' } });
      expect(
        events.map(
          (e) => (e.payload.payload as { storageMb: number }).storageMb,
        ),
      ).toContain(9);
    });
  });
});
