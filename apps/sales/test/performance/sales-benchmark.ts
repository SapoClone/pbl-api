/**
 * Reproducible Performance, High-Concurrency Contention & EXPLAIN (ANALYZE, BUFFERS)
 * Benchmark Suite for SapoClone M3 Sales & POS Microservice.
 *
 * Seeds the full Section 12.1 dataset:
 *  - 5 tenants, 20 branches, 5,000 catalog variants
 *  - 500 POS shifts
 *  - 50,000 historical orders, 150,000 order items, 50,000 order tenders
 *
 * Execute with:
 *   npx ts-node -r tsconfig-paths/register apps/sales/test/performance/sales-benchmark.ts
 */
import { RequestContext } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../../libs/events/test/it-env';
import { BranchProjectionEntity } from '../../src/branches/branch-projection.entity';
import { CatalogClient } from '../../src/infrastructure/catalog-client/catalog.client';
import { M3_SALES_ENTITIES } from '../../src/infrastructure/persistence/sales.entities';
import { CreateSalesTables1791800000000 } from '../../src/migrations/1791800000000-create-sales-tables';
import { AddOrderIdempotency1791800000200 } from '../../src/migrations/1791800000200-add-order-idempotency';
import { CreateCheckoutWorkflow1791800000300 } from '../../src/migrations/1791800000300-create-checkout-workflow';
import { CreateM3SalesCore1791900000200 } from '../../src/migrations/1791900000200-create-m3-sales-core';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { M3OrdersService } from '../../src/modules/orders/m3-orders.service';
import { PosService } from '../../src/modules/pos/pos.service';
import { PromotionsService } from '../../src/modules/promotions/promotions.service';
import { ShiftsService } from '../../src/modules/shifts/shifts.service';
import { OrderItemEntity } from '../../src/orders/entities/order-item.entity';
import {
  CheckoutWorkflowEntity,
  OrderEntity,
} from '../../src/orders/entities/order.entity';

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

function withTenantContext<T>(
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return RequestContext.run(
    {
      requestId: randomUUID(),
      tenantId,
    },
    fn,
  );
}

class BenchmarkInventoryClient {
  private readonly stockBySku = new Map<string, number>();
  private readonly reservations = new Map<
    string,
    {
      reservationId: string;
      state: string;
      lines: Array<{ variantId?: string; skuId: string; qty: string }>;
    }
  >();

  setStock(sku: string, available: number): void {
    this.stockBySku.set(sku, available);
  }

  getStock(sku: string): number {
    return this.stockBySku.get(sku) ?? 0;
  }

  async reserveWarehouseStock(
    idempotencyKey: string,
    payload: {
      warehouseId: string;
      checkoutId: string;
      lines: Array<{ variantId?: string; skuId: string; qty: string }>;
    },
  ) {
    const existing = this.reservations.get(idempotencyKey);
    if (existing) {
      return {
        status: 'HELD' as const,
        replayed: true,
        reservation: {
          reservationId: existing.reservationId,
          tenantId: '',
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: payload.checkoutId,
          state: existing.state,
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
          createdAt: new Date().toISOString(),
          lines: existing.lines.map((l) => ({
            variantId: l.variantId,
            skuId: l.skuId,
            qty: l.qty,
            availableAfter: '0.000',
          })),
        },
      };
    }

    const shortages: Array<{
      warehouseId: string;
      skuId: string;
      requestedQty: string;
      availableQty: string;
    }> = [];
    for (const line of payload.lines) {
      const requested = Number(line.qty);
      const avail = this.stockBySku.get(line.skuId) ?? 0;
      if (avail < requested) {
        shortages.push({
          warehouseId: payload.warehouseId,
          skuId: line.skuId,
          requestedQty: line.qty,
          availableQty: String(avail),
        });
      }
    }

    if (shortages.length > 0) {
      return {
        status: 'INSUFFICIENT_STOCK' as const,
        shortages,
      };
    }

    for (const line of payload.lines) {
      const requested = Number(line.qty);
      const avail = this.stockBySku.get(line.skuId) ?? 0;
      this.stockBySku.set(line.skuId, avail - requested);
    }

    const reservationId = randomUUID();
    this.reservations.set(idempotencyKey, {
      reservationId,
      state: 'HELD',
      lines: payload.lines,
    });

    return {
      status: 'HELD' as const,
      replayed: false,
      reservation: {
        reservationId,
        tenantId: '',
        callerService: 'sales',
        sourceRefType: 'ORDER',
        sourceRefId: payload.checkoutId,
        state: 'HELD',
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        createdAt: new Date().toISOString(),
        lines: payload.lines.map((l) => ({
          variantId: l.variantId,
          skuId: l.skuId,
          qty: l.qty,
          availableAfter: '0.000',
        })),
      },
    };
  }

  async commitWarehouseReservation(reservationId: string) {
    for (const r of this.reservations.values()) {
      if (r.reservationId === reservationId) {
        r.state = 'COMMITTED';
        return { reservationId, state: 'COMMITTED' };
      }
    }
    return { reservationId, state: 'COMMITTED' };
  }

  async releaseWarehouseReservation(reservationId: string) {
    for (const r of this.reservations.values()) {
      if (r.reservationId === reservationId) {
        if (r.state === 'HELD') {
          for (const l of r.lines) {
            const avail = this.stockBySku.get(l.skuId) ?? 0;
            this.stockBySku.set(l.skuId, avail + Number(l.qty));
          }
          r.state = 'RELEASED';
        }
        return { reservationId, state: r.state };
      }
    }
    return { reservationId, state: 'RELEASED' };
  }

  async getWarehouseReservation(reservationId: string) {
    for (const r of this.reservations.values()) {
      if (r.reservationId === reservationId) {
        return { reservationId, state: r.state };
      }
    }
    return null;
  }
}

async function main(): Promise<void> {
  const schema = uniqueSchema('sales_m3_bench');
  useDatabase(schema);

  const dataSource: DataSource = await initializeDatabase({
    ...databaseOptions({
      entities: [
        OrderEntity,
        OrderItemEntity,
        CheckoutWorkflowEntity,
        BranchProjectionEntity,
        ...M3_SALES_ENTITIES,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateSalesTables1791800000000,
        AddOrderIdempotency1791800000200,
        CreateCheckoutWorkflow1791800000300,
        CreateM3SalesCore1791900000200,
      ],
    }),
  });

  const outbox = new EventOutbox();
  const catalogClient = new CatalogClient(dataSource);
  const inventoryClient = new BenchmarkInventoryClient();
  const promotionsService = new PromotionsService(dataSource);
  const posService = new PosService(
    dataSource,
    catalogClient,
    promotionsService,
  );
  const shiftsService = new ShiftsService(dataSource, outbox);
  const checkoutService = new CheckoutService(
    dataSource,
    posService,
    promotionsService,
    inventoryClient as never,
    outbox,
  );
  const m3OrdersService = new M3OrdersService(
    dataSource,
    posService,
    promotionsService,
    inventoryClient as never,
    outbox,
  );

  const tenantA = '11111111-1111-4111-8111-111111111111';
  const branchA = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
  const warehouseA = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';
  const ALL = null; // every branch
  const cashierId = '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c';

  console.log(
    '=== Step 1: Seeding Section 12.1 Multi-Tenant Sales Dataset ===',
  );
  const tSeedStart = performance.now();

  await dataSource.transaction(async (em) => {
    for (let t = 1; t <= 5; t++) {
      const tid =
        t === 1
          ? tenantA
          : `${t}${t}${t}${t}${t}${t}${t}${t}-1111-4111-8111-111111111111`;
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [tid]);

      for (let b = 1; b <= 4; b++) {
        const bid =
          t === 1 && b === 1
            ? branchA
            : `${t}a1a1a1a-1a1a-4a1a-8a1a-00000000000${b}`;
        await em.query(
          `INSERT INTO "${schema}"."branch_projection" (branch_id, tenant_id, code, name, is_warehouse, status, source_updated_at, synced_at)
           VALUES ($2, $1, $4, $3, true, 'active', now(), now())
           ON CONFLICT (branch_id) DO NOTHING`,
          [tid, bid, `Branch ${t}-${b}`, `CN${t}${b}`],
        );
      }

      // Seed 1,000 variants per tenant (5,000 total)
      await em.query(
        `INSERT INTO "${schema}"."catalog_variant_projection" (
           tenant_id, variant_id, product_id, sku_code, barcode, product_name, variant_name,
           unit_code, conversion_factor, unit_price, status, aggregate_version,
           source_updated_at, synced_at
         )
         SELECT
           $1::uuid,
           ('0000000' || $2::text || '-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
           ('1000000' || $2::text || '-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
           'SKU-T' || $2::text || '-' || lpad(g::text, 4, '0'),
           '893' || $2::text || lpad(g::text, 9, '0'),
           'Product T' || $2::text || ' #' || g::text,
           'Standard',
           'PCS',
           1.0000,
           (50000 + (g % 20) * 10000)::numeric(18,2),
           'ACTIVE',
           1,
           now(),
           now()
         FROM generate_series(1, 1000) AS g`,
        [tid, t],
      );

      // Seed 100 historical CLOSED shifts per tenant (500 total)
      const defaultBranch =
        t === 1 ? branchA : `${t}a1a1a1a-1a1a-4a1a-8a1a-000000000001`;
      await em.query(
        `INSERT INTO "${schema}"."pos_shifts" (
           id, tenant_id, branch_id, register_code, code, staff_id, status,
           opening_cash, cash_sales_total, cash_refunds_total,
           expected_cash, actual_cash, variance, opened_at, closed_at, closed_by
         )
         SELECT
           ('2000000' || $2::text || '-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
           $1::uuid,
           $3::uuid,
           'REG-' || lpad(g::text, 3, '0'),
           'SH' || lpad(g::text, 6, '0'),
           $4::uuid,
           'CLOSED',
           1000000.00,
           2500000.00,
           0.00,
           3500000.00,
           3500000.00,
           0.00,
           now() - interval '2 days',
           now() - interval '1 day',
           $4::uuid
         FROM generate_series(1, 100) AS g`,
        [tid, t, defaultBranch, cashierId],
      );

      // Seed 10,000 historical orders per tenant (50,000 total)
      await em.query(
        `INSERT INTO "${schema}"."orders" (
           id, tenant_id, code, branch_id, warehouse_id, channel_type,
           status, order_status, payment_status, fulfillment_status, payment_method,
           subtotal, item_discount_total, order_discount_total, promotion_discount_total,
           shipping_fee, tax_total, grand_total, paid_amount, refunded_amount,
           total_amount, item_count, created_by, idempotency_key, request_hash,
           version, created_at, updated_at, completed_at
         )
         SELECT
           ('3000000' || $2::text || '-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
           $1::uuid,
           'HD-HIST-' || lpad(g::text, 6, '0'),
           $3::uuid,
           $4::uuid,
           'POS',
           'completed',
           'COMPLETED',
           'PAID',
           'FULFILLED',
           'CASH',
           150000.00,
           0.00,
           0.00,
           0.00,
           0.00,
           0.00,
           150000.00,
           150000.00,
           0.00,
           150000,
           3,
           $5::uuid,
           ('6000000' || $2::text || '-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
           repeat('a', 64),
           1,
           now() - (g || ' seconds')::interval,
           now() - (g || ' seconds')::interval,
           now() - (g || ' seconds')::interval
         FROM generate_series(1, 10000) AS g`,
        [tid, t, defaultBranch, warehouseA, cashierId],
      );

      // Seed 30,000 historical order_items per tenant (150,000 total)
      await em.query(
        `INSERT INTO "${schema}"."order_items" (
           id, tenant_id, order_id, variant_id, product_id, sku, name, variant_label,
           unit_code, conversion_factor, quantity, qty, base_qty, unit_price,
           line_gross, item_discount_amount, allocated_order_discount, line_net,
           tax_rate, tax_amount, line_total, unit_cost_snapshot, returned_qty, refunded_amount
         )
         SELECT
           ('4000000' || $2::text || '-' || lpad(item_idx::text, 4, '0') || '-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
           $1::uuid,
           ('3000000' || $2::text || '-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
           ('0000000' || $2::text || '-0000-4000-8000-' || lpad(((g % 1000) + 1)::text, 12, '0'))::uuid,
           ('1000000' || $2::text || '-0000-4000-8000-' || lpad(((g % 1000) + 1)::text, 12, '0'))::uuid,
           'SKU-T' || $2::text || '-' || lpad(((g % 1000) + 1)::text, 4, '0'),
           'Product T' || $2::text || ' #' || ((g % 1000) + 1)::text,
           'Standard',
           'PCS',
           1.0000,
           1,
           1.000,
           1.000,
           50000,
           50000.00,
           0.00,
           0.00,
           50000.00,
           0.00,
           0.00,
           50000,
           30000.00,
           0.000,
           0.00
         FROM generate_series(1, 10000) AS g
         CROSS JOIN generate_series(1, 3) AS item_idx`,
        [tid, t],
      );

      // Seed 10,000 historical order_tenders per tenant (50,000 total)
      await em.query(
        `INSERT INTO "${schema}"."order_tenders" (
           id, tenant_id, order_id, idempotency_key, method, amount,
           tendered_cash, change_due, status, confirmed_by, confirmed_at, created_at
         )
         SELECT
           ('5000000' || $2::text || '-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
           $1::uuid,
           ('3000000' || $2::text || '-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
           'hist-tender-' || $2::text || '-' || g::text,
           'CASH',
           150000.00,
           150000.00,
           0.00,
           'CONFIRMED',
           $3::uuid,
           now() - (g || ' seconds')::interval,
           now() - (g || ' seconds')::interval
         FROM generate_series(1, 10000) AS g`,
        [tid, t, cashierId],
      );
    }
  });

  await dataSource.query(`ANALYZE "${schema}"."catalog_variant_projection"`);
  await dataSource.query(`ANALYZE "${schema}"."pos_shifts"`);
  await dataSource.query(`ANALYZE "${schema}"."orders"`);
  await dataSource.query(`ANALYZE "${schema}"."order_items"`);
  await dataSource.query(`ANALYZE "${schema}"."order_tenders"`);
  await dataSource.query(`ANALYZE "${schema}"."checkout_workflow"`);

  const seedMs = (performance.now() - tSeedStart).toFixed(0);
  console.log(
    `Seeded 5 tenants, 20 branches, 5,000 variants, 500 shifts, 50,000 orders, 150,000 order_items, 50,000 tenders in ${seedMs} ms.\n`,
  );

  for (let i = 1; i <= 20; i++) {
    const sku = `SKU-T1-${String(i).padStart(4, '0')}`;
    inventoryClient.setStock(sku, 50_000);
  }

  const activeShift = await withTenantContext(tenantA, () =>
    shiftsService.openShift(cashierId, ALL, {
      branchId: branchA,
      registerCode: 'REG-BENCH-01',
      openingCash: '2000000.00',
    }),
  );

  const promo = await withTenantContext(tenantA, () =>
    promotionsService.createPromotion(
      {
        code: 'BENCH10K',
        name: 'Benchmark 10k Off',
        discountType: 'FIXED',
        discountValue: 10000,
        minOrderAmount: 50000,
      },
      ALL,
    ),
  );

  await withTenantContext(tenantA, () =>
    promotionsService.createCoupon(
      {
        promotionId: promo.id,
        code: 'BENCH10K',
        maxUses: 100000,
      },
      ALL,
    ),
  );

  const variantIds = Array.from(
    { length: 5 },
    (_, i) => `00000001-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  );

  const results: LatencyStats[] = [];

  // Scenario 1: POS Barcode/SKU lookup
  results.push(
    await runBenchmarkScenario(
      '1. POS Barcode / SKU fast lookup',
      200,
      20,
      async (idx) => {
        const num = (idx % 1000) + 1;
        const barcode = `8931${String(num).padStart(9, '0')}`;
        await withTenantContext(tenantA, () =>
          posService.lookupProduct({ barcode }),
        );
      },
    ),
  );

  // Scenario 2: POS Quote with 5 items + discounts + coupon
  results.push(
    await runBenchmarkScenario(
      '2. POS Quote (5 items + item/order discount + coupon)',
      200,
      20,
      async () => {
        await withTenantContext(tenantA, () =>
          posService.resolveAndQuoteLines({
            branchId: branchA,
            lines: variantIds.map((vid, idx) => ({
              variantId: vid,
              qty: 2,
              discountType: idx === 0 ? 'PERCENT' : 'NONE',
              discountValue: idx === 0 ? 5 : 0,
            })),
            orderDiscountType: 'FIXED',
            orderDiscountValue: 5000,
            couponCode: 'BENCH10K',
            role: 'branch_manager',
          }),
        );
      },
    ),
  );

  // Scenario 3: Single-item POS checkout
  results.push(
    await runBenchmarkScenario(
      '3. Single-item POS checkout (Saga + Outbox)',
      100,
      10,
      async (idx) => {
        await withTenantContext(tenantA, () =>
          checkoutService.checkout(
            cashierId,
            ['orders.create'],
            ALL,
            `bench-single-checkout-${idx}`,
            {
              branchId: branchA,
              warehouseId: warehouseA,
              shiftId: activeShift.id,
              lines: [{ variantId: variantIds[0], qty: 1 }],
              paymentMethod: 'CASH',
              tenderedCash: 100000,
            },
          ),
        );
      },
    ),
  );

  // Scenario 4: 5-item POS checkout with discounts & split tenders
  results.push(
    await runBenchmarkScenario(
      '4. 5-item POS checkout (discounts + split tenders)',
      100,
      10,
      async (idx) => {
        await withTenantContext(tenantA, () =>
          checkoutService.checkout(
            cashierId,
            ['orders.approve'],
            ALL,
            `bench-5item-checkout-${idx}`,
            {
              branchId: branchA,
              warehouseId: warehouseA,
              shiftId: activeShift.id,
              lines: variantIds.map((vid) => ({
                variantId: vid,
                qty: 1,
                discountType: 'FIXED',
                discountValue: 1000,
              })),
              orderDiscountType: 'FIXED',
              orderDiscountValue: 5000,
              couponCode: 'BENCH10K',
              tenders: [
                {
                  method: 'CASH',
                  amount: 150000,
                  tenderedCash: 150000,
                },
                {
                  method: 'CARD',
                  amount: 230000,
                  verified: true,
                  externalRef: `CARD-BENCH-${idx}`,
                },
              ],
            },
          ),
        );
      },
    ),
  );

  // Scenario 5: 100 concurrent checkouts for 10 available units (contention test)
  const contentionVariantId = '00000001-0000-4000-8000-000000000099';
  const contentionSku = 'SKU-T1-0099';
  inventoryClient.setStock(contentionSku, 10);
  let contentionSuccess = 0;
  let contentionInsufficient = 0;

  const contentionStats = await runBenchmarkScenario(
    '5. 100 concurrent checkouts for 10 available units',
    100,
    100,
    async (idx) => {
      try {
        await withTenantContext(tenantA, () =>
          checkoutService.checkout(
            cashierId,
            ['orders.create'],
            ALL,
            `bench-contention-100-${idx}`,
            {
              branchId: branchA,
              warehouseId: warehouseA,
              shiftId: activeShift.id,
              lines: [{ variantId: contentionVariantId, qty: 1 }],
              paymentMethod: 'CASH',
              tenderedCash: 250000,
            },
          ),
        );
        contentionSuccess++;
      } catch {
        contentionInsufficient++;
      }
    },
  );
  results.push(contentionStats);

  // Scenario 6: Duplicate checkout idempotency replay
  const replayKey = 'bench-idempotent-replay-key-001';
  await withTenantContext(tenantA, () =>
    checkoutService.checkout(cashierId, ['orders.create'], ALL, replayKey, {
      branchId: branchA,
      warehouseId: warehouseA,
      shiftId: activeShift.id,
      lines: [{ variantId: variantIds[0], qty: 1 }],
      paymentMethod: 'CASH',
      tenderedCash: 100000,
    }),
  );

  results.push(
    await runBenchmarkScenario(
      '6. Duplicate checkout idempotency replay',
      200,
      20,
      async () => {
        await withTenantContext(tenantA, () =>
          checkoutService.checkout(
            cashierId,
            ['orders.create'],
            ALL,
            replayKey,
            {
              branchId: branchA,
              warehouseId: warehouseA,
              shiftId: activeShift.id,
              lines: [{ variantId: variantIds[0], qty: 1 }],
              paymentMethod: 'CASH',
              tenderedCash: 100000,
            },
          ),
        );
      },
    ),
  );

  // Scenario 7a & 7b: Paginated order list & order detail
  const sampleOrderId = '30000001-0000-4000-8000-000000000001';
  results.push(
    await runBenchmarkScenario(
      '7a. Paginated order list (branch + status filter)',
      200,
      20,
      async () => {
        await dataSource.transaction(async (em) => {
          await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
            tenantA,
          ]);
          await em.query(
            `SELECT * FROM "${schema}"."orders"
             WHERE tenant_id = $1 AND branch_id = $2 AND order_status = 'COMPLETED'
             ORDER BY created_at DESC
             LIMIT 20`,
            [tenantA, branchA],
          );
        });
      },
    ),
  );

  results.push(
    await runBenchmarkScenario(
      '7b. Order detail fetch (order + items + tenders + history)',
      200,
      20,
      async () => {
        await withTenantContext(tenantA, () =>
          m3OrdersService.getOrderDetails(sampleOrderId, ALL),
        );
      },
    ),
  );

  console.log('=== Step 2: Benchmark Latency & Throughput Summary ===');
  console.table(results);
  console.log(
    `Contention verification (100 concurrent checkouts for 10 units): succeeded=${contentionSuccess}, rejected=${contentionInsufficient}, remainingStock=${inventoryClient.getStock(contentionSku)}\n`,
  );

  console.log('=== Step 3: EXPLAIN (ANALYZE, BUFFERS) Query Plans ===');
  await dataSource.transaction(async (em) => {
    await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);

    const queries: Array<{ name: string; sql: string; params: unknown[] }> = [
      {
        name: 'Query 1: POS Barcode Fast Lookup (IDX_catalog_variant_proj_barcode)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT * FROM "${schema}"."catalog_variant_projection"
              WHERE tenant_id = $1 AND status = 'ACTIVE' AND barcode = $2
              LIMIT 20`,
        params: [tenantA, '8931000000042'],
      },
      {
        name: 'Query 2: Checkout Idempotency Lookup (UQ_checkout_workflow_tenant_idempotency)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT * FROM "${schema}"."checkout_workflow"
              WHERE tenant_id = $1 AND idempotency_key = $2
              LIMIT 1`,
        params: [tenantA, replayKey],
      },
      {
        name: 'Query 3: Paginated Order List by Branch & Status (IDX_orders_tenant_branch_status_created)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT * FROM "${schema}"."orders"
              WHERE tenant_id = $1 AND branch_id = $2 AND order_status = 'COMPLETED'
              ORDER BY created_at DESC
              LIMIT 20`,
        params: [tenantA, branchA],
      },
      {
        name: 'Query 4: Order Detail Line Items Lookup (IDX_order_items_tenant_order)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT * FROM "${schema}"."order_items"
              WHERE tenant_id = $1 AND order_id = $2`,
        params: [tenantA, sampleOrderId],
      },
      {
        name: 'Query 5: Open Shift Guard Lookup (UQ_pos_shifts_ActiveRegister)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT * FROM "${schema}"."pos_shifts"
              WHERE tenant_id = $1 AND branch_id = $2 AND register_code = $3 AND status = 'OPEN'`,
        params: [tenantA, branchA, 'REG-BENCH-01'],
      },
    ];

    for (const q of queries) {
      console.log(`\n--- ${q.name} ---`);
      const planRows: Array<{ 'QUERY PLAN': string }> = await em.query(
        q.sql,
        q.params,
      );
      for (const r of planRows) {
        console.log(r['QUERY PLAN']);
      }
    }
  });

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
