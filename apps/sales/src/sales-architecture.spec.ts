import * as fs from 'node:fs';
import * as path from 'node:path';

function collectTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('Sales M3 — Architecture & Boundary Guardrails', () => {
  const salesSrcDir = __dirname;
  const allSalesFiles = collectTsFiles(salesSrcDir).filter(
    (f) => !f.endsWith('.spec.ts'),
  );

  it('keeps sales-domain.ts 100% pure TypeScript with zero NestJS or TypeORM imports', () => {
    const domainFile = path.join(salesSrcDir, 'domain', 'sales-domain.ts');
    const content = fs.readFileSync(domainFile, 'utf8');
    expect(content).not.toMatch(/from\s+['"]@nestjs\//);
    expect(content).not.toMatch(/from\s+['"]typeorm['"]/);
    expect(content).not.toMatch(/from\s+['"]axios['"]/);
  });

  it('never imports code from other microservice apps (catalog, inventory, platform, finance, customer)', () => {
    const forbiddenImport =
      /from\s+['"][^'"]*apps\/(catalog|inventory|platform|finance|customer|integration|insight)/;
    for (const file of allSalesFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(forbiddenImport);
    }
  });

  it('never executes cross-schema SQL against platform, catalog, inventory, finance, customer, integration, or insight schemas', () => {
    const crossSchemaSqlRegex =
      /\b(FROM|JOIN|UPDATE|INTO|TABLE)\s+["']?(platform|catalog|inventory|finance|customer|integration|insight)["']?\.\s*["']?[a-z_]|["'](platform|catalog|inventory|finance|customer|integration|insight)["']\.\s*["'][a-z_]/i;
    for (const file of allSalesFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(crossSchemaSqlRegex);
    }
  });

  it('enables PostgreSQL Row-Level Security (enableTenantRlsPolicy) on all M3 Sales tables in migration 1791900000200', () => {
    const migrationFile = path.join(
      salesSrcDir,
      'migrations',
      '1791900000200-create-m3-sales-core.ts',
    );
    const content = fs.readFileSync(migrationFile, 'utf8');
    const requiredRlsTables = [
      'orders',
      'orderItems',
      'branchProjection',
      ' codeSeq',
      'catalogProjection',
      'statusHistory',
      'shifts',
      'drafts',
      'tenders',
      'returns',
      'returnItems',
      'refundRequests',
      'fulfillments',
      'fulfillmentItems',
      'promotions',
      'coupons',
      'couponUsages',
    ];
    for (const tableVar of requiredRlsTables) {
      expect(content).toContain(
        `enableTenantRlsPolicy(queryRunner,${tableVar.startsWith(' ') ? tableVar : ` ${tableVar}`})`,
      );
    }
  });
});
