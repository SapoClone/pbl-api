import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

function collectTypeScriptFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectTypeScriptFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('Inventory M2 Architecture Guardrails', () => {
  const inventorySrcDir = __dirname;
  const repoRoot = join(inventorySrcDir, '../../..');
  const allFiles = collectTypeScriptFiles(inventorySrcDir);

  it('forbids direct imports from other microservice apps (catalog, sales, platform, finance, customer, integration, insight)', () => {
    const forbiddenImportRegex =
      /from\s+['"][^'"]*apps\/(catalog|sales|platform|finance|customer|integration|insight)\b/;

    for (const file of allFiles) {
      const content = readFileSync(file, 'utf8');
      const rel = relative(repoRoot, file);
      expect({
        file: rel,
        hasForbiddenImport: forbiddenImportRegex.test(content),
      }).toEqual({
        file: rel,
        hasForbiddenImport: false,
      });
    }
  });

  it('forbids cross-schema SQL queries to catalog, sales, platform, finance, customer, integration, or insight schemas', () => {
    const crossSchemaSqlRegex =
      /\b(FROM|JOIN|UPDATE|INTO)\s+["']?(catalog|sales|platform|finance|customer|integration|insight)["']?\s*\.\s*["']?[a-z_]/i;

    for (const file of allFiles) {
      const content = readFileSync(file, 'utf8');
      const rel = relative(repoRoot, file);
      expect({
        file: rel,
        hasCrossSchemaSql: crossSchemaSqlRegex.test(content),
      }).toEqual({
        file: rel,
        hasCrossSchemaSql: false,
      });
    }
  });

  it('keeps the Inventory domain layer pure TypeScript with zero NestJS or TypeORM dependencies', () => {
    const domainFiles = collectTypeScriptFiles(join(inventorySrcDir, 'domain'));
    expect(domainFiles.length).toBeGreaterThan(0);

    for (const file of domainFiles) {
      const content = readFileSync(file, 'utf8');
      const rel = relative(repoRoot, file);
      expect(content).not.toMatch(/from\s+['"]@nestjs\//);
      expect(content).not.toMatch(/from\s+['"]typeorm['"]/);
      expect({ file: rel, pure: true }).toEqual({ file: rel, pure: true });
    }
  });

  it('never exposes /internal/v1/reservations or /internal/reservations on the public KrakenD gateway', () => {
    const krakendPath = join(repoRoot, 'krakend/krakend.json');
    const krakendRaw = readFileSync(krakendPath, 'utf8');
    const krakend = JSON.parse(krakendRaw) as {
      endpoints?: Array<{ endpoint: string }>;
    };
    const publicEndpoints = (krakend.endpoints ?? []).map((e) => e.endpoint);
    const leakedInternal = publicEndpoints.filter((ep) =>
      ep.startsWith('/internal/'),
    );
    expect(leakedInternal).toEqual([]);
  });
});
