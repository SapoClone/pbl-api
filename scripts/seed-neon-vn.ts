import * as argon2 from 'argon2';
import * as path from 'node:path';
import { Client } from 'pg';
import {
  IDS,
  ServiceName,
  createServiceClient,
  loadServiceConfigs,
  withTenant,
} from './seed-neon/helpers';
import {
  seedFinance,
  seedInsight,
  seedIntegration,
} from './seed-neon/seed-finance-integration-insight';
import { seedInventory, seedSales } from './seed-neon/seed-inventory-sales';
import {
  seedCatalog,
  seedCustomer,
  seedPlatform,
} from './seed-neon/seed-platform-catalog-customer';

async function verifyAllSchemas(
  clients: Record<ServiceName, Client>,
): Promise<void> {
  console.log(
    '\n====================================================================',
  );
  console.log(' KIỂM TRA DỮ LIỆU & TOÀN VẸN HỆ THỐNG TRÊN NEON DB (8 SCHEMAS)');
  console.log(
    '====================================================================',
  );

  // 1. Platform (public)
  const p = clients.platform;
  const pCounts = await p.query(`
    SELECT
      (SELECT COUNT(*) FROM public.plan)::int AS plans,
      (SELECT COUNT(*) FROM public.platform_admin)::int AS admins,
      (SELECT COUNT(*) FROM public.tenant)::int AS tenants,
      (SELECT COUNT(*) FROM public.subscription)::int AS subscriptions,
      (SELECT COUNT(*) FROM public.branch)::int AS branches,
      (SELECT COUNT(*) FROM public.role)::int AS roles,
      (SELECT COUNT(*) FROM public.account)::int AS accounts,
      (SELECT COUNT(*) FROM public.staff_schedule)::int AS schedules
  `);
  console.log('1. [platform / public]     :', JSON.stringify(pCounts.rows[0]));

  // Verify Argon2 password for Owner account
  const ownerRow = await p.query(
    `SELECT email, password FROM public.account WHERE email = 'chu.cuahang@vietfashion.vn'`,
  );
  const pwValid = await argon2.verify(
    ownerRow.rows[0].password,
    'Password@123',
  );
  if (!pwValid) {
    throw new Error(
      'Argon2 password verification failed for chu.cuahang@vietfashion.vn',
    );
  }

  // 2. Catalog
  await withTenant(clients.catalog, IDS.tenant1, async (c) => {
    const res = await c.query(`
      SELECT
        (SELECT COUNT(*) FROM catalog.categories)::int AS categories,
        (SELECT COUNT(*) FROM catalog.brands)::int AS brands,
        (SELECT COUNT(*) FROM catalog.products)::int AS products,
        (SELECT COUNT(*) FROM catalog.product_variants)::int AS variants,
        (SELECT COUNT(*) FROM catalog.price_lists)::int AS price_lists,
        (SELECT COUNT(*) FROM catalog.price_list_items)::int AS price_items
    `);
    console.log('2. [catalog / catalog]     :', JSON.stringify(res.rows[0]));
  });

  // 3. Customer
  await withTenant(clients.customer, IDS.tenant1, async (c) => {
    const res = await c.query(`
      SELECT
        (SELECT COUNT(*) FROM customer.customer_groups)::int AS groups,
        (SELECT COUNT(*) FROM customer.membership_tiers)::int AS tiers,
        (SELECT COUNT(*) FROM customer.customers)::int AS customers,
        (SELECT COUNT(*) FROM customer.loyalty_accounts)::int AS loyalty_accounts,
        (SELECT COUNT(*) FROM customer.customer_purchase_projections)::int AS purchase_projections
    `);
    console.log('3. [customer / customer]   :', JSON.stringify(res.rows[0]));
  });

  // 4. Inventory
  await withTenant(clients.inventory, IDS.tenant1, async (c) => {
    const res = await c.query(`
      SELECT
        (SELECT COUNT(*) FROM inventory.warehouse)::int AS warehouses,
        (SELECT COUNT(*) FROM inventory.supplier)::int AS suppliers,
        (SELECT COUNT(*) FROM inventory.purchase_order)::int AS purchase_orders,
        (SELECT COUNT(*) FROM inventory.stock_receipt)::int AS stock_receipts,
        (SELECT COUNT(*) FROM inventory.stock_transfer)::int AS stock_transfers,
        (SELECT COUNT(*) FROM inventory.stock_balance)::int AS stock_balances,
        (SELECT COUNT(*) FROM inventory.stock_balance_ledger)::int AS ledger_entries
    `);
    console.log('4. [inventory / inventory] :', JSON.stringify(res.rows[0]));
  });

  // 5. Sales
  await withTenant(clients.sales, IDS.tenant1, async (c) => {
    const res = await c.query(`
      SELECT
        (SELECT COUNT(*) FROM sales.sales_channels)::int AS channels,
        (SELECT COUNT(*) FROM sales.pos_shifts)::int AS pos_shifts,
        (SELECT COUNT(*) FROM sales.orders)::int AS orders,
        (SELECT COUNT(*) FROM sales.order_items)::int AS order_items,
        (SELECT COUNT(*) FROM sales.order_fulfillments)::int AS fulfillments,
        (SELECT COUNT(*) FROM sales.sales_returns)::int AS returns
    `);
    console.log('5. [sales / sales]         :', JSON.stringify(res.rows[0]));
  });

  // 6. Finance
  await withTenant(clients.finance, IDS.tenant1, async (c) => {
    const res = await c.query(`
      SELECT
        (SELECT COUNT(*) FROM finance.financial_accounts)::int AS coa_accounts,
        (SELECT COUNT(*) FROM finance.cash_accounts)::int AS cash_accounts,
        (SELECT COUNT(*) FROM finance.financial_journals)::int AS journals,
        (SELECT COUNT(*) FROM finance.cashbook_entries)::int AS cashbook_entries,
        (SELECT COUNT(*) FROM finance.customer_receivables)::int AS receivables,
        (SELECT COUNT(*) FROM finance.supplier_payables)::int AS payables,
        (SELECT COUNT(*) FROM finance.cod_settlement_batches)::int AS cod_batches
    `);
    console.log('6. [finance / finance]     :', JSON.stringify(res.rows[0]));

    // Verify balanced double-entry journals
    const unbalanced = await c.query(`
      SELECT j.code, j.total_debit, j.total_credit,
             SUM(l.debit_amount) AS lines_debit, SUM(l.credit_amount) AS lines_credit
      FROM finance.financial_journals j
      JOIN finance.financial_journal_lines l ON l.journal_id = j.id
      GROUP BY j.id, j.code, j.total_debit, j.total_credit
      HAVING j.total_debit <> j.total_credit
          OR j.total_debit <> SUM(l.debit_amount)
          OR j.total_credit <> SUM(l.credit_amount)
    `);
    if (unbalanced.rowCount && unbalanced.rowCount > 0) {
      throw new Error(
        `Unbalanced journals detected: ${JSON.stringify(unbalanced.rows)}`,
      );
    }
  });

  // 7. Integration
  await withTenant(clients.integration, IDS.tenant1, async (c) => {
    const res = await c.query(`
      SELECT
        (SELECT COUNT(*) FROM integration.channel_connections)::int AS connections,
        (SELECT COUNT(*) FROM integration.connection_credentials)::int AS credentials,
        (SELECT COUNT(*) FROM integration.sku_mappings)::int AS sku_mappings,
        (SELECT COUNT(*) FROM integration.channel_inventory_publications)::int AS inv_publications,
        (SELECT COUNT(*) FROM integration.channel_order_refs)::int AS order_refs
    `);
    console.log('7. [integration]           :', JSON.stringify(res.rows[0]));
  });

  // 8. Insight
  await withTenant(clients.insight, IDS.tenant1, async (c) => {
    const res = await c.query(`
      SELECT
        (SELECT COUNT(*) FROM insight.insight_dimension_caches)::int AS dimension_caches,
        (SELECT COUNT(*) FROM insight.sales_order_facts)::int AS order_facts,
        (SELECT COUNT(*) FROM insight.daily_sales_summaries)::int AS daily_summaries,
        (SELECT COUNT(*) FROM insight.product_sales_summaries)::int AS product_summaries,
        (SELECT COUNT(*) FROM insight.inventory_stock_projections)::int AS stock_projections,
        (SELECT COUNT(*) FROM insight.notification)::int AS notifications
    `);
    console.log('8. [insight / insight]     :', JSON.stringify(res.rows[0]));
  });

  // 9. Verify RLS Isolation (without app.tenant_id set, RLS must return 0 rows)
  const rlsLeak = await clients.catalog.query(
    `SELECT COUNT(*)::int AS cnt FROM catalog.products`,
  );
  if (rlsLeak.rows[0].cnt !== 0) {
    throw new Error(
      `RLS leak detected on catalog.products: expected 0 without tenant_id, got ${rlsLeak.rows[0].cnt}`,
    );
  }
  console.log(
    '\n[OK] Kiểm tra bảo mật RLS (FORCE ROW LEVEL SECURITY): Đạt 100%',
  );
  console.log(
    '[OK] Kiểm tra cân đối kế toán kép (SUM Nợ = SUM Có)  : Đạt 100%',
  );
  console.log(
    '[OK] Kiểm tra xác thực Argon2 (Password@123)         : Đạt 100%',
  );
}

async function withService<T>(
  cfg: ReturnType<typeof loadServiceConfigs>['configs'][ServiceName],
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await createServiceClient(cfg);
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const verifyOnly = process.argv.includes('--verify-only');
  const { configs, masterKey } = loadServiceConfigs(rootDir);

  console.log(
    '====================================================================',
  );
  console.log(' KIỂM TRA KẾT NỐI NEON DB (.env.neon) CHO 8 MICROSERVICES');
  console.log(
    '====================================================================',
  );

  const serviceOrder: ServiceName[] = [
    'platform',
    'catalog',
    'customer',
    'inventory',
    'sales',
    'finance',
    'integration',
    'insight',
  ];

  // 1. Parallel connectivity check across all 8 roles
  await Promise.all(
    serviceOrder.map(async (svc) => {
      await withService(configs[svc], async (client) => {
        const info = await client.query(
          `SELECT current_user AS usr, current_schema() AS sch, version() AS ver`,
        );
        console.log(
          `  [CONNECTED] ${svc.padEnd(12)} | role=${info.rows[0].usr.padEnd(16)} | schema=${info.rows[0].sch}`,
        );
      });
    }),
  );

  if (!verifyOnly) {
    console.log(
      '\n====================================================================',
    );
    console.log(' BẮT ĐẦU SEED DỮ LIỆU TIẾNG VIỆT CHUẨN LÊN NEON DB');
    console.log(
      '====================================================================',
    );

    console.log('  -> [1/8] Seeding schema public (platform)...');
    await withService(configs.platform, (c) => seedPlatform(c));

    console.log('  -> [2/8] Seeding schema catalog (catalog)...');
    await withService(configs.catalog, (c) => seedCatalog(c));

    console.log('  -> [3/8] Seeding schema customer (customer)...');
    await withService(configs.customer, (c) => seedCustomer(c));

    console.log('  -> [4/8] Seeding schema inventory (inventory)...');
    await withService(configs.inventory, (c) => seedInventory(c));

    console.log(
      '  -> [5/8] Seeding schema sales (sales + customer purchase projections)...',
    );
    await withService(configs.sales, async (salesClient) => {
      await withService(configs.customer, async (custClient) => {
        await seedSales(salesClient, custClient);
      });
    });

    console.log('  -> [6/8] Seeding schema finance (finance)...');
    await withService(configs.finance, (c) => seedFinance(c));

    console.log('  -> [7/8] Seeding schema integration (integration)...');
    await withService(configs.integration, (c) =>
      seedIntegration(c, masterKey),
    );

    console.log('  -> [8/8] Seeding schema insight (insight)...');
    await withService(configs.insight, (c) => seedInsight(c));

    console.log(
      '\n[HOÀN TẤT] Đã seed thành công toàn bộ 8 schema trên Neon DB!',
    );
  }

  // Open fresh connections for fast verification
  const clients = {} as Record<ServiceName, Client>;
  try {
    await Promise.all(
      serviceOrder.map(async (svc) => {
        clients[svc] = await createServiceClient(configs[svc]);
      }),
    );
    await verifyAllSchemas(clients);
  } finally {
    await Promise.all(
      serviceOrder.map(async (svc) => {
        if (clients[svc]) {
          await clients[svc].end().catch(() => undefined);
        }
      }),
    );
  }
}

main().catch((err) => {
  console.error('\n[LỖI KHI CHẠY SEED NEON DB]:', err);
  process.exit(1);
});
