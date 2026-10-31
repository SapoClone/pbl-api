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

describe('Customer M4 — Architecture & Boundary Guardrails', () => {
  const customerSrcDir = __dirname;
  const allCustomerFiles = collectTsFiles(customerSrcDir).filter(
    (f) => !f.endsWith('.spec.ts'),
  );

  it('keeps customer-domain.ts 100% pure TypeScript with zero NestJS or TypeORM imports', () => {
    const domainFile = path.join(
      customerSrcDir,
      'domain',
      'customer-domain.ts',
    );
    const content = fs.readFileSync(domainFile, 'utf8');
    expect(content).not.toMatch(/from\s+['"]@nestjs\//);
    expect(content).not.toMatch(/from\s+['"]typeorm['"]/);
    expect(content).not.toMatch(/from\s+['"]axios['"]/);
  });

  it('never imports code from other microservice apps (sales, finance, catalog, inventory, platform, integration, insight)', () => {
    const forbiddenImport =
      /from\s+['"][^'"]*apps\/(sales|finance|catalog|inventory|platform|integration|insight)/;
    for (const file of allCustomerFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(forbiddenImport);
    }
  });

  it('never executes cross-schema SQL against sales, finance, catalog, inventory, platform, integration, or insight schemas', () => {
    const crossSchemaSqlRegex =
      /\b(FROM|JOIN|UPDATE|INTO|TABLE)\s+["']?(sales|finance|catalog|inventory|platform|integration|insight)["']?\.\s*["']?[a-z_]|["'](sales|finance|catalog|inventory|platform|integration|insight)["']\.\s*["'][a-z_]/i;
    for (const file of allCustomerFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(crossSchemaSqlRegex);
    }
  });

  it('enables PostgreSQL Row-Level Security (enableTenantRlsPolicy) on all 14 Customer tables in migration 1791900000200', () => {
    const migrationFile = path.join(
      customerSrcDir,
      'migrations',
      '1791900000200-create-m4-customer-core.ts',
    );
    const content = fs.readFileSync(migrationFile, 'utf8');
    const requiredRlsTables = [
      'codeSeq',
      'groups',
      'tiers',
      'customers',
      'addresses',
      'loyaltySettings',
      'loyaltyAccounts',
      'loyaltyTx',
      'loyaltyHolds',
      'purchaseProj',
      'mergeHistory',
      'dataJobs',
      'tags',
      'tagLinks',
    ];
    for (const tableVar of requiredRlsTables) {
      expect(content).toContain(
        `enableTenantRlsPolicy(queryRunner, ${tableVar})`,
      );
    }
  });
});
