import * as fs from 'fs';
import * as path from 'path';

const WORKSPACE_ROOT = path.resolve(__dirname, '../../../..');

const SERVICES = [
  'platform',
  'catalog',
  'inventory',
  'sales',
  'customer',
  'finance',
  'integration',
  'insight',
] as const;

function collectTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const staticRegex =
    /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicRegex = /(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = staticRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  while ((match = dynamicRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

describe('SapoClone v2 service isolation & module boundaries', () => {
  it('every service app has its own main.ts, app.module.ts, and tsconfig.app.json', () => {
    for (const service of SERVICES) {
      const appDir = path.join(WORKSPACE_ROOT, 'apps', service);
      expect(fs.existsSync(path.join(appDir, 'src', 'main.ts'))).toBe(true);
      expect(fs.existsSync(path.join(appDir, 'src', 'app.module.ts'))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(appDir, 'tsconfig.app.json'))).toBe(true);
    }
  });

  it('no service app imports code from another service app directory', () => {
    const violations: string[] = [];

    for (const service of SERVICES) {
      const appDir = path.join(WORKSPACE_ROOT, 'apps', service);
      const files = collectTsFiles(appDir);

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const imports = extractImports(content);

        for (const spec of imports) {
          for (const other of SERVICES) {
            if (other === service) continue;
            if (
              spec.includes(`apps/${other}`) ||
              (spec.startsWith('.') &&
                path
                  .resolve(path.dirname(file), spec)
                  .startsWith(path.join(WORKSPACE_ROOT, 'apps', other)))
            ) {
              violations.push(
                `${path.relative(WORKSPACE_ROOT, file)} imports "${spec}" (cross-service import into ${other})`,
              );
            }
          }
          if (service !== 'platform' && spec.startsWith('@/')) {
            violations.push(
              `${path.relative(WORKSPACE_ROOT, file)} imports platform alias "${spec}"`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('shared libraries under libs/ never import from apps/ and @pbl/common never imports @pbl/auth at runtime', () => {
    const violations: string[] = [];
    const libsDir = path.join(WORKSPACE_ROOT, 'libs');
    const files = collectTsFiles(libsDir);

    for (const file of files) {
      const rel = path.relative(WORKSPACE_ROOT, file);
      const content = fs.readFileSync(file, 'utf8');
      const imports = extractImports(content);

      for (const spec of imports) {
        if (spec.includes('apps/') || spec.startsWith('@/')) {
          violations.push(`${rel} imports app module "${spec}"`);
        }
        const isCommonRuntime =
          rel.startsWith(path.join('libs', 'common', 'src')) &&
          !rel.endsWith('.spec.ts');
        if (
          isCommonRuntime &&
          (spec === '@pbl/auth' ||
            spec.startsWith('@pbl/auth/') ||
            spec === '@sapoclone/pbl-auth')
        ) {
          violations.push(
            `${rel} imports "${spec}" at runtime (@pbl/common must not depend on @pbl/auth)`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
