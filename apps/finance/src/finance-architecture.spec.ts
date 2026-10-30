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

describe('Finance M5 — Architecture & Boundary Guardrails', () => {
  const financeSrcDir = __dirname;
  const allFinanceFiles = collectTsFiles(financeSrcDir).filter(
    (f) => !f.endsWith('.spec.ts'),
  );

  it('keeps finance-domain.ts 100% pure TypeScript with zero NestJS, TypeORM, or HTTP client imports', () => {
    const domainFile = path.join(financeSrcDir, 'domain', 'finance-domain.ts');
    const content = fs.readFileSync(domainFile, 'utf8');
    expect(content).not.toMatch(/from\s+['"]@nestjs\//);
    expect(content).not.toMatch(/from\s+['"]typeorm['"]/);
    expect(content).not.toMatch(/from\s+['"]axios['"]/);
  });

  it('never imports code from other microservice apps (sales, customer, catalog, inventory, platform, integration, insight)', () => {
    const forbiddenImport =
      /from\s+['"][^'"]*apps\/(sales|customer|catalog|inventory|platform|integration|insight)/;
    for (const file of allFinanceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(forbiddenImport);
    }
  });

  it('never executes cross-schema SQL against sales, customer, catalog, inventory, platform, integration, or insight schemas', () => {
    const crossSchemaSqlRegex =
      /\b(FROM|JOIN|UPDATE|INTO|TABLE)\s+["']?(sales|customer|catalog|inventory|platform|integration|insight)["']?\.\s*["']?[a-z_]|["'](sales|customer|catalog|inventory|platform|integration|insight)["']\.\s*["'][a-z_]/i;
    for (const file of allFinanceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(crossSchemaSqlRegex);
    }
  });

  it('enables PostgreSQL Row-Level Security (enableTenantRlsPolicy) on all 22 M5 Finance tables and installs journal immutability triggers in migration 1791900000200', () => {
    const migrationFile = path.join(
      financeSrcDir,
      'migrations',
      '1791900000200-create-m5-finance-core.ts',
    );
    const content = fs.readFileSync(migrationFile, 'utf8');
    const rlsMatches = content.match(
      /enableTenantRlsPolicy\(queryRunner,\s*[a-zA-Z0-9_]+\)/g,
    );
    expect(rlsMatches?.length).toBe(22);
    expect(content).toContain('enforce_financial_journal_immutability');
    expect(content).toContain('trg_financial_journals_immutability');
    expect(content).toContain('trg_financial_journal_lines_immutability');
  });
});
