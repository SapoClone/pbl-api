import * as fs from 'node:fs';
import * as path from 'node:path';

const INTEGRATION_SRC = path.resolve(__dirname);

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('M6 Integration Microservice Architecture & Ownership Guardrails', () => {
  const allFiles = collectTsFiles(INTEGRATION_SRC);

  it('never imports from other microservice app directories (sales, inventory, catalog, finance, customer, platform)', () => {
    const forbiddenApps = [
      'apps/sales',
      'apps/inventory',
      'apps/catalog',
      'apps/finance',
      'apps/customer',
      'apps/platform',
    ];
    const violations: string[] = [];

    for (const file of allFiles) {
      if (file.endsWith('.spec.ts')) continue;
      const content = fs.readFileSync(file, 'utf8');
      for (const forbidden of forbiddenApps) {
        if (content.includes(forbidden)) {
          violations.push(
            `${path.relative(INTEGRATION_SRC, file)} -> ${forbidden}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('never executes direct SQL against Sales, Inventory, Catalog, or Finance tables', () => {
    const forbiddenTables = [
      'sales_orders',
      'order_items',
      'warehouse_stock_balances',
      'stock_reservations',
      'product_variants',
      'financial_journals',
      'payment_settlements',
    ];
    const violations: string[] = [];

    for (const file of allFiles) {
      if (file.endsWith('.spec.ts')) continue;
      const content = fs.readFileSync(file, 'utf8');
      for (const tbl of forbiddenTables) {
        const regex = new RegExp(
          `\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+.*${tbl}`,
          'i',
        );
        if (regex.test(content)) {
          violations.push(
            `${path.relative(INTEGRATION_SRC, file)} mutates ${tbl}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('isolates Shopee and Lazada provider-specific signing and webhook verification inside providers/shopee and providers/lazada', () => {
    const moduleFiles = allFiles.filter((f) =>
      f.includes(`${path.sep}modules${path.sep}`),
    );
    const violations: string[] = [];

    for (const file of moduleFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (
        content.includes('computeShopee') ||
        content.includes('verifyShopee') ||
        content.includes('computeLazada') ||
        content.includes('verifyLazada')
      ) {
        violations.push(
          `${path.relative(INTEGRATION_SRC, file)} contains provider-specific signing logic outside providers/*`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it('enforces PostgreSQL Row-Level Security (enableTenantRlsPolicy) on all 17 M6 Integration tables', () => {
    const migrationPath = path.join(
      INTEGRATION_SRC,
      'migrations',
      '1791900000200-create-m6-integration-core.ts',
    );
    const content = fs.readFileSync(migrationPath, 'utf8');
    const rlsCalls = content.match(/await enableTenantRlsPolicy\(/g) ?? [];
    expect(rlsCalls.length).toBe(17);
  });
});
