/**
 * Live channel connections block a branch from being deactivated or deleted (D4), against a real Postgres.
 */
import { RequestContext } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { M6_INTEGRATION_ENTITIES } from '../src/infrastructure/persistence/integration.entities';
import { BranchBlockersService } from '../src/internal/branch-blockers.service';
import { CreateM6IntegrationCore1791900000200 } from '../src/migrations/1791900000200-create-m6-integration-core';
import { AllowSyncJobSchedulerSelect1792500000000 } from '../src/migrations/1792500000000-allow-sync-job-scheduler-select';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const OTHER_BRANCH = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';

describe('integration branch blockers (Postgres)', () => {
  const schema = uniqueSchema('integration_blockers_it');
  let dataSource: DataSource;
  let service: BranchBlockersService;
  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  const connection = (
    branchId: string,
    status: string,
    code: string,
    tenantId = TENANT,
  ) =>
    dataSource.query(
      `INSERT INTO "${schema}"."channel_connections"
         (id, tenant_id, code, provider, connection_key, external_shop_id, shop_name, branch_id, status, created_by)
       VALUES ($1, $2, $3, 'SHOPEE', $4, $4, $5, $6, $7, 'it')`,
      [
        randomUUID(),
        tenantId,
        code,
        randomUUID(),
        `Shop ${code}`,
        branchId,
        status,
      ],
    );

  beforeAll(async () => {
    useDatabase(schema);
    dataSource = await initializeDatabase({
      ...databaseOptions({
        entities: [
          ...M6_INTEGRATION_ENTITIES,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateM6IntegrationCore1791900000200,
          AllowSyncJobSchedulerSelect1792500000000,
        ],
      }),
    });
    service = new BranchBlockersService(dataSource);
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  it('reports nothing when the branch has no connection, or only never-authorised or disconnected ones', async () => {
    await connection(BRANCH, 'PENDING_AUTH', 'CON-1');
    await connection(BRANCH, 'DISCONNECTED', 'CON-2');

    expect(await as(TENANT, () => service.forBranch(BRANCH))).toEqual({
      reasons: [],
    });
  });

  it('reports every live connection of the branch, paused and degraded included', async () => {
    await connection(BRANCH, 'CONNECTED', 'CON-3');
    await connection(BRANCH, 'PAUSED', 'CON-4');
    await connection(BRANCH, 'DEGRADED', 'CON-5');
    await connection(BRANCH, 'TOKEN_EXPIRED', 'CON-6');
    await connection(OTHER_BRANCH, 'CONNECTED', 'CON-7');

    const { reasons } = await as(TENANT, () => service.forBranch(BRANCH));

    expect(reasons).toEqual([
      {
        code: 'INTEGRATION_LIVE_CONNECTIONS',
        message:
          'Chi nhánh còn 4 kết nối sàn thương mại điện tử đang hoạt động',
        count: 4,
        samples: expect.arrayContaining(['CON-3 (Shop CON-3)']),
      },
    ]);
  });

  it("does not see another store's connections", async () => {
    await connection(BRANCH, 'CONNECTED', 'CON-8', OTHER_TENANT);

    const mine = await as(TENANT, () => service.forBranch(BRANCH));
    const theirs = await as(OTHER_TENANT, () => service.forBranch(BRANCH));

    expect(mine.reasons[0].count).toBe(4);
    expect(theirs.reasons[0].count).toBe(1);
  });
});
