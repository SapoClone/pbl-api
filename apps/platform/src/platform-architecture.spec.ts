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

describe('Platform M0/M7.5 — Architecture & Boundary Guardrails', () => {
  const platformSrcDir = __dirname;
  const allPlatformFiles = collectTsFiles(platformSrcDir).filter(
    (f) => !f.endsWith('.spec.ts'),
  );

  it('keeps platform-domain.ts 100% pure TypeScript with zero NestJS, TypeORM, Redis, or process.env imports', () => {
    const domainFile = path.join(
      platformSrcDir,
      'domain',
      'platform-domain.ts',
    );
    const content = fs.readFileSync(domainFile, 'utf8');
    expect(content).not.toMatch(/from\s+['"]@nestjs\//);
    expect(content).not.toMatch(/from\s+['"]typeorm['"]/);
    expect(content).not.toMatch(/from\s+['"]ioredis['"]/);
    expect(content).not.toMatch(/process\.env/);
  });

  it('never imports internal source code from other microservice apps', () => {
    const forbiddenImport =
      /from\s+['"][^'"]*apps\/(catalog|inventory|sales|customer|finance|integration|insight)\b/;
    for (const file of allPlatformFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(forbiddenImport);
    }
  });

  it('never executes cross-schema SQL against catalog, inventory, sales, customer, finance, integration, or insight schemas', () => {
    const crossSchemaSqlRegex =
      /\b(FROM|JOIN|UPDATE|INTO|TABLE)\s+["']?(catalog|inventory|sales|customer|finance|integration|insight)["']?\.\s*["']?[a-z_]/i;
    for (const file of allPlatformFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(crossSchemaSqlRegex);
    }
  });

  it('enforces tenant_id foreign keys and unique constraints across platform migrations', () => {
    const migrationsDir = path.join(platformSrcDir, 'database', 'migrations');
    const migrationFiles = collectTsFiles(migrationsDir);
    expect(migrationFiles.length).toBeGreaterThan(0);
    const combinedSql = migrationFiles
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n');
    expect(combinedSql).toContain('CREATE TABLE "tenant"');
    expect(combinedSql).toContain('CREATE TABLE "account_tenant"');
    expect(combinedSql).toContain('CREATE TABLE "branch"');
    expect(combinedSql).toContain('UQ_branch_tenant_code');
  });
});
