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
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../../libs/events/test/it-env';
import { M5_FINANCE_ENTITIES } from '../../src/infrastructure/persistence/finance.entities';
import { CreateM5FinanceCore1791900000200 } from '../../src/migrations/1791900000200-create-m5-finance-core';
import { CashAccountsService } from '../../src/modules/cash-accounts/cash-accounts.service';
import { CashbookService } from '../../src/modules/cashbook/cashbook.service';
import { CodService } from '../../src/modules/cod/cod.service';
import { CreditAuthorizationService } from '../../src/modules/credit-authorization/credit-authorization.service';
import { FinancialJournalService } from '../../src/modules/financial-journal/financial-journal.service';
import { PayablesService } from '../../src/modules/payables/payables.service';
import { ReceivablesService } from '../../src/modules/receivables/receivables.service';
import { RefundsService } from '../../src/modules/refunds/refunds.service';
import { SettlementsService } from '../../src/modules/settlements/settlements.service';

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
  const schema = uniqueSchema('finance_m5_bench');
  useDatabase(schema);

  const dataSource: DataSource = await initializeDatabase({
    ...databaseOptions({
      entities: [
        ...M5_FINANCE_ENTITIES,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateM5FinanceCore1791900000200,
      ],
    }),
  });

  const outbox = new EventOutbox();
  const journalService = new FinancialJournalService(dataSource);
  const cashAccountsService = new CashAccountsService(dataSource);
  const cashbookService = new CashbookService(
    dataSource,
    journalService,
    outbox,
  );
  const creditAuthService = new CreditAuthorizationService(
    dataSource,
    journalService,
    outbox,
  );
  const receivablesService = new ReceivablesService(
    dataSource,
    journalService,
    cashAccountsService,
    cashbookService,
    creditAuthService,
    outbox,
  );
  const payablesService = new PayablesService(
    dataSource,
    journalService,
    cashAccountsService,
    cashbookService,
    outbox,
  );
  const settlementsService = new SettlementsService(
    dataSource,
    journalService,
    cashAccountsService,
    cashbookService,
    outbox,
  );
  const refundsService = new RefundsService(
    dataSource,
    journalService,
    cashAccountsService,
    cashbookService,
    outbox,
  );
  const codService = new CodService(
    dataSource,
    journalService,
    cashAccountsService,
    cashbookService,
    outbox,
  );

  console.log('=== M5 FINANCE BENCHMARK — SEEDING HIGH-VOLUME DATASET ===');
  const seedStart = performance.now();

  let defaultCashAccountId = '';
  let sampleCustomerId = '';
  let sampleSupplierId = '';

  await runAsTenant(TENANT_A, async () => {
    const acc = await cashAccountsService.createCashAccount(
      {
        code: 'BENCH-DRAWER-01',
        name: 'Benchmark POS Cash Drawer',
        accountType: 'CASH_DRAWER',
        branchId: BRANCH_A,
      },
      TENANT_A,
    );
    defaultCashAccountId = acc.id;
  });

  const categoryId = randomUUID();
  sampleCustomerId = 'cccccccc-0000-4000-8000-000000000001';
  sampleSupplierId = 'dddddddd-0000-4000-8000-000000000001';

  await dataSource.query(
    `
    INSERT INTO "${schema}"."cashbook_categories" (
      "id", "tenant_id", "code", "name", "direction", "gl_account_code", "is_system", "status"
    ) VALUES ($1, $2, 'BENCH_RECEIPT', 'Benchmark Receipt', 'RECEIPT', '7110', true, 'ACTIVE')
    ON CONFLICT ("tenant_id", "code") DO NOTHING;
    `,
    [categoryId, TENANT_A],
  );

  // Seed 2,000 Customer Credit Profiles, 10,000 Cashbook Entries, 5,000 Receivables, 10,000 Customer Debt Ledger rows,
  // 2,000 Supplier Payables, 4,000 Supplier Debt Ledger rows, 5,000 Payment Settlements, 3,000 COD Receivables,
  // and 10,000 Financial Journals + 20,000 Journal Lines
  await dataSource.query(`
    -- 1. 2,000 Customer Credit Profiles
    INSERT INTO "${schema}"."customer_credit_profiles" (
      "id", "tenant_id", "customer_id", "credit_limit", "posted_debt", "held_credit", "prepayment_balance", "status", "version"
    )
    SELECT
      gen_random_uuid(),
      CASE WHEN gs <= 1500 THEN '${TENANT_A}'::uuid ELSE '${TENANT_B}'::uuid END,
      CASE WHEN gs = 1 THEN '${sampleCustomerId}'::uuid ELSE ('cccccccc-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid END,
      5000000,
      200000,
      0,
      0,
      'ACTIVE',
      1
    FROM generate_series(1, 2000) AS gs;

    -- 2. 10,000 Financial Journals
    INSERT INTO "${schema}"."financial_journals" (
      "id", "tenant_id", "code", "journal_type", "source_type", "source_id",
      "idempotency_key", "branch_id", "currency", "total_debit", "total_credit",
      "status", "posted_by", "posted_at"
    )
    SELECT
      ('eeeeeeee-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
      CASE WHEN gs <= 8000 THEN '${TENANT_A}'::uuid ELSE '${TENANT_B}'::uuid END,
      'JNLB' || lpad(gs::text, 7, '0'),
      'CASHBOOK_RECEIPT',
      'BENCHMARK',
      'bench-src-' || gs::text,
      'bench-jnl-idem-' || gs::text,
      '${BRANCH_A}'::uuid,
      'VND',
      150000,
      150000,
      'POSTED',
      '${ACTOR_ID}'::uuid,
      now() - ((gs % 90) || ' days')::interval
    FROM generate_series(1, 10000) AS gs;

    -- 3. 20,000 Financial Journal Lines
    INSERT INTO "${schema}"."financial_journal_lines" (
      "id", "tenant_id", "journal_id", "line_no", "account_id", "account_code",
      "debit_amount", "credit_amount", "branch_id", "party_type", "party_id"
    )
    SELECT
      gen_random_uuid(),
      CASE WHEN gs <= 8000 THEN '${TENANT_A}'::uuid ELSE '${TENANT_B}'::uuid END,
      ('eeeeeeee-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
      1,
      gen_random_uuid(),
      '1110',
      150000,
      0,
      '${BRANCH_A}'::uuid,
      'CUSTOMER',
      '${sampleCustomerId}'
    FROM generate_series(1, 10000) AS gs
    UNION ALL
    SELECT
      gen_random_uuid(),
      CASE WHEN gs <= 8000 THEN '${TENANT_A}'::uuid ELSE '${TENANT_B}'::uuid END,
      ('eeeeeeee-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
      2,
      gen_random_uuid(),
      '7110',
      0,
      150000,
      '${BRANCH_A}'::uuid,
      'CUSTOMER',
      '${sampleCustomerId}'
    FROM generate_series(1, 10000) AS gs;

    -- 4. 10,000 Cashbook Entries in TENANT_A + 3,000 in TENANT_B
    INSERT INTO "${schema}"."cashbook_entries" (
      "id", "tenant_id", "code", "branch_id", "cash_account_id", "category_id",
      "direction", "voucher_type", "amount", "currency", "status",
      "source_type", "source_id", "journal_id", "idempotency_key",
      "description", "created_by", "posted_by", "posted_at", "created_at"
    )
    SELECT
      gen_random_uuid(),
      CASE WHEN gs <= 10000 THEN '${TENANT_A}'::uuid ELSE '${TENANT_B}'::uuid END,
      'PTB' || lpad(gs::text, 7, '0'),
      '${BRANCH_A}'::uuid,
      '${defaultCashAccountId}'::uuid,
      '${categoryId}'::uuid,
      CASE WHEN gs % 4 = 0 THEN 'EXPENSE' ELSE 'RECEIPT' END,
      'MANUAL',
      ((gs % 50 + 1) * 10000)::bigint,
      'VND',
      'POSTED',
      'BENCHMARK',
      'cb-src-' || gs::text,
      ('eeeeeeee-0000-4000-8000-' || lpad(((gs - 1) % 10000 + 1)::text, 12, '0'))::uuid,
      'bench-cb-idem-' || gs::text,
      'Seeded cashbook entry #' || gs::text,
      '${ACTOR_ID}',
      '${ACTOR_ID}',
      now() - ((gs % 60) || ' days')::interval,
      now() - ((gs % 60) || ' days')::interval
    FROM generate_series(1, 13000) AS gs;

    -- 5. 5,000 Customer Receivables
    INSERT INTO "${schema}"."customer_receivables" (
      "id", "tenant_id", "code", "customer_id", "order_id", "branch_id",
      "original_amount", "paid_amount", "adjusted_amount", "outstanding_amount",
      "currency", "status", "due_date", "source_type", "source_id", "journal_id", "idempotency_key", "created_at"
    )
    SELECT
      ('aaaaaaaa-1111-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
      '${TENANT_A}'::uuid,
      'ARB' || lpad(gs::text, 7, '0'),
      CASE WHEN gs <= 50 THEN '${sampleCustomerId}'::uuid ELSE ('cccccccc-0000-4000-8000-' || lpad(((gs % 1400) + 2)::text, 12, '0'))::uuid END,
      gen_random_uuid(),
      '${BRANCH_A}'::uuid,
      400000,
      200000,
      0,
      200000,
      'VND',
      'PARTIALLY_PAID',
      now() + interval '15 days',
      'SALES_ORDER',
      'bench-order-' || gs::text,
      gen_random_uuid(),
      'bench-ar-idem-' || gs::text,
      now() - ((gs % 45) || ' days')::interval
    FROM generate_series(1, 5000) AS gs;

    -- 6. 10,000 Customer Debt Ledger Entries
    INSERT INTO "${schema}"."customer_debt_ledger" (
      "id", "tenant_id", "customer_id", "receivable_id", "entry_type",
      "amount_delta", "balance_before", "balance_after", "payment_method",
      "journal_id", "reference_type", "reference_id", "idempotency_key", "actor_id", "occurred_at"
    )
    SELECT
      gen_random_uuid(),
      '${TENANT_A}'::uuid,
      CASE WHEN ((gs - 1) / 2 + 1) <= 50 THEN '${sampleCustomerId}'::uuid ELSE ('cccccccc-0000-4000-8000-' || lpad(((((gs - 1) / 2 + 1) % 1400) + 2)::text, 12, '0'))::uuid END,
      ('aaaaaaaa-1111-4000-8000-' || lpad(((gs - 1) / 2 + 1)::text, 12, '0'))::uuid,
      CASE WHEN gs % 2 = 1 THEN 'DEBT_RECOGNIZED' ELSE 'PAYMENT_APPLIED' END,
      CASE WHEN gs % 2 = 1 THEN 400000 ELSE -200000 END,
      CASE WHEN gs % 2 = 1 THEN 0 ELSE 400000 END,
      200000,
      'CASH',
      gen_random_uuid(),
      'BENCHMARK',
      'bench-ar-ref-' || gs::text,
      'bench-ar-ldg-' || gs::text,
      '${ACTOR_ID}',
      now() - ((gs % 45) || ' days')::interval
    FROM generate_series(1, 10000) AS gs;

    -- 7. 2,000 Supplier Payables & 4,000 Supplier Debt Ledger rows
    INSERT INTO "${schema}"."supplier_payables" (
      "id", "tenant_id", "code", "supplier_id", "purchase_order_id", "warehouse_id",
      "original_amount", "paid_amount", "adjusted_amount", "outstanding_amount",
      "currency", "status", "due_date", "source_type", "source_id", "journal_id", "idempotency_key", "created_at"
    )
    SELECT
      ('bbbbbbbb-2222-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
      '${TENANT_A}'::uuid,
      'APB' || lpad(gs::text, 7, '0'),
      CASE WHEN gs <= 30 THEN '${sampleSupplierId}'::uuid ELSE ('dddddddd-0000-4000-8000-' || lpad(((gs % 200) + 2)::text, 12, '0'))::uuid END,
      gen_random_uuid(),
      '${BRANCH_A}'::uuid,
      1000000,
      400000,
      0,
      600000,
      'VND',
      'PARTIALLY_PAID',
      now() + interval '30 days',
      'PURCHASE_ORDER',
      'bench-po-' || gs::text,
      gen_random_uuid(),
      'bench-ap-idem-' || gs::text,
      now() - ((gs % 45) || ' days')::interval
    FROM generate_series(1, 2000) AS gs;

    INSERT INTO "${schema}"."supplier_debt_ledger" (
      "id", "tenant_id", "supplier_id", "payable_id", "entry_type",
      "amount_delta", "balance_before", "balance_after", "payment_method",
      "journal_id", "reference_type", "reference_id", "idempotency_key", "actor_id", "occurred_at"
    )
    SELECT
      gen_random_uuid(),
      '${TENANT_A}'::uuid,
      CASE WHEN ((gs - 1) / 2 + 1) <= 30 THEN '${sampleSupplierId}'::uuid ELSE ('dddddddd-0000-4000-8000-' || lpad(((((gs - 1) / 2 + 1) % 200) + 2)::text, 12, '0'))::uuid END,
      ('bbbbbbbb-2222-4000-8000-' || lpad(((gs - 1) / 2 + 1)::text, 12, '0'))::uuid,
      CASE WHEN gs % 2 = 1 THEN 'PAYABLE_RECOGNIZED' ELSE 'PAYMENT_APPLIED' END,
      CASE WHEN gs % 2 = 1 THEN 1000000 ELSE -400000 END,
      CASE WHEN gs % 2 = 1 THEN 0 ELSE 1000000 END,
      600000,
      'BANK_TRANSFER',
      gen_random_uuid(),
      'BENCHMARK',
      'bench-ap-ref-' || gs::text,
      'bench-ap-ldg-' || gs::text,
      '${ACTOR_ID}',
      now() - ((gs % 45) || ' days')::interval
    FROM generate_series(1, 4000) AS gs;

    -- 8. 5,000 Payment Settlements & 3,000 COD Receivables
    INSERT INTO "${schema}"."payment_settlements" (
      "id", "tenant_id", "code", "order_id", "branch_id", "tender_ref",
      "payment_method", "provider", "external_tx_id",
      "requested_amount", "confirmed_amount", "settled_amount", "refunded_amount",
      "currency", "provider_status", "settlement_status", "idempotency_key", "settled_at"
    )
    SELECT
      gen_random_uuid(),
      '${TENANT_A}'::uuid,
      'STLB' || lpad(gs::text, 7, '0'),
      ('cccccccc-3333-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
      '${BRANCH_A}'::uuid,
      'bench-tender-' || gs::text,
      'EWALLET',
      'VNPAY',
      'VNP-BENCH-' || gs::text,
      300000,
      300000,
      300000,
      0,
      'VND',
      'CONFIRMED',
      'SETTLED',
      'bench-stl-idem-' || gs::text,
      now() - ((gs % 30) || ' days')::interval
    FROM generate_series(1, 5000) AS gs;

    INSERT INTO "${schema}"."cod_receivables" (
      "id", "tenant_id", "code", "order_id", "fulfillment_id", "branch_id", "carrier_code",
      "tracking_number", "expected_cod_amount", "carrier_fee_amount",
      "actual_remitted_amount", "discrepancy_amount", "status"
    )
    SELECT
      gen_random_uuid(),
      '${TENANT_A}'::uuid,
      'CODB' || lpad(gs::text, 7, '0'),
      gen_random_uuid(),
      gen_random_uuid(),
      '${BRANCH_A}'::uuid,
      'GHN',
      'GHN-BENCH-' || lpad(gs::text, 7, '0'),
      350000,
      15000,
      335000,
      0,
      'RECONCILED'
    FROM generate_series(1, 3000) AS gs;
  `);

  // Sync document sequences so subsequent inserts do not collide with seeded codes
  await dataSource.query(
    `
    INSERT INTO "${schema}"."finance_code_sequence" ("id", "tenant_id", "seq_key", "last_value")
    VALUES
      (gen_random_uuid(), $1, 'JNL', 20000),
      (gen_random_uuid(), $1, 'PT', 20000),
      (gen_random_uuid(), $1, 'PC', 20000),
      (gen_random_uuid(), $1, 'AR', 20000),
      (gen_random_uuid(), $1, 'AP', 20000),
      (gen_random_uuid(), $1, 'STL', 20000),
      (gen_random_uuid(), $1, 'COD', 20000),
      (gen_random_uuid(), $1, 'CRD', 20000),
      (gen_random_uuid(), $1, 'RFD', 20000)
    ON CONFLICT ("tenant_id", "seq_key")
    DO UPDATE SET "last_value" = GREATEST("${schema}"."finance_code_sequence"."last_value", 20000);
    `,
    [TENANT_A],
  );

  await dataSource.query(`ANALYZE "${schema}"."customer_credit_profiles"`);
  await dataSource.query(`ANALYZE "${schema}"."financial_journals"`);
  await dataSource.query(`ANALYZE "${schema}"."financial_journal_lines"`);
  await dataSource.query(`ANALYZE "${schema}"."cashbook_entries"`);
  await dataSource.query(`ANALYZE "${schema}"."customer_receivables"`);
  await dataSource.query(`ANALYZE "${schema}"."customer_debt_ledger"`);
  await dataSource.query(`ANALYZE "${schema}"."supplier_payables"`);
  await dataSource.query(`ANALYZE "${schema}"."supplier_debt_ledger"`);
  await dataSource.query(`ANALYZE "${schema}"."payment_settlements"`);
  await dataSource.query(`ANALYZE "${schema}"."cod_receivables"`);

  const seedElapsedMs = Number((performance.now() - seedStart).toFixed(2));
  console.log(
    `Seeded 68,000+ Finance rows across 10 tables in ${seedElapsedMs} ms`,
  );

  console.log('\n=== EXPLAIN (ANALYZE, BUFFERS) FOR CRITICAL QUERIES ===');

  const explainQueries: Array<{
    name: string;
    sql: string;
    params: unknown[];
  }> = [
    {
      name: '1. Cashbook Branch + Date Range Pagination',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
            SELECT "id", "code", "direction", "amount", "status", "created_at"
            FROM "${schema}"."cashbook_entries"
            WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "status" = 'POSTED'
            ORDER BY "created_at" DESC
            LIMIT 20 OFFSET 0`,
      params: [TENANT_A, BRANCH_A],
    },
    {
      name: '2. Cashbook Account Balance & Inflow/Outflow Summary',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
            SELECT
              COALESCE(SUM(CASE WHEN "direction" = 'RECEIPT' THEN "amount" ELSE 0 END), 0) AS "inflow",
              COALESCE(SUM(CASE WHEN "direction" = 'EXPENSE' THEN "amount" ELSE 0 END), 0) AS "outflow",
              COUNT(*)::int AS "posted_count"
            FROM "${schema}"."cashbook_entries"
            WHERE "tenant_id" = $1 AND "cash_account_id" = $2 AND "status" = 'POSTED'`,
      params: [TENANT_A, defaultCashAccountId],
    },
    {
      name: '3. Customer Credit Profile Lookup (Pessimistic Lock Path)',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
            SELECT "id", "credit_limit", "posted_debt", "held_credit", "prepayment_balance"
            FROM "${schema}"."customer_credit_profiles"
            WHERE "tenant_id" = $1 AND "customer_id" = $2`,
      params: [TENANT_A, sampleCustomerId],
    },
    {
      name: '4. Customer Debt Ledger Statement Pagination',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
            SELECT "id", "receivable_id", "entry_type", "amount_delta", "balance_before", "balance_after", "occurred_at"
            FROM "${schema}"."customer_debt_ledger"
            WHERE "tenant_id" = $1 AND "customer_id" = $2
            ORDER BY "occurred_at" DESC, "id" DESC
            LIMIT 50`,
      params: [TENANT_A, sampleCustomerId],
    },
    {
      name: '5. Supplier Open Payables & Debt Statement Lookup',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
            SELECT "id", "code", "original_amount", "paid_amount", "outstanding_amount", "status"
            FROM "${schema}"."supplier_payables"
            WHERE "tenant_id" = $1 AND "supplier_id" = $2 AND "status" IN ('OPEN', 'PARTIALLY_PAID')
            ORDER BY "created_at" DESC`,
      params: [TENANT_A, sampleSupplierId],
    },
    {
      name: '6. COD Receivable Tracking Number Lookup',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
            SELECT "id", "code", "order_id", "expected_cod_amount", "actual_remitted_amount", "status"
            FROM "${schema}"."cod_receivables"
            WHERE "tenant_id" = $1 AND "carrier_code" = 'GHN' AND "tracking_number" = 'GHN-BENCH-0001500'`,
      params: [TENANT_A],
    },
  ];

  for (const q of explainQueries) {
    console.log(`\n--- ${q.name} ---`);
    const planRows: Array<{ 'QUERY PLAN': string }> = await dataSource.query(
      q.sql,
      q.params,
    );
    for (const r of planRows) {
      console.log(r['QUERY PLAN']);
    }
  }

  console.log('\n=== LATENCY BENCHMARKS (100 ITERATIONS EACH) ===');

  // 1. Credit authorization check (target < 80ms p95)
  const creditAuthSamples: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    const cid = `cccccccc-0000-4000-8000-${String(i + 100).padStart(12, '0')}`;
    const t0 = performance.now();
    await runAsTenant(TENANT_A, () =>
      creditAuthService.authorizeCredit(
        ACTOR_ID,
        `bench-crd-lat:${i}`,
        {
          customerId: cid,
          orderId: randomUUID(),
          branchId: BRANCH_A,
          amount: 100000,
        },
        TENANT_A,
      ),
    );
    creditAuthSamples.push(performance.now() - t0);
  }

  // 2. Cashbook voucher creation & posting (target < 120ms p95)
  const cashbookPostSamples: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    const t0 = performance.now();
    await runAsTenant(TENANT_A, () =>
      cashbookService.createReceiptVoucher(
        ACTOR_ID,
        `bench-cb-post:${i}`,
        {
          cashAccountId: defaultCashAccountId,
          branchId: BRANCH_A,
          categoryCode: 'BENCH_RECEIPT',
          amount: 50000,
          description: `Benchmark receipt #${i}`,
          autoPost: true,
        },
        TENANT_A,
      ),
    );
    cashbookPostSamples.push(performance.now() - t0);
  }

  // 3. Customer debt summary & statement query (target < 100ms p95)
  const customerDebtQuerySamples: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    const t0 = performance.now();
    await runAsTenant(TENANT_A, () =>
      receivablesService.getCustomerDebtSummary(sampleCustomerId, TENANT_A),
    );
    customerDebtQuerySamples.push(performance.now() - t0);
  }

  // 4. Supplier debt summary & statement query (target < 100ms p95)
  const supplierDebtQuerySamples: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    const t0 = performance.now();
    await runAsTenant(TENANT_A, () =>
      payablesService.getSupplierDebtSummary(sampleSupplierId, TENANT_A),
    );
    supplierDebtQuerySamples.push(performance.now() - t0);
  }

  // 5. Cashbook list & account balance query (target < 120ms p95)
  const cashbookQuerySamples: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    const t0 = performance.now();
    await runAsTenant(TENANT_A, async () => {
      await cashbookService.listEntries(
        { branchId: BRANCH_A, limit: '20', offset: String((i % 10) * 20) },
        TENANT_A,
      );
      await cashAccountsService.listCashAccounts(
        { branchId: BRANCH_A },
        TENANT_A,
      );
    });
    cashbookQuerySamples.push(performance.now() - t0);
  }

  // 6. Receivable payment allocation (target < 150ms p95)
  const receivablePaySamples: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    const recId = `aaaaaaaa-1111-4000-8000-${String(i + 200).padStart(12, '0')}`;
    const t0 = performance.now();
    await runAsTenant(TENANT_A, () =>
      receivablesService.recordReceivablePayment(
        recId,
        null,
        ACTOR_ID,
        `bench-ar-pay:${i}`,
        {
          amount: 50000,
          paymentMethod: 'CASH',
          cashAccountId: defaultCashAccountId,
        },
        TENANT_A,
      ),
    );
    receivablePaySamples.push(performance.now() - t0);
  }

  const latencySummary = {
    creditAuthorization: {
      ...computeStats(creditAuthSamples),
      targetP95Ms: 80,
    },
    cashbookVoucherPost: {
      ...computeStats(cashbookPostSamples),
      targetP95Ms: 120,
    },
    customerDebtStatementQuery: {
      ...computeStats(customerDebtQuerySamples),
      targetP95Ms: 100,
    },
    supplierDebtStatementQuery: {
      ...computeStats(supplierDebtQuerySamples),
      targetP95Ms: 100,
    },
    cashbookListAndSummaryQuery: {
      ...computeStats(cashbookQuerySamples),
      targetP95Ms: 120,
    },
    receivablePaymentAllocation: {
      ...computeStats(receivablePaySamples),
      targetP95Ms: 150,
    },
  };

  console.table(latencySummary);

  console.log('\n=== HIGH-CONCURRENCY CONTENTION BENCHMARKS ===');

  // Contention 1: 100 concurrent credit authorization requests of 100,000 VND against 1,000,000 VND credit limit
  const hotCreditCustomerId = randomUUID();
  await runAsTenant(TENANT_A, () =>
    creditAuthService.updateCreditLimit(
      hotCreditCustomerId,
      { creditLimit: 1000000 },
      TENANT_A,
    ),
  );
  const c1Start = performance.now();
  const c1Results = await Promise.allSettled(
    Array.from({ length: 100 }, (_, idx) =>
      runAsTenant(TENANT_A, () =>
        creditAuthService.authorizeCredit(
          ACTOR_ID,
          `cont-crd-100:${idx}`,
          {
            customerId: hotCreditCustomerId,
            orderId: randomUUID(),
            branchId: BRANCH_A,
            amount: 100000,
          },
          TENANT_A,
        ),
      ),
    ),
  );
  const c1WallMs = Number((performance.now() - c1Start).toFixed(2));
  const c1Success = c1Results.filter((r) => r.status === 'fulfilled').length;
  const c1Rejected = c1Results.filter((r) => r.status === 'rejected').length;
  const c1Profile = await runAsTenant(TENANT_A, () =>
    creditAuthService.getCreditProfile(hotCreditCustomerId, TENANT_A),
  );

  // Contention 2: 50 concurrent customer debt payments of 100,000 VND against a 1,000,000 VND receivable
  const hotDebtCustomerId = randomUUID();
  const hotRec = await runAsTenant(TENANT_A, () =>
    receivablesService.recognizeReceivable(
      ACTOR_ID,
      `cont-ar:${hotDebtCustomerId}`,
      {
        customerId: hotDebtCustomerId,
        orderId: randomUUID(),
        branchId: BRANCH_A,
        amount: 1000000,
      },
      TENANT_A,
    ),
  );
  const c2Start = performance.now();
  const c2Results = await Promise.allSettled(
    Array.from({ length: 50 }, (_, idx) =>
      runAsTenant(TENANT_A, () =>
        receivablesService.recordReceivablePayment(
          hotRec.id,
          null,
          ACTOR_ID,
          `cont-ar-pay-50:${idx}`,
          {
            amount: 100000,
            paymentMethod: 'CASH',
            cashAccountId: defaultCashAccountId,
            overpaymentPolicy: 'REJECT',
          },
          TENANT_A,
        ),
      ),
    ),
  );
  const c2WallMs = Number((performance.now() - c2Start).toFixed(2));
  const c2Success = c2Results.filter((r) => r.status === 'fulfilled').length;
  const c2Rejected = c2Results.filter((r) => r.status === 'rejected').length;
  const hotRecAfter = await runAsTenant(TENANT_A, () =>
    receivablesService.getReceivableById(hotRec.id, TENANT_A),
  );

  // Contention 3: 50 concurrent partial refund requests of 100,000 VND against a 500,000 VND settled order
  const hotRefundOrderId = randomUUID();
  await runAsTenant(TENANT_A, () =>
    settlementsService.confirmSettlement(
      ACTOR_ID,
      `cont-stl:${hotRefundOrderId}`,
      {
        orderId: hotRefundOrderId,
        branchId: BRANCH_A,
        tenderRef: `tender:${hotRefundOrderId}`,
        paymentMethod: 'EWALLET',
        provider: 'VNPAY',
        requestedAmount: 500000,
        confirmedAmount: 500000,
        settledAmount: 500000,
      },
      TENANT_A,
    ),
  );
  const c3Start = performance.now();
  const c3Results = await Promise.allSettled(
    Array.from({ length: 50 }, (_, idx) =>
      runAsTenant(TENANT_A, () =>
        refundsService.createRefund(
          ACTOR_ID,
          `cont-rf-50:${idx}`,
          {
            orderId: hotRefundOrderId,
            branchId: BRANCH_A,
            method: 'EWALLET',
            provider: 'VNPAY',
            amount: 100000,
            autoApprove: true,
          },
          TENANT_A,
        ),
      ),
    ),
  );
  const c3WallMs = Number((performance.now() - c3Start).toFixed(2));
  const c3Success = c3Results.filter((r) => r.status === 'fulfilled').length;
  const c3Rejected = c3Results.filter((r) => r.status === 'rejected').length;

  console.table({
    creditHold100WayContention: {
      concurrency: 100,
      succeeded: c1Success,
      rejected: c1Rejected,
      heldCreditAfter: c1Profile.heldCredit,
      availableCreditAfter: c1Profile.availableCredit,
      wallTimeMs: c1WallMs,
    },
    receivablePayment50WayContention: {
      concurrency: 50,
      succeeded: c2Success,
      rejected: c2Rejected,
      paidAmountAfter: hotRecAfter.paidAmount,
      outstandingAmountAfter: hotRecAfter.outstandingAmount,
      statusAfter: hotRecAfter.status,
      wallTimeMs: c2WallMs,
    },
    refundCap50WayContention: {
      concurrency: 50,
      succeeded: c3Success,
      rejected: c3Rejected,
      wallTimeMs: c3WallMs,
    },
  });

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
