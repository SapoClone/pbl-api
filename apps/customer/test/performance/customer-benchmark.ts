import { RequestContext } from '@pbl/common';
import { SALES_ORDER_COMPLETED } from '@pbl/contracts';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../../libs/events/test/it-env';
import { M4_CUSTOMER_ENTITIES } from '../../src/infrastructure/persistence/customer.entities';
import { CreateM4CustomerCore1791900000200 } from '../../src/migrations/1791900000200-create-m4-customer-core';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { MembershipsService } from '../../src/modules/memberships/memberships.service';
import { ProfilesService } from '../../src/modules/profiles/profiles.service';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const ACTOR_ID = '99999999-9999-4999-8999-999999999999';

function runAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run(
    {
      requestId: randomUUID(),
      tenantId,
      actor: { id: ACTOR_ID, type: 'account' },
    },
    fn,
  );
}

function computeStats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const pct = (p: number) => {
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
    );
    return Number(sorted[idx].toFixed(2));
  };
  return {
    count: sorted.length,
    avgMs: Number((sum / sorted.length).toFixed(2)),
    p50Ms: pct(50),
    p95Ms: pct(95),
    p99Ms: pct(99),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
  };
}

async function main() {
  const schema = uniqueSchema('customer_m4_bench');
  useDatabase(schema);

  const dataSource: DataSource = await initializeDatabase({
    ...databaseOptions({
      entities: [
        ...M4_CUSTOMER_ENTITIES,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateM4CustomerCore1791900000200,
      ],
    }),
  });

  const outbox = new EventOutbox();
  const membershipsService = new MembershipsService(dataSource, outbox);
  const loyaltyService = new LoyaltyService(
    dataSource,
    membershipsService,
    outbox,
  );
  const profilesService = new ProfilesService(dataSource, outbox);

  console.log('=== M4 CUSTOMER & LOYALTY BENCHMARK — SEEDING DATASET ===');
  const seedStart = performance.now();

  await runAsTenant(TENANT_A, async () => {
    await loyaltyService.updateSettings(ACTOR_ID, {
      isEnabled: true,
      earnAmountPerPoint: 10000,
      redeemValuePerPoint: 1000,
      minRedeemPoints: 10,
      maxRedeemPointsPerOrder: 5000,
      holdTtlSeconds: 900,
    });
    await membershipsService.createTier({
      code: 'MEMBER',
      name: 'Member',
      minPoints: 0,
      discountRate: 0,
    });
    await membershipsService.createTier({
      code: 'SILVER',
      name: 'Silver',
      minPoints: 100,
      discountRate: 2,
    });
    await membershipsService.createTier({
      code: 'GOLD',
      name: 'Gold',
      minPoints: 500,
      discountRate: 5,
    });
  });

  // Bulk seed 5,000 customers in TENANT_A and 2,000 in TENANT_B + loyalty accounts + 10,000 loyalty transactions + 5,000 purchase projections
  await dataSource.query(
    `
    INSERT INTO "${schema}"."customers" (
      "id", "tenant_id", "code", "name", "phone", "phone_normalized", "email", "source", "status", "version"
    )
    SELECT
      gen_random_uuid(),
      $1::uuid,
      'KH' || LPAD(gs::text, 6, '0'),
      'Customer Tenant A #' || gs::text,
      '09' || LPAD(gs::text, 8, '0'),
      '09' || LPAD(gs::text, 8, '0'),
      'custa_' || gs::text || '@sapoclone.vn',
      'POS',
      'ACTIVE',
      1
    FROM generate_series(1, 5000) AS gs
    `,
    [TENANT_A],
  );

  await dataSource.query(
    `
    INSERT INTO "${schema}"."customers" (
      "id", "tenant_id", "code", "name", "phone", "phone_normalized", "email", "source", "status", "version"
    )
    SELECT
      gen_random_uuid(),
      $1::uuid,
      'KHB' || LPAD(gs::text, 6, '0'),
      'Customer Tenant B #' || gs::text,
      '09' || LPAD(gs::text, 8, '0'),
      '09' || LPAD(gs::text, 8, '0'),
      'custb_' || gs::text || '@sapoclone.vn',
      'POS',
      'ACTIVE',
      1
    FROM generate_series(1, 2000) AS gs
    `,
    [TENANT_B],
  );

  // Sync customer_code_sequence so subsequent createCustomer calls don't collide with KH000001..KH005000
  await dataSource.query(
    `INSERT INTO "${schema}"."customer_code_sequence" ("tenant_id", "seq_key", "last_value", "updated_at")
     VALUES ($1::uuid, 'KH', 6000, now())
     ON CONFLICT ("tenant_id", "seq_key") DO UPDATE SET "last_value" = 6000`,
    [TENANT_A],
  );

  await dataSource.query(
    `
    INSERT INTO "${schema}"."loyalty_accounts" (
      "id", "tenant_id", "customer_id", "posted_points_balance", "held_points",
      "lifetime_earned_points", "lifetime_redeemed_points", "qualifying_points", "status", "version"
    )
    SELECT
      gen_random_uuid(),
      c."tenant_id",
      c."id",
      500,
      0,
      500,
      0,
      500,
      'ACTIVE',
      1
    FROM "${schema}"."customers" c
    `,
  );

  await dataSource.query(
    `
    INSERT INTO "${schema}"."loyalty_transactions" (
      "id", "tenant_id", "customer_id", "loyalty_account_id", "transaction_type",
      "points_delta", "balance_before", "balance_after", "source_type", "source_ref_id", "idempotency_key", "reason"
    )
    SELECT
      gen_random_uuid(),
      la."tenant_id",
      la."customer_id",
      la."id",
      'EARN',
      500,
      0,
      500,
      'ORDER',
      la."id"::text,
      'seed:earn:' || la."id"::text,
      'Initial seed points'
    FROM "${schema}"."loyalty_accounts" la
    `,
  );

  await dataSource.query(
    `
    INSERT INTO "${schema}"."customer_purchase_projections" (
      "id", "tenant_id", "customer_id", "order_id", "order_code", "branch_id",
      "channel_type", "order_status", "original_order_total", "eligible_net_spend",
      "returned_amount", "earned_points", "reversed_points", "completed_at"
    )
    SELECT
      gen_random_uuid(),
      c."tenant_id",
      c."id",
      gen_random_uuid(),
      'DH-SEED-' || c."code",
      $2::uuid,
      'POS',
      'COMPLETED',
      '5000000.00',
      '5000000.00',
      '0.00',
      500,
      0,
      now() - interval '1 day'
    FROM "${schema}"."customers" c
    WHERE c."tenant_id" = $1::uuid
    `,
    [TENANT_A, BRANCH_A],
  );

  // Add 200 historical ledger transactions to a hot customer for ledger pagination benchmark
  const sampleCustRows: Array<{
    id: string;
    account_id: string;
    phone_normalized: string;
  }> = await dataSource.query(
    `SELECT c.id, la.id AS account_id, c.phone_normalized
       FROM "${schema}"."customers" c
       JOIN "${schema}"."loyalty_accounts" la ON la.customer_id = c.id
       WHERE c.tenant_id = $1::uuid
       ORDER BY c.code ASC
       LIMIT 10`,
    [TENANT_A],
  );
  const hotCustomer = sampleCustRows[0];

  await dataSource.query(
    `
    INSERT INTO "${schema}"."loyalty_transactions" (
      "id", "tenant_id", "customer_id", "loyalty_account_id", "transaction_type",
      "points_delta", "balance_before", "balance_after", "source_type", "source_ref_id", "idempotency_key", "reason"
    )
    SELECT
      gen_random_uuid(),
      $1::uuid,
      $2::uuid,
      $3::uuid,
      'EARN',
      10,
      500 + (gs - 1) * 10,
      500 + gs * 10,
      'ORDER',
      'hist-ord-' || gs::text,
      'seed:hist:' || gs::text,
      'Historical order #' || gs::text
    FROM generate_series(1, 200) AS gs
    `,
    [TENANT_A, hotCustomer.id, hotCustomer.account_id],
  );
  await dataSource.query(
    `UPDATE "${schema}"."loyalty_accounts"
     SET "posted_points_balance" = 2500,
         "lifetime_earned_points" = 2500,
         "qualifying_points" = 2500
     WHERE "id" = $1::uuid`,
    [hotCustomer.account_id],
  );

  await dataSource.query(`ANALYZE "${schema}"."customers"`);
  await dataSource.query(`ANALYZE "${schema}"."loyalty_accounts"`);
  await dataSource.query(`ANALYZE "${schema}"."loyalty_transactions"`);
  await dataSource.query(`ANALYZE "${schema}"."loyalty_holds"`);
  await dataSource.query(`ANALYZE "${schema}"."customer_purchase_projections"`);

  const seedElapsedMs = Math.round(performance.now() - seedStart);
  console.log(
    `Seeded 7,000 customers, 7,000 loyalty wallets, 7,200 ledger rows, and 5,000 purchase projections in ${seedElapsedMs} ms.`,
  );

  // 1. Customer Phone Lookup (100 iterations)
  const phoneLookupSamples: number[] = [];
  for (let i = 1; i <= 100; i += 1) {
    const phone = `09${String(((i * 37) % 4999) + 1).padStart(8, '0')}`;
    const t0 = performance.now();
    await profilesService.lookupCustomer(TENANT_A, { phone });
    phoneLookupSamples.push(performance.now() - t0);
  }
  const s1 = computeStats(phoneLookupSamples);

  // 2. Customer Creation (50 iterations)
  const createCustomerSamples: number[] = [];
  for (let i = 1; i <= 50; i += 1) {
    const phone = `039${String(1000000 + i).slice(-7)}`;
    const t0 = performance.now();
    await profilesService.createCustomer(TENANT_A, ACTOR_ID, {
      name: `Bench Created Customer ${i}`,
      phone,
      email: `bench_create_${i}@sapoclone.vn`,
    });
    createCustomerSamples.push(performance.now() - t0);
  }
  const s2 = computeStats(createCustomerSamples);

  // 3. Customer List / Pagination (50 iterations)
  const listSamples: number[] = [];
  for (let i = 1; i <= 50; i += 1) {
    const t0 = performance.now();
    await profilesService.listCustomers(TENANT_A, {
      page: (i % 10) + 1,
      limit: 20,
    });
    listSamples.push(performance.now() - t0);
  }
  const s3 = computeStats(listSamples);

  // 4. Customer 360 Summary (50 iterations)
  const summarySamples: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    const targetId = sampleCustRows[i % sampleCustRows.length].id;
    const t0 = performance.now();
    await profilesService.getCustomerSummary(TENANT_A, targetId);
    summarySamples.push(performance.now() - t0);
  }
  const s4 = computeStats(summarySamples);

  // 5. Loyalty Balance Read (100 iterations)
  const loyaltyReadSamples: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    const targetId = sampleCustRows[i % sampleCustRows.length].id;
    const t0 = performance.now();
    await runAsTenant(TENANT_A, () =>
      loyaltyService.getLoyaltyAccount(targetId),
    );
    loyaltyReadSamples.push(performance.now() - t0);
  }
  const s5 = computeStats(loyaltyReadSamples);

  // 6. High-Concurrency Point Hold Contention (100 concurrent holds of 50 pts against customer with 2500 pts -> 50 succeed, 50 rejected with INSUFFICIENT_LOYALTY_POINTS)
  const holdContentionSamples: number[] = [];
  const contentionResults = await Promise.allSettled(
    Array.from({ length: 100 }, async (_, idx) => {
      const t0 = performance.now();
      try {
        return await runAsTenant(TENANT_A, () =>
          loyaltyService.createHold(`bench-hot-hold-${idx}`, {
            customerId: hotCustomer.id,
            points: 50,
            sourceRefType: 'CHECKOUT',
            sourceRefId: `bench-chk-${idx}`,
          }),
        );
      } finally {
        holdContentionSamples.push(performance.now() - t0);
      }
    }),
  );
  const s6 = computeStats(holdContentionSamples);
  const s6Succeeded = contentionResults.filter(
    (r) => r.status === 'fulfilled',
  ).length;
  const s6Rejected = contentionResults.filter(
    (r) => r.status === 'rejected',
  ).length;

  // Release all 50 holds on hotCustomer so reconciliation is clean
  for (const r of contentionResults) {
    if (r.status === 'fulfilled') {
      await runAsTenant(TENANT_A, () =>
        loyaltyService.releaseHold(r.value.holdId, {
          reason: 'Benchmark cleanup release',
        }),
      );
    }
  }

  // 7. Loyalty Point Earning Ingestion (`sales.order.completed`, 50 iterations)
  const earnSamples: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    const targetId = sampleCustRows[i % sampleCustRows.length].id;
    const t0 = performance.now();
    await loyaltyService.onSalesOrderCompleted({
      id: randomUUID(),
      type: SALES_ORDER_COMPLETED.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT_A,
      actor: null,
      traceId: randomUUID(),
      payload: {
        orderId: randomUUID(),
        code: `DH-BENCH-${i}`,
        branchId: BRANCH_A,
        customerId: targetId,
        totalAmount: 250000,
        itemCount: 2,
        subtotal: '250000.00',
        discountTotal: '0.00',
        taxTotal: '0.00',
        grandTotal: '250000.00',
        paymentMethod: 'CASH',
        createdBy: ACTOR_ID,
        completedAt: new Date().toISOString(),
        items: [],
      },
    });
    earnSamples.push(performance.now() - t0);
  }
  const s7 = computeStats(earnSamples);

  // 8. Loyalty Transaction History Pagination (100 iterations)
  const txListSamples: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    const t0 = performance.now();
    await runAsTenant(TENANT_A, () =>
      loyaltyService.listLoyaltyTransactions(hotCustomer.id, {
        limit: 20,
        offset: (i % 5) * 20,
      }),
    );
    txListSamples.push(performance.now() - t0);
  }
  const s8 = computeStats(txListSamples);

  // Capture EXPLAIN (ANALYZE, BUFFERS) plans
  const explainPhoneLookup = await dataSource.query(
    `EXPLAIN (ANALYZE, BUFFERS)
     SELECT * FROM "${schema}"."customers"
     WHERE "tenant_id" = $1::uuid AND "phone_normalized" = $2 AND "deleted_at" IS NULL`,
    [TENANT_A, hotCustomer.phone_normalized],
  );

  const explainTxHistory = await dataSource.query(
    `EXPLAIN (ANALYZE, BUFFERS)
     SELECT * FROM "${schema}"."loyalty_transactions"
     WHERE "tenant_id" = $1::uuid AND "customer_id" = $2::uuid
     ORDER BY "created_at" DESC
     LIMIT 20 OFFSET 0`,
    [TENANT_A, hotCustomer.id],
  );

  const explainPurchaseProj = await dataSource.query(
    `EXPLAIN (ANALYZE, BUFFERS)
     SELECT * FROM "${schema}"."customer_purchase_projections"
     WHERE "tenant_id" = $1::uuid AND "customer_id" = $2::uuid
     ORDER BY "completed_at" DESC
     LIMIT 20 OFFSET 0`,
    [TENANT_A, hotCustomer.id],
  );

  const recon = await runAsTenant(TENANT_A, () =>
    loyaltyService.reconcileTenantLoyalty(),
  );

  console.log('\n=== M4 CUSTOMER & LOYALTY BENCHMARK RESULTS ===');
  console.table({
    '1. Phone Lookup (SLO p95<40ms, p99<80ms)': s1,
    '2. Create Customer (SLO p95<100ms, p99<200ms)': s2,
    '3. List Customers (SLO p95<120ms, p99<250ms)': s3,
    '4. Customer 360 Summary (SLO p95<120ms, p99<250ms)': s4,
    '5. Loyalty Balance Read (SLO p95<50ms, p99<100ms)': s5,
    '6. 100x Concurrent Point Holds (SLO p95<120ms, p99<250ms)': s6,
    '7. Loyalty Point Earning Ingestion (SLO p95<150ms, p99<300ms)': s7,
    '8. Loyalty Tx History Pagination (SLO p95<100ms, p99<200ms)': s8,
  });
  console.log(
    `100x Concurrent Holds Outcome: ${s6Succeeded} succeeded, ${s6Rejected} rejected (expected 50 / 50), Reconcile Discrepancies: ${recon.discrepancyCount}`,
  );

  console.log('\n--- EXPLAIN (ANALYZE, BUFFERS): Normalized Phone Lookup ---');
  console.log(explainPhoneLookup.map((r: any) => r['QUERY PLAN']).join('\n'));

  console.log(
    '\n--- EXPLAIN (ANALYZE, BUFFERS): Loyalty Ledger Pagination ---',
  );
  console.log(explainTxHistory.map((r: any) => r['QUERY PLAN']).join('\n'));

  console.log(
    '\n--- EXPLAIN (ANALYZE, BUFFERS): Purchase Projection Pagination ---',
  );
  console.log(explainPurchaseProj.map((r: any) => r['QUERY PLAN']).join('\n'));

  await dataSource.destroy();

  if (s6Succeeded !== 50 || s6Rejected !== 50 || recon.discrepancyCount !== 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
