/**
 * Reproducible Performance & EXPLAIN (ANALYZE, BUFFERS) Benchmark Suite
 * for SapoClone M1 Catalog Microservice.
 *
 * Execute with:
 *   npx ts-node -r tsconfig-paths/register apps/catalog/test/performance/catalog-benchmark.ts
 */
import { RequestContext, TenantScopedRepository } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
  provisionServiceRole,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../../libs/events/test/it-env';
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
} from '../../src/infrastructure/persistence/catalog.entities';
import { CreateCatalogTables1791900000200 } from '../../src/migrations/1791900000200-create-catalog-tables';
import { AttributesService } from '../../src/modules/attributes/attributes.service';
import { BrandsService } from '../../src/modules/brands/brands.service';
import { CategoriesService } from '../../src/modules/categories/categories.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { ProductsService } from '../../src/modules/products/products.service';

interface LatencyStats {
  scenario: string;
  totalRequests: number;
  concurrency: number;
  errors: number;
  durationMs: number;
  throughputRps: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Number(sorted[idx].toFixed(2));
}

async function runBenchmarkScenario(
  scenario: string,
  totalRequests: number,
  concurrency: number,
  workerFn: (index: number) => Promise<void>,
): Promise<LatencyStats> {
  const latencies: number[] = [];
  let errors = 0;
  let nextIndex = 0;

  const startAll = performance.now();
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= totalRequests) break;
      const t0 = performance.now();
      try {
        await workerFn(idx);
        latencies.push(performance.now() - t0);
      } catch {
        errors++;
        latencies.push(performance.now() - t0);
      }
    }
  });

  await Promise.all(workers);
  const durationMs = performance.now() - startAll;
  latencies.sort((a, b) => a - b);

  return {
    scenario,
    totalRequests,
    concurrency,
    errors,
    durationMs: Number(durationMs.toFixed(2)),
    throughputRps: Number(((totalRequests / durationMs) * 1000).toFixed(2)),
    minMs: Number((latencies[0] ?? 0).toFixed(2)),
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: Number((latencies[latencies.length - 1] ?? 0).toFixed(2)),
  };
}

async function main() {
  const schema = uniqueSchema('catalog_bench');
  const catalogAppRole = `${schema}_app`;
  useDatabase(schema);

  const adminDs = await initializeDatabase(
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
      ],
    }),
  );

  await provisionServiceRole(adminDs, schema, catalogAppRole);

  const appDs = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    username: catalogAppRole,
    password: catalogAppRole,
    database: 'pbl',
    schema,
    extra: { max: 20 },
    entities: [...CATALOG_ENTITIES, ...PRODUCER_ENTITIES, ...CONSUMER_ENTITIES],
  });
  await appDs.initialize();

  const outbox = new EventOutbox();
  const categoriesService = new CategoriesService(
    appDs,
    TenantScopedRepository.forEntity(appDs, CategoryEntity),
  );
  const brandsService = new BrandsService(
    TenantScopedRepository.forEntity(appDs, BrandEntity),
  );
  const attributesService = new AttributesService(
    TenantScopedRepository.forEntity(appDs, AttributeEntity),
    TenantScopedRepository.forEntity(appDs, AttributeValueEntity),
  );
  const productsService = new ProductsService(
    appDs,
    outbox,
    TenantScopedRepository.forEntity(appDs, ProductEntity),
    TenantScopedRepository.forEntity(appDs, ProductVariantEntity),
    TenantScopedRepository.forEntity(appDs, UnitConversionEntity),
  );
  const pricingService = new PricingService(
    appDs,
    outbox,
    TenantScopedRepository.forEntity(appDs, PriceListEntity),
  );

  const asTenant = <T>(tenantId: string, work: () => Promise<T>): Promise<T> =>
    RequestContext.run({ tenantId, requestId: 'bench' }, work);

  try {
    const tenants = Array.from({ length: 10 }, (_, i) => {
      const hex = (i + 1).toString(16).padStart(12, '0');
      return `11111111-2222-4333-8444-${hex}`;
    });
    const primaryTenant = tenants[0];

    // Seed 2,000 products and 6,000 variants across 10 tenants (1,200 products & 3,600 variants in primaryTenant)
    let primaryCategoryId = '';
    let primaryBrandId = '';
    let primaryPriceListId = '';
    const sampleSkus: string[] = [];
    const sampleBarcodes: string[] = [];
    const sampleVariantIds: string[] = [];

    for (let tIdx = 0; tIdx < tenants.length; tIdx++) {
      const tId = tenants[tIdx];
      await asTenant(tId, async () => {
        const rootCat = await categoriesService.create({ name: 'Apparel' });
        const subCat = await categoriesService.create({
          name: 'Tops',
          parentId: rootCat.id,
        });
        const brand = await brandsService.create({ name: 'Sapo Basic' });
        const priceList = await pricingService.createPriceList({
          name: 'Default Retail',
          isDefault: true,
          status: 'ACTIVE',
        });

        if (tIdx === 0) {
          primaryCategoryId = subCat.id;
          primaryBrandId = brand.id;
          primaryPriceListId = priceList.id;
        }

        const productCount = tIdx === 0 ? 1200 : 90;
        const productRows: string[] = [];
        const variantRows: string[] = [];
        const priceItemRows: string[] = [];

        for (let p = 0; p < productCount; p++) {
          const pId = randomUUID();
          const pName = `Áo thun Basic #${tIdx}-${p}`;
          const pNorm = pName.toLowerCase();
          productRows.push(
            `('${pId}', '${tId}', '${subCat.id}', '${brand.id}', '${pName}', '${pNorm}', 'Cái', false, 'ACTIVE', '[]'::jsonb, 1)`,
          );

          for (let v = 0; v < 3; v++) {
            const vId = randomUUID();
            const sku = `SKU-T${tIdx}-P${p}-V${v}`;
            const barcode = `BC-${tIdx}-${p}-${v}`;
            const isDef = v === 0 ? 'true' : 'false';
            const sig = `axis:${v}`;
            variantRows.push(
              `('${vId}', '${tId}', '${pId}', '${sku}', '${barcode}', '${pName} V${v}', 199000.00, 'ACTIVE', ${isDef}, '${sig}', 1)`,
            );
            priceItemRows.push(
              `('${randomUUID()}', '${tId}', '${priceList.id}', '${vId}', 179000.00, 1)`,
            );

            if (tIdx === 0 && sampleSkus.length < 200) {
              sampleSkus.push(sku);
              sampleBarcodes.push(barcode);
              sampleVariantIds.push(vId);
            }
          }
        }

        await adminDs.query(
          `INSERT INTO "${schema}"."products"
           (id, tenant_id, category_id, brand_id, name, normalized_name, base_unit, is_combo, status, images, version)
           VALUES ${productRows.join(',')}`,
        );
        await adminDs.query(
          `INSERT INTO "${schema}"."product_variants"
           (id, tenant_id, product_id, sku_code, barcode, name, base_price, status, is_default, combination_signature, version)
           VALUES ${variantRows.join(',')}`,
        );
        await adminDs.query(
          `INSERT INTO "${schema}"."price_list_items"
           (id, tenant_id, price_list_id, variant_id, price, version)
           VALUES ${priceItemRows.join(',')}`,
        );
      });
    }

    await adminDs.query(`ANALYZE "${schema}"."categories"`);
    await adminDs.query(`ANALYZE "${schema}"."products"`);
    await adminDs.query(`ANALYZE "${schema}"."product_variants"`);
    await adminDs.query(`ANALYZE "${schema}"."price_lists"`);
    await adminDs.query(`ANALYZE "${schema}"."price_list_items"`);

    // Setup attributes in primaryTenant for Scenario C (product + variant generation)
    let benchColorAttrId = '';
    let benchColorValIds: string[] = [];
    let benchSizeAttrId = '';
    let benchSizeValIds: string[] = [];

    await asTenant(primaryTenant, async () => {
      const cAttr = await attributesService.createAttribute({
        name: 'BenchColor',
      });
      benchColorAttrId = cAttr.id;
      const c1 = await attributesService.createValue(cAttr.id, {
        value: 'Navy',
      });
      const c2 = await attributesService.createValue(cAttr.id, {
        value: 'Olive',
      });
      benchColorValIds = [c1.id, c2.id];

      const sAttr = await attributesService.createAttribute({
        name: 'BenchSize',
      });
      benchSizeAttrId = sAttr.id;
      const s1 = await attributesService.createValue(sAttr.id, { value: 'M' });
      const s2 = await attributesService.createValue(sAttr.id, { value: 'L' });
      benchSizeValIds = [s1.id, s2.id];
    });

    // Scenario A: Product listing with filters & pagination (200 requests, concurrency 15)
    const statsA = await runBenchmarkScenario(
      'Scenario A — Product Listing (Filtered + Paginated)',
      200,
      15,
      async (idx) => {
        await asTenant(primaryTenant, async () => {
          await productsService.listProducts({
            page: (idx % 5) + 1,
            limit: 20,
            categoryId: primaryCategoryId,
            brandId: primaryBrandId,
            status: 'ACTIVE',
            sort: 'createdAt',
            order: 'DESC',
          });
        });
      },
    );

    // Scenario B: Fast POS SKU / Barcode Lookup (300 requests, concurrency 20)
    const statsB = await runBenchmarkScenario(
      'Scenario B — POS SKU & Barcode Exact Lookup',
      300,
      20,
      async (idx) => {
        await asTenant(primaryTenant, async () => {
          if (idx % 2 === 0) {
            await productsService.lookupBySkuOrBarcode({
              sku: sampleSkus[idx % sampleSkus.length],
            });
          } else {
            await productsService.lookupBySkuOrBarcode({
              barcode: sampleBarcodes[idx % sampleBarcodes.length],
            });
          }
        });
      },
    );

    // Scenario C: Transactional Product + Cartesian Variant Creation (60 requests, concurrency 10)
    const statsC = await runBenchmarkScenario(
      'Scenario C — Transactional Product + 4 Variants Creation (with Outbox)',
      60,
      10,
      async (idx) => {
        await asTenant(primaryTenant, async () => {
          const prod = await productsService.createProduct({
            name: `Bench Created Product ${idx}`,
            categoryId: primaryCategoryId,
            brandId: primaryBrandId,
            baseUnit: 'Cái',
            status: 'ACTIVE',
            createDefaultVariant: false,
          });
          await productsService.generateVariants(prod.id, {
            skuPrefix: `BGEN${idx}`,
            basePrice: '249000.00',
            axes: [
              { attributeId: benchColorAttrId, valueIds: benchColorValIds },
              { attributeId: benchSizeAttrId, valueIds: benchSizeValIds },
            ],
          });
        });
      },
    );

    // Scenario D: Deterministic Variant Price Resolution (300 requests, concurrency 20)
    const statsD = await runBenchmarkScenario(
      'Scenario D — Deterministic Variant Price Resolution',
      300,
      20,
      async (idx) => {
        await asTenant(primaryTenant, async () => {
          await pricingService.resolvePrice(
            sampleVariantIds[idx % sampleVariantIds.length],
            { priceListId: idx % 2 === 0 ? primaryPriceListId : undefined },
          );
        });
      },
    );

    // Scenario E: Multi-Tenant Concurrent Distribution across 10 Tenants (200 requests, concurrency 20)
    const statsE = await runBenchmarkScenario(
      'Scenario E — Multi-Tenant Concurrent Workload (10 Tenants)',
      200,
      20,
      async (idx) => {
        const tIdx = idx % tenants.length;
        const tId = tenants[tIdx];
        await asTenant(tId, async () => {
          await productsService.lookupBySkuOrBarcode({
            sku: `SKU-T${tIdx}-P${idx % 50}-V0`,
          });
        });
      },
    );

    // Capture EXPLAIN (ANALYZE, BUFFERS) plans under RLS tenant context
    const explainPlans: Record<string, string[]> = {};
    await asTenant(primaryTenant, async () => {
      await appDs.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          primaryTenant,
        ]);

        const planSku = await em.query(
          `EXPLAIN (ANALYZE, BUFFERS)
           SELECT id, product_id, sku_code, barcode, base_price, status
           FROM "${schema}"."product_variants"
           WHERE tenant_id = $1 AND sku_code = $2 AND deleted_at IS NULL`,
          [primaryTenant, sampleSkus[0]],
        );
        explainPlans.skuLookup = planSku.map(
          (r: Record<string, string>) => r['QUERY PLAN'],
        );

        const planBarcode = await em.query(
          `EXPLAIN (ANALYZE, BUFFERS)
           SELECT id, product_id, sku_code, barcode, base_price, status
           FROM "${schema}"."product_variants"
           WHERE tenant_id = $1 AND barcode = $2 AND deleted_at IS NULL`,
          [primaryTenant, sampleBarcodes[0]],
        );
        explainPlans.barcodeLookup = planBarcode.map(
          (r: Record<string, string>) => r['QUERY PLAN'],
        );

        const planProductList = await em.query(
          `EXPLAIN (ANALYZE, BUFFERS)
           SELECT id, name, status, category_id, brand_id, created_at
           FROM "${schema}"."products"
           WHERE tenant_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
           ORDER BY created_at DESC, id DESC
           LIMIT 20`,
          [primaryTenant],
        );
        explainPlans.productListKeyset = planProductList.map(
          (r: Record<string, string>) => r['QUERY PLAN'],
        );

        const planPriceItem = await em.query(
          `EXPLAIN (ANALYZE, BUFFERS)
           SELECT id, price, version
           FROM "${schema}"."price_list_items"
           WHERE tenant_id = $1 AND price_list_id = $2 AND variant_id = $3`,
          [primaryTenant, primaryPriceListId, sampleVariantIds[0]],
        );
        explainPlans.priceListItemLookup = planPriceItem.map(
          (r: Record<string, string>) => r['QUERY PLAN'],
        );
      });
    });

    console.log(
      JSON.stringify(
        {
          dataset: {
            tenants: tenants.length,
            totalSeededProducts: 1200 + 9 * 90,
            totalSeededVariants: (1200 + 9 * 90) * 3,
            primaryTenantProducts: 1200,
            primaryTenantVariants: 3600,
          },
          scenarios: [statsA, statsB, statsC, statsD, statsE],
          explainPlans,
        },
        null,
        2,
      ),
    );
  } finally {
    await appDs.destroy();
    await adminDs.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminDs.query(`DROP ROLE IF EXISTS "${catalogAppRole}"`);
    await adminDs.destroy();
  }
}

void main();
