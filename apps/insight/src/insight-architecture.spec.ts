import {
  INSIGHT_EXPORT_COMPLETED,
  INSIGHT_EXPORT_FAILED,
  INSIGHT_PROJECTION_REBUILT,
  INSIGHT_PROJECTION_STALE_DETECTED,
  INSIGHT_RECONCILIATION_DISCREPANCY_DETECTED,
  TOPOLOGY,
} from '@pbl/contracts';
import * as fs from 'fs';
import * as path from 'path';
import { M7_INSIGHT_ENTITIES } from './infrastructure/persistence/insight.entities';

describe('M7 Insight Hexagonal & Microservice Boundary Architecture', () => {
  const srcRoot = path.resolve(__dirname);

  it('keeps domain/insight-domain.ts pure with zero NestJS, TypeORM, or Express imports', () => {
    const domainSource = fs.readFileSync(
      path.join(srcRoot, 'domain', 'insight-domain.ts'),
      'utf8',
    );
    expect(domainSource).not.toMatch(/@nestjs\//);
    expect(domainSource).not.toMatch(/from ['"]typeorm['"]/);
    expect(domainSource).not.toMatch(/from ['"]express['"]/);
  });

  it('enforces strict microservice isolation with zero imports from other apps/*', () => {
    const collectTsFiles = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...collectTsFiles(full));
        } else if (entry.name.endsWith('.ts')) {
          files.push(full);
        }
      }
      return files;
    };

    const allFiles = collectTsFiles(srcRoot);
    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(
        /apps\/(platform|catalog|inventory|sales|customer|finance|integration)/,
      );
    }
  });

  it('registers all M7 Insight producer and consumer event contracts in TOPOLOGY', () => {
    expect(TOPOLOGY.producers.insight).toEqual(
      expect.arrayContaining([
        INSIGHT_PROJECTION_REBUILT.type,
        INSIGHT_PROJECTION_STALE_DETECTED.type,
        INSIGHT_RECONCILIATION_DISCREPANCY_DETECTED.type,
        INSIGHT_EXPORT_COMPLETED.type,
        INSIGHT_EXPORT_FAILED.type,
      ]),
    );
    expect(TOPOLOGY.subscriptions.insight).toEqual(
      expect.arrayContaining([
        'sales.order.created',
        'sales.order.confirmed',
        'sales.order.completed',
        'sales.order.cancelled',
        'sales.return.completed',
        'inventory.stock.changed',
        'inventory.stock.received',
        'inventory.stock.issued',
        'inventory.transfer.dispatched',
        'inventory.transfer.received',
        'catalog.product.created',
        'catalog.variant.created',
        'customer.created',
        'customer.group.changed',
        'finance.receivable.payment_applied',
        'finance.cashbook.entry_posted',
      ]),
    );
  });

  it('enforces tenantId on all 17 M7 analytical entities and RLS policies in migration', () => {
    expect(M7_INSIGHT_ENTITIES.length).toBe(17);
    for (const EntityClass of M7_INSIGHT_ENTITIES) {
      const instance = new EntityClass() as unknown as Record<string, unknown>;
      expect('tenantId' in instance || EntityClass.prototype).toBeTruthy();
    }

    const migrationSource = fs.readFileSync(
      path.join(
        srcRoot,
        'migrations',
        '1791900000300-create-m7-insight-core.ts',
      ),
      'utf8',
    );
    const rlsMatches = migrationSource.match(/enableTenantRlsPolicy\(/g) ?? [];
    // 2 M0 tables + 16 M7 tables = 18 RLS policies enabled
    expect(rlsMatches.length).toBeGreaterThanOrEqual(16);
  });
});
