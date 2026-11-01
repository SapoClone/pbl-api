import * as Contracts from '@pbl/contracts';
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

const LIBS = ['common', 'auth', 'contracts', 'events'] as const;

function collectTsFiles(dir: string, includeSpecs = false): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full, includeSpecs));
    } else if (
      entry.isFile() &&
      full.endsWith('.ts') &&
      (includeSpecs ||
        (!full.endsWith('.spec.ts') && !full.endsWith('.e2e-spec.ts')))
    ) {
      results.push(full);
    }
  }
  return results;
}

function extractRelativeImports(content: string): string[] {
  const imports: string[] = [];
  const regex = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

describe('M7.5 Monorepo-Wide DDD & Hexagonal Architecture Fitness Suite (Rules A-J)', () => {
  describe('Rule A — Service Isolation (Bounded Context Autonomy)', () => {
    it.each(SERVICES)(
      'ensures apps/%s never imports code from any other microservice app',
      (service) => {
        const srcDir = path.join(WORKSPACE_ROOT, 'apps', service, 'src');
        const files = collectTsFiles(srcDir);
        expect(files.length).toBeGreaterThan(0);

        const otherServices = SERVICES.filter((s) => s !== service);
        for (const file of files) {
          const content = fs.readFileSync(file, 'utf8');
          for (const other of otherServices) {
            expect(content).not.toMatch(
              new RegExp(`['"][^'"]*apps/${other}(?:/|['"])`),
            );
          }
        }
      },
    );
  });

  describe('Rule B — Domain Layer Purity (Zero Framework/ORM/IO/Env Leakage)', () => {
    it.each(SERVICES)(
      'ensures apps/%s/src/domain contains 100%% pure TypeScript domain logic',
      (service) => {
        const domainDir = path.join(
          WORKSPACE_ROOT,
          'apps',
          service,
          'src',
          'domain',
        );
        expect(fs.existsSync(domainDir)).toBe(true);
        const domainFiles = collectTsFiles(domainDir);
        expect(domainFiles.length).toBeGreaterThan(0);

        for (const file of domainFiles) {
          const content = fs.readFileSync(file, 'utf8');
          expect(content).not.toMatch(/from\s+['"]@nestjs\//);
          expect(content).not.toMatch(/from\s+['"]typeorm['"]/);
          expect(content).not.toMatch(/from\s+['"]axios['"]/);
          expect(content).not.toMatch(/from\s+['"]ioredis['"]/);
          expect(content).not.toMatch(/from\s+['"]@aws-sdk\//);
          expect(content).not.toMatch(/from\s+['"]express['"]/);
          expect(content).not.toMatch(/\bprocess\.env\b/);
        }
      },
    );
  });

  describe('Rule C & Rule D — Hexagonal Dependency Direction (Domain <- Application <- Infrastructure/Presentation)', () => {
    it.each(SERVICES)(
      'ensures apps/%s/src/domain never depends on application, infrastructure, presentation, or API controllers',
      (service) => {
        const domainDir = path.join(
          WORKSPACE_ROOT,
          'apps',
          service,
          'src',
          'domain',
        );
        const domainFiles = collectTsFiles(domainDir);

        for (const file of domainFiles) {
          const content = fs.readFileSync(file, 'utf8');
          expect(content).not.toMatch(/from\s+['"]\.\.\/modules\//);
          expect(content).not.toMatch(/from\s+['"]\.\.\/api\//);
          expect(content).not.toMatch(/from\s+['"]\.\.\/infrastructure\//);
          expect(content).not.toMatch(/from\s+['"]\.\.\/presentation\//);
          expect(content).not.toMatch(/from\s+['"]\.\.\/controllers\//);
          expect(content).not.toMatch(/from\s+['"]\.\.\/consumers\//);
          expect(content).not.toMatch(/from\s+['"]@\//);
        }
      },
    );
  });

  describe('Rule E — Strict Database Schema Ownership (No Cross-Service SQL Joins/Writes)', () => {
    it.each(SERVICES)(
      'ensures apps/%s never queries or mutates another microservice PostgreSQL schema',
      (service) => {
        const srcDir = path.join(WORKSPACE_ROOT, 'apps', service, 'src');
        const files = collectTsFiles(srcDir).filter(
          (f) => !f.endsWith('microservices-openapi.ts'),
        );
        const otherSchemas = SERVICES.filter((s) => s !== service);

        for (const file of files) {
          const rawContent = fs.readFileSync(file, 'utf8');
          // Strip block and line comments so prose/event descriptions are not mistaken for SQL
          const codeOnly = rawContent
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
          for (const otherSchema of otherSchemas) {
            // Match SQL schema.table (1 dot, not 2-dot event routing keys like sales.order.placed)
            const sqlSchemaRegex = new RegExp(
              `\\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\\s+["']?${otherSchema}["']?\\s*\\.\\s*["']?[a-z_][a-z0-9_]*["']?(?![.\\w])`,
              'i',
            );
            expect(codeOnly).not.toMatch(sqlSchemaRegex);
          }
        }
      },
    );
  });

  describe('Rule F — Shared Library Discipline (No Business Domain Leakage into @pbl/*)', () => {
    it.each(LIBS)(
      'ensures libs/%s never imports from apps/* and contains no business entities',
      (lib) => {
        const libDir = path.join(WORKSPACE_ROOT, 'libs', lib, 'src');
        const files = collectTsFiles(libDir);
        expect(files.length).toBeGreaterThan(0);

        for (const file of files) {
          const content = fs.readFileSync(file, 'utf8');
          expect(content).not.toMatch(/from\s+['"][^'"]*apps\//);
          // Shared technical libraries must not define TypeORM @Entity business tables (except OutboxEvent/ProcessedEvent in @pbl/events)
          if (lib !== 'events') {
            expect(content).not.toMatch(/@Entity\(/);
          }
        }
      },
    );
  });

  describe('Rule G — Acyclic Domain Dependency Graph (No Circular Dependencies in Domain)', () => {
    it.each(SERVICES)(
      'verifies apps/%s/src/domain has no circular file imports',
      (service) => {
        const domainDir = path.join(
          WORKSPACE_ROOT,
          'apps',
          service,
          'src',
          'domain',
        );
        const domainFiles = collectTsFiles(domainDir);
        const graph = new Map<string, string[]>();

        for (const file of domainFiles) {
          const content = fs.readFileSync(file, 'utf8');
          const relImports = extractRelativeImports(content).map((imp) => {
            const resolved = path.resolve(path.dirname(file), imp);
            return resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
          });
          graph.set(file, relImports);
        }

        const visited = new Set<string>();
        const visiting = new Set<string>();

        function hasCycle(node: string): boolean {
          if (visiting.has(node)) return true;
          if (visited.has(node)) return false;
          visiting.add(node);
          for (const neighbor of graph.get(node) ?? []) {
            if (graph.has(neighbor) && hasCycle(neighbor)) {
              return true;
            }
          }
          visiting.delete(node);
          visited.add(node);
          return false;
        }

        for (const file of domainFiles) {
          expect(hasCycle(file)).toBe(false);
        }
      },
    );
  });

  describe('Rule H — Integration Contract & Event Topology Stability (@pbl/contracts)', () => {
    it('exports canonical routing keys and topology definitions for all bounded contexts', () => {
      expect(Contracts.CATALOG_PRODUCT_CREATED.type).toBe(
        'catalog.product.created',
      );
      expect(Contracts.CATALOG_VARIANT_UPDATED.type).toBe(
        'catalog.variant.updated',
      );
      expect(Contracts.INVENTORY_STOCK_CHANGED.type).toBe(
        'inventory.stock.changed',
      );
      expect(Contracts.INVENTORY_RESERVATION_CONFIRMED.type).toBe(
        'inventory.reservation.confirmed',
      );
      expect(Contracts.SALES_ORDER_CREATED.type).toBe('sales.order.created');
      expect(Contracts.SALES_ORDER_CONFIRMED.type).toBe(
        'sales.order.confirmed',
      );
      expect(Contracts.SALES_ORDER_COMPLETED.type).toBe(
        'sales.order.completed',
      );
      expect(Contracts.SALES_ORDER_CANCELLED.type).toBe(
        'sales.order.cancelled',
      );
      expect(Contracts.SALES_RETURN_COMPLETED.type).toBe(
        'sales.return.completed',
      );
      expect(Contracts.CUSTOMER_CREATED.type).toBe('customer.created');
      expect(Contracts.CUSTOMER_LOYALTY_POINTS_EARNED.type).toBe(
        'customer.loyalty.points_earned',
      );
      expect(Contracts.FINANCE_CASHBOOK_ENTRY_POSTED.type).toBe(
        'finance.cashbook.entry_posted',
      );
      expect(Contracts.FINANCE_PAYMENT_SETTLEMENT_CONFIRMED.type).toBe(
        'finance.payment.settlement_confirmed',
      );
      expect(Contracts.INTEGRATION_EXTERNAL_ORDER_IMPORTED.type).toBe(
        'integration.external_order.imported',
      );
      expect(Contracts.INTEGRATION_INVENTORY_PUBLICATION_SUCCEEDED.type).toBe(
        'integration.inventory.publication_succeeded',
      );
      expect(Contracts.TOPOLOGY).toBeDefined();
      expect(Object.keys(Contracts.TOPOLOGY.producers)).toEqual(
        expect.arrayContaining([
          'platform',
          'catalog',
          'inventory',
          'sales',
          'customer',
          'finance',
          'integration',
          'insight',
        ]),
      );
    });
  });

  describe('Rule I — Multi-Tenant PostgreSQL Row-Level Security (RLS) Enforcement', () => {
    it.each([
      'catalog',
      'inventory',
      'sales',
      'customer',
      'finance',
      'integration',
      'insight',
    ] as const)(
      'ensures apps/%s migrations enforce tenant Row-Level Security policies',
      (service) => {
        const migrationsDir = path.join(
          WORKSPACE_ROOT,
          'apps',
          service,
          'src',
          'migrations',
        );
        const migrationFiles = collectTsFiles(migrationsDir);
        expect(migrationFiles.length).toBeGreaterThan(0);

        const combinedSql = migrationFiles
          .map((f) => fs.readFileSync(f, 'utf8'))
          .join('\n');
        expect(combinedSql).toMatch(
          /enableTenantRlsPolicy|ENABLE ROW LEVEL SECURITY/i,
        );
      },
    );
  });

  describe('Rule J — Explicit Tactical DDD Invariants & Aggregates Across All 8 Bounded Contexts', () => {
    it('verifies all 8 bounded contexts export rich domain invariants, Value Objects, or Aggregates', () => {
      const domainExpectations: Record<string, string[]> = {
        platform: [
          'SubdomainVO',
          'BranchCodeVO',
          'TenantMembershipAggregate',
          'assertNotLastActiveBranch',
        ],
        catalog: [
          'CatalogDomainError',
          'normalizeSku',
          'parseAndFormatMoney',
          'generateCartesianVariantSpecs',
          'resolveVariantPrice',
        ],
        inventory: [
          'StockBalanceAggregate',
          'InventoryQuantity',
          'InventoryMoney',
          'computeWeightedAverageCostOnReceipt',
          'evaluateStockReceiptPostTransition',
        ],
        sales: [
          'OrderAggregate',
          'VndMoney',
          'StockQuantity',
          'DiscountPercentage',
          'calculateOrderQuote',
          'validateOrderStateCombination',
        ],
        customer: [
          'CustomerDomainError',
          'normalizePhoneNumber',
          'calculateEarnedPoints',
          'validatePointRedemption',
        ],
        finance: [
          'FinanceDomainError',
          'validateBalancedJournalLines',
          // integer-VND money (no cents) is our M1-M6 base decision
          'parseVnd',
        ],
        integration: [
          'ChannelConnectionAggregate',
          'translateExternalOrderToCanonicalSalesImport',
          'calculateChannelPublishableQuantity',
          'evaluateExternalStatusProgression',
        ],
        insight: [
          'computeTargetOrderContribution',
          'computeOrderContributionDelta',
          'computeNetSalesRevenue',
          'computeGrossProfit',
        ],
      };

      for (const service of SERVICES) {
        const domainFile = path.join(
          WORKSPACE_ROOT,
          'apps',
          service,
          'src',
          'domain',
          `${service}-domain.ts`,
        );
        expect(fs.existsSync(domainFile)).toBe(true);
        const content = fs.readFileSync(domainFile, 'utf8');
        for (const symbol of domainExpectations[service]) {
          expect(content).toContain(symbol);
        }
      }
    });
  });
});
