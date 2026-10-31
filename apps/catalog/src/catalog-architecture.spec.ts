import * as fs from 'fs';
import * as path from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import { ProductVariantEntity } from './infrastructure/persistence/catalog.entities';

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (
      entry.isFile() &&
      full.endsWith('.ts') &&
      !full.endsWith('.spec.ts')
    ) {
      results.push(full);
    }
  }
  return results;
}

describe('Catalog Architecture & Ownership Boundaries (ADR-0010, ADR-0013)', () => {
  const catalogSrcDir = path.resolve(__dirname);
  const sourceFiles = collectTsFiles(catalogSrcDir);

  it('never imports code from other microservice apps', () => {
    const forbiddenApps = [
      'apps/platform',
      'apps/inventory',
      'apps/sales',
      'apps/customer',
      'apps/finance',
      'apps/integration',
      'apps/insight',
    ];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const forbidden of forbiddenApps) {
        expect(content).not.toContain(forbidden);
      }
    }
  });

  it('never queries or writes another service schema', () => {
    const forbiddenSchemas = [
      'platform.',
      'inventory.',
      'sales.',
      'customer.',
      'finance.',
      'integration.',
      'insight.',
    ];

    for (const file of sourceFiles) {
      // permission codes such as 'inventory.view' are not schema references
      const content = fs
        .readFileSync(file, 'utf8')
        .replace(/'[a-z]+\.(view|create|update|delete|approve)'/g, "''");
      for (const schemaRef of forbiddenSchemas) {
        expect(content.toLowerCase()).not.toContain(schemaRef);
      }
    }
  });

  it('keeps ProductVariant free of Inventory-owned stock and moving-average cost columns', () => {
    const variantColumns = getMetadataArgsStorage()
      .columns.filter((c) => c.target === ProductVariantEntity)
      .map((c) => c.propertyName);

    expect(variantColumns).toContain('skuCode');
    expect(variantColumns).toContain('basePrice');
    expect(variantColumns).not.toContain('avgCostPrice');
    expect(variantColumns).not.toContain('totalQuantityForCost');
    expect(variantColumns).not.toContain('quantityOnHand');
    expect(variantColumns).not.toContain('quantityReserved');

    const migrationPath = path.join(
      catalogSrcDir,
      'migrations',
      '1791900000200-create-catalog-tables.ts',
    );
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    expect(migrationSql).not.toContain('"avg_cost_price"');
    expect(migrationSql).not.toContain('"total_quantity_for_cost"');
    expect(migrationSql).not.toContain('"quantity_on_hand"');
    expect(migrationSql).not.toContain('"quantity_reserved"');
  });

  it('enforces Clean Architecture dependency direction in catalog-domain.ts (no NestJS, TypeORM, or infrastructure imports)', () => {
    const domainFile = path.join(catalogSrcDir, 'domain', 'catalog-domain.ts');
    const content = fs.readFileSync(domainFile, 'utf8');
    expect(content).not.toMatch(/from\s+['"]@nestjs\//);
    expect(content).not.toMatch(/from\s+['"]typeorm['"]/);
    expect(content).not.toMatch(/from\s+['"]\.\.\/infrastructure/);
    expect(content).not.toMatch(/from\s+['"]\.\.\/presentation/);
  });
});
