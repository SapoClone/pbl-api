/**
 * The admin ("Tich hop") read path and disconnect against a real Postgres, under the database role production uses
 * (not a superuser, no BYPASSRLS, owner of the tables so FORCE ROW LEVEL SECURITY applies to it).
 * Run with `pnpm exec jest --config libs/events/test/jest-int.json --maxWorkers=1 <this file>`.
 */
import { EventEnvelope } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
  provisionServiceRole,
} from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { runAsAdminRead } from '../src/common/admin-read-context';
import { M6_INTEGRATION_ENTITIES } from '../src/infrastructure/persistence/integration.entities';
import { CreateM6IntegrationCore1791900000200 } from '../src/migrations/1791900000200-create-m6-integration-core';
import { AllowSyncJobSchedulerSelect1792500000000 } from '../src/migrations/1792500000000-allow-sync-job-scheduler-select';
import { CreateTenantStatus1793100000420 } from '../src/migrations/1793100000420-create-tenant-status';
import { AddAdminReadAndProjections1793300000000 } from '../src/migrations/1793300000000-add-admin-read-and-projections';
import { AdminIntegrationService } from '../src/modules/admin/admin-integration.service';
import { ConnectionsService } from '../src/modules/connections/connections.service';
import { NameProjectionHandler } from '../src/projections/name-projection.handler';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BR_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BR_B = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const CONN_A = 'a0000000-0000-4000-8000-00000000000a';
const CONN_B = 'b0000000-0000-4000-8000-00000000000b';
const CONN_A2 = 'a0000000-0000-4000-8000-0000000000a2';
const TOKEN = 'SECRET-ACCESS-TOKEN-VALUE';
const REFRESH = 'SECRET-REFRESH-TOKEN-VALUE';
const WEBHOOK_SECRET = 'SECRET-WEBHOOK-SECRET-VALUE';
const PAYLOAD = 'SECRET-ENCRYPTED-PAYLOAD';
const NONCE = 'SECRET-OAUTH-NONCE';

const TABLES = [
  'channel_connections',
  'connection_credentials',
  'sync_jobs',
  'webhook_inbox_events',
  'sku_mappings',
  'integration_catalog_variants',
];

describe('integration admin read path and disconnect (Postgres, restricted role)', () => {
  const schema = uniqueSchema('integration_admin_it');
  const role = `${schema}_app`;
  let admin: DataSource;
  let roleDs: DataSource;
  let service: AdminIntegrationService;
  const enqueue = jest.fn(async () => undefined);
  const t = (name: string) => `"${schema}"."${name}"`;

  const connection = (
    id: string,
    tenant: string,
    branch: string,
    shop: string,
    status: string,
    provider = 'SHOPEE',
  ) =>
    admin.query(
      `INSERT INTO ${t('channel_connections')}
         (id, tenant_id, code, provider, connection_key, external_shop_id, shop_name, branch_id, status,
          oauth_state_nonce, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, 'it')`,
      [
        id,
        tenant,
        `CON-${id.slice(-3)}`,
        provider,
        `key-${id}`,
        shop,
        branch,
        status,
        NONCE,
      ],
    );
  const credential = (connectionId: string, tenant: string) =>
    admin.query(
      `INSERT INTO ${t('connection_credentials')}
         (tenant_id, connection_id, encrypted_access_token, encrypted_refresh_token, encrypted_webhook_secret,
          access_token_expires_at, refresh_token_expires_at, scopes)
       VALUES ($1, $2, $3, $4, $5, '2031-01-01T00:00:00Z', '2031-06-01T00:00:00Z', 'order,product')`,
      [tenant, connectionId, TOKEN, REFRESH, WEBHOOK_SECRET],
    );
  const job = (
    connectionId: string,
    tenant: string,
    status: string,
    code: string,
  ) =>
    admin.query(
      `INSERT INTO ${t('sync_jobs')} (tenant_id, code, connection_id, provider, job_type, idempotency_key, status)
       VALUES ($1, $2, $3, 'SHOPEE', 'ORDER_POLL', $4, $5)`,
      [tenant, code, connectionId, randomUUID(), status],
    );
  const webhook = (
    connectionId: string,
    tenant: string,
    status: string,
    eventId: string,
  ) =>
    admin.query(
      `INSERT INTO ${t('webhook_inbox_events')}
         (tenant_id, connection_id, provider, external_event_id, deduplication_key, event_type, external_shop_id,
          payload_hash, encrypted_payload, provider_event_time, processing_status)
       VALUES ($1, $2, 'SHOPEE', $3, $3, 'order.created', 'x', 'h', $4, now(), $5)`,
      [tenant, connectionId, eventId, PAYLOAD, status],
    );
  const variant = (tenant: string) =>
    admin.query(
      `INSERT INTO ${t('integration_catalog_variants')} (tenant_id, variant_id, product_id, sku_code, name)
       VALUES ($1, $2, $3, $4, 'v')`,
      [tenant, randomUUID(), randomUUID(), `SKU-${randomUUID().slice(0, 6)}`],
    );
  const mapping = (connectionId: string, tenant: string) =>
    admin.query(
      `INSERT INTO ${t('sku_mappings')}
         (tenant_id, connection_id, provider, external_item_id, external_sku_id, internal_variant_id,
          internal_sku_code, created_by, updated_by)
       VALUES ($1, $2, 'SHOPEE', $3, $3, $4, 'S', 'it', 'it')`,
      [tenant, connectionId, randomUUID(), randomUUID()],
    );
  const asTenant = async <T>(
    tenant: string | null,
    work: (q: DataSource['query']) => Promise<T>,
  ) =>
    roleDs.transaction(async (em) => {
      if (tenant)
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenant,
        ]);
      return work(em.query.bind(em));
    });

  beforeAll(async () => {
    useDatabase(schema);
    admin = await initializeDatabase({
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
          CreateTenantStatus1793100000420,
          AddAdminReadAndProjections1793300000000,
        ],
      }),
    });
    await provisionServiceRole(admin, schema, role);
    const tables: { tablename: string }[] = await admin.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
      [schema],
    );
    for (const { tablename } of tables) {
      await admin.query(`ALTER TABLE ${t(tablename)} OWNER TO "${role}"`);
    }
    roleDs = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      username: role,
      password: role,
      database: 'pbl',
      schema,
      entities: M6_INTEGRATION_ENTITIES,
    });
    await roleDs.initialize();

    // two stores: A has two connections (one shopee, one lazada), B has one
    await connection(CONN_A, A, BR_A, 'Moc Shop', 'CONNECTED');
    await connection(CONN_A2, A, BR_A, 'Moc Lazada', 'PAUSED', 'LAZADA');
    await connection(CONN_B, B, BR_B, 'Gom Shop', 'REAUTH_REQUIRED');
    for (const [c, tn] of [
      [CONN_A, A],
      [CONN_A2, A],
      [CONN_B, B],
    ]) {
      await credential(c, tn);
    }
    await job(CONN_A, A, 'COMPLETED', 'JOB-1');
    await job(CONN_A, A, 'FAILED_PERMANENT', 'JOB-2');
    await job(CONN_A, A, 'DEAD_LETTERED', 'JOB-3');
    await job(CONN_B, B, 'RUNNING', 'JOB-4');
    await webhook(CONN_A, A, 'PROCESSED', 'ev-a');
    await webhook(CONN_B, B, 'NEEDS_REVIEW', 'ev-b');
    await variant(A);
    await variant(A);
    await variant(B);
    await mapping(CONN_A, A);
    await mapping(CONN_B, B);
    await admin.query(
      `INSERT INTO ${t('tenant_projection')} VALUES ($1, 'Moc Store', now()), ($2, 'Gom Store', now())`,
      [A, B],
    );
    await admin.query(
      `INSERT INTO ${t('branch_projection')} VALUES ($1, $2, 'Chi nhanh 1', now())`,
      [BR_A, A],
    );

    const connections = new ConnectionsService(
      roleDs,
      {
        getAdapter: () => ({ getCapabilities: () => ({}) }),
      } as never,
      { getCircuitState: () => ({ state: 'CLOSED' }) } as never,
      { enqueue } as never,
    );
    service = new AdminIntegrationService(roleDs, connections);
  });

  afterAll(async () => {
    await roleDs?.destroy();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`DROP OWNED BY "${role}"`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    await admin.destroy();
  });

  describe('row-level security', () => {
    it('runs as a restricted role under forced RLS', async () => {
      const [{ rolsuper, rolbypassrls }] = await admin.query(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
        [role],
      );
      expect(rolsuper).toBe(false);
      expect(rolbypassrls).toBe(false);
      const forced = await admin.query(
        `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND relname = ANY($2) AND relforcerowsecurity`,
        [schema, TABLES],
      );
      expect(forced).toHaveLength(TABLES.length);
    });

    it('(a) the admin context sees every store', async () => {
      const list = await service.listConnections({
        page: 1,
        limit: 20,
        order: 'DESC',
      });
      expect(list.data.map((c) => c.id).sort()).toEqual(
        [CONN_A, CONN_A2, CONN_B].sort(),
      );
      expect(list.pagination.totalRecords).toBe(3);
      expect(new Set(list.data.map((c) => c.tenant.id))).toEqual(
        new Set([A, B]),
      );
      const jobs = await service.listSyncHistory({
        page: 1,
        limit: 20,
        order: 'DESC',
      });
      expect(jobs.pagination.totalRecords).toBe(4);
      const hooks = await service.listWebhookEvents({
        page: 1,
        limit: 20,
        order: 'DESC',
      });
      expect(hooks.pagination.totalRecords).toBe(2);
    });

    it('(b) a store context sees only its own store, admin policy or not', async () => {
      for (const table of TABLES) {
        const rows = await asTenant(A, (q) =>
          q(`SELECT tenant_id FROM ${t(table)}`),
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(
          new Set(rows.map((r: { tenant_id: string }) => r.tenant_id)),
        ).toEqual(new Set([A]));
      }
    });

    it('(c) no context sees nothing, and the admin setting does not outlive its transaction', async () => {
      await runAsAdminRead(roleDs, async (em) => {
        const rows = await em.query(
          `SELECT 1 FROM ${t('channel_connections')}`,
        );
        expect(rows.length).toBe(3);
      });
      for (const table of TABLES) {
        const rows = await roleDs.query(`SELECT 1 FROM ${t(table)}`);
        expect(rows).toHaveLength(0);
      }
    });

    it('the admin policy is read-only: no write under the admin setting alone', async () => {
      await runAsAdminRead(roleDs, async (em) => {
        const updated = await em.query(
          `UPDATE ${t('channel_connections')} SET shop_name = 'hacked' RETURNING id`,
        );
        expect(updated[1]).toBe(0);
        const deleted = await em.query(
          `DELETE FROM ${t('sync_jobs')} RETURNING id`,
        );
        expect(deleted[1]).toBe(0);
        await expect(
          em.query(
            `INSERT INTO ${t('sync_jobs')} (tenant_id, code, idempotency_key, job_type)
             VALUES ($1, 'X', 'k', 'ORDER_POLL')`,
            [A],
          ),
        ).rejects.toThrow();
      });
    });
  });

  describe('reads', () => {
    it('lists with names from the projections (null when missing), counts by status and filters', async () => {
      const all = await service.listConnections({
        page: 1,
        limit: 20,
        order: 'DESC',
      });
      const moc = all.data.find((c) => c.id === CONN_A)!;
      expect(moc).toMatchObject({
        code: expect.any(String),
        tenant: { id: A, name: 'Moc Store' },
        branch: { id: BR_A, name: 'Chi nhanh 1' },
        provider: 'shopee',
        shopId: 'Moc Shop',
        shopName: 'Moc Shop',
        status: 'connected',
      });
      expect(all.data.find((c) => c.id === CONN_B)!.branch.name).toBeNull();
      expect(all.counts).toEqual({
        all: 3,
        pending_auth: 0,
        connected: 1,
        degraded: 0,
        token_expired: 0,
        reauth_required: 1,
        paused: 1,
        disconnected: 0,
      });

      const byStore = await service.listConnections({
        page: 1,
        limit: 20,
        order: 'DESC',
        q: 'moc store',
      });
      expect(byStore.data.map((c) => c.id).sort()).toEqual(
        [CONN_A, CONN_A2].sort(),
      );
      const byShop = await service.listConnections({
        page: 1,
        limit: 20,
        order: 'DESC',
        q: 'gom',
      });
      expect(byShop.data.map((c) => c.id)).toEqual([CONN_B]);
      const lazada = await service.listConnections({
        page: 1,
        limit: 20,
        order: 'DESC',
        provider: 'lazada',
        status: 'paused',
      });
      expect(lazada.data.map((c) => c.id)).toEqual([CONN_A2]);
      // counts ignore the status filter (they feed the tabs) but follow the other filters
      expect(lazada.counts.all).toBe(1);
      const byBranch = await service.listConnections({
        page: 1,
        limit: 1,
        order: 'ASC',
        branchId: BR_A,
      });
      expect(byBranch.pagination).toMatchObject({
        totalRecords: 2,
        totalPages: 2,
        nextPage: 2,
      });
      const wildcard = await service.listConnections({
        page: 1,
        limit: 20,
        order: 'DESC',
        q: '%',
      });
      expect(wildcard.data).toHaveLength(0);
    });

    it('detail adds scopes, token expiry, error fields and stats', async () => {
      const d = await service.getConnection(CONN_A);
      expect(d).toMatchObject({
        externalShopId: 'Moc Shop',
        scopes: ['order', 'product'],
        tokenExpiresAt: '2031-01-01T00:00:00.000Z',
        refreshTokenExpiresAt: '2031-06-01T00:00:00.000Z',
        consecutiveFailures: 0,
        safetyStockBuffer: 0,
        stockAllocationPercent: 100,
        stats: {
          mappedSkus: 1,
          totalSkus: 2,
          jobsToday: 3,
          jobsFailedToday: 2,
        },
      });
      expect(d.connectedAt).toEqual(expect.any(String));
      await expect(service.getConnection(randomUUID())).rejects.toMatchObject({
        httpStatus: 404,
      });
    });

    it('never returns a token, secret, oauth state, webhook secret or payload anywhere in the JSON', async () => {
      const out = JSON.stringify([
        await service.listConnections({ page: 1, limit: 20, order: 'DESC' }),
        await service.getConnection(CONN_A),
        await service.listSyncHistory({ page: 1, limit: 20, order: 'DESC' }),
        await service.listWebhookEvents({ page: 1, limit: 20, order: 'DESC' }),
        await service.checkConnection(CONN_A),
      ]);
      for (const secret of [TOKEN, REFRESH, WEBHOOK_SECRET, PAYLOAD, NONCE]) {
        expect(out).not.toContain(secret);
      }
      const keys = new Set<string>();
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
          for (const [k, child] of Object.entries(v)) {
            keys.add(k.toLowerCase());
            walk(child);
          }
        }
      };
      walk(JSON.parse(out));
      for (const forbidden of [
        'accesstoken',
        'refreshtoken',
        'access_token',
        'refresh_token',
        'encryptedaccesstoken',
        'encryptedrefreshtoken',
        'encryptedwebhooksecret',
        'encryptedpayload',
        'webhooksecret',
        'oauthstatenonce',
        'oauthredirecturi',
        'payload',
        'credentialsummary',
        'partnerid',
        'connectionkey',
        'deduplicationkey',
      ]) {
        expect(keys).not.toContain(forbidden);
      }
    });

    it('sync history filters by connection, store, status, type and day (Asia/Ho_Chi_Minh)', async () => {
      const failed = await service.listSyncHistory({
        page: 1,
        limit: 20,
        order: 'DESC',
        connectionId: CONN_A,
        status: 'failed_permanent',
        jobType: 'order_poll',
      });
      expect(failed.data).toHaveLength(1);
      expect(failed.data[0]).toMatchObject({
        code: 'JOB-2',
        connectionId: CONN_A,
        jobType: 'order_poll',
        status: 'failed_permanent',
        attemptCount: 0,
      });
      const store = await service.listSyncHistory({
        page: 1,
        limit: 20,
        order: 'DESC',
        tenantId: B,
      });
      expect(store.data.map((j) => j.code)).toEqual(['JOB-4']);
      const today = new Date(Date.now() + 7 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);
      const inRange = await service.listSyncHistory({
        page: 1,
        limit: 20,
        order: 'DESC',
        from: today,
        to: today,
      });
      expect(inRange.pagination.totalRecords).toBe(4);
      const past = await service.listSyncHistory({
        page: 1,
        limit: 20,
        order: 'DESC',
        to: '2020-01-01',
      });
      expect(past.pagination.totalRecords).toBe(0);
      await expect(
        service.listSyncHistory({
          page: 1,
          limit: 20,
          order: 'DESC',
          from: '2026-02-30',
        }),
      ).rejects.toMatchObject({ httpStatus: 422 });
    });

    it('webhook events filter by connection, provider and status', async () => {
      const one = await service.listWebhookEvents({
        page: 1,
        limit: 20,
        order: 'DESC',
        connectionId: CONN_B,
        provider: 'shopee',
        status: 'needs_review',
      });
      expect(one.data).toEqual([
        expect.objectContaining({
          connectionId: CONN_B,
          provider: 'shopee',
          eventType: 'order.created',
          externalEventId: 'ev-b',
          status: 'needs_review',
          errorMessage: null,
        }),
      ]);
      const none = await service.listWebhookEvents({
        page: 1,
        limit: 20,
        order: 'DESC',
        status: 'failed' as never,
      });
      expect(none.data).toHaveLength(0);
    });

    it('check reports the probe result and changes no state', async () => {
      const before = await admin.query(
        `SELECT status, version, updated_at FROM ${t('channel_connections')} WHERE id = $1`,
        [CONN_A],
      );
      const res = await service.checkConnection(CONN_A);
      expect(res).toMatchObject({
        status: 'connected',
        message: 'The connection is healthy',
      });
      expect(new Date(res.checkedAt).getTime()).toBeLessThanOrEqual(Date.now());
      const after = await admin.query(
        `SELECT status, version, updated_at FROM ${t('channel_connections')} WHERE id = $1`,
        [CONN_A],
      );
      expect(after).toEqual(before);
      await expect(service.checkConnection(randomUUID())).rejects.toMatchObject(
        { httpStatus: 404 },
      );
    });
  });

  describe('disconnect', () => {
    const adminActor = { id: 'admin-1', name: null };

    it('disconnects with the store-side transition, keeps synced data, emits the event with actor and reason', async () => {
      const mappingsBefore = await admin.query(
        `SELECT count(*)::int AS n FROM ${t('sku_mappings')} WHERE connection_id = $1`,
        [CONN_A],
      );
      const res = await service.disconnect({
        id: CONN_A,
        reason: 'Abuse reported',
        admin: adminActor,
        idempotencyKey: 'key-1',
      });
      expect(res.replayed).toBe(false);
      expect(res.connection.status).toBe('disconnected');

      const [cred] = await admin.query(
        `SELECT encrypted_access_token, encrypted_refresh_token, credential_version FROM ${t('connection_credentials')} WHERE connection_id = $1`,
        [CONN_A],
      );
      expect(cred.encrypted_access_token).toBeNull();
      expect(cred.encrypted_refresh_token).toBeNull();
      expect(cred.credential_version).toBe(2);
      const mappingsAfter = await admin.query(
        `SELECT count(*)::int AS n FROM ${t('sku_mappings')} WHERE connection_id = $1`,
        [CONN_A],
      );
      expect(mappingsAfter).toEqual(mappingsBefore);

      expect(enqueue).toHaveBeenCalledTimes(1);
      const [, def, options] = enqueue.mock.calls[0] as unknown as [
        unknown,
        { type: string },
        { tenantId: string; actor: unknown; payload: Record<string, unknown> },
      ];
      expect(def.type).toBe('integration.connection.disconnected');
      expect(options.tenantId).toBe(A);
      expect(options.actor).toEqual({ id: 'admin-1', type: 'platform_admin' });
      expect(options.payload).toMatchObject({
        connectionId: CONN_A,
        status: 'DISCONNECTED',
        reason: 'Abuse reported',
        actor: { type: 'platform_admin', id: 'admin-1', name: null },
      });
      const audit = await admin.query(
        `SELECT actor_id, metadata FROM ${t('integration_audit_logs')} WHERE connection_id = $1`,
        [CONN_A],
      );
      expect(audit[0].actor_id).toBe('admin-1');
      expect(audit[0].metadata).toMatchObject({
        reason: 'Abuse reported',
        actorType: 'platform_admin',
      });
    });

    it('replays the same Idempotency-Key without a second event, and answers 400 without one', async () => {
      enqueue.mockClear();
      const replay = await service.disconnect({
        id: CONN_A,
        reason: 'Abuse reported',
        admin: adminActor,
        idempotencyKey: 'key-1',
      });
      expect(replay.replayed).toBe(true);
      expect(replay.connection.status).toBe('disconnected');
      expect(enqueue).not.toHaveBeenCalled();

      await expect(
        service.disconnect({ id: CONN_A, reason: 'again', admin: adminActor }),
      ).rejects.toMatchObject({
        httpStatus: 400,
        code: 'CHANNEL_CONNECTION_ALREADY_DISCONNECTED',
      });
      await expect(
        service.disconnect({
          id: CONN_A,
          reason: 'again',
          admin: adminActor,
          idempotencyKey: 'key-2',
        }),
      ).rejects.toMatchObject({ httpStatus: 400 });
    });

    it('404 for an unknown connection and the other store is untouched', async () => {
      await expect(
        service.disconnect({
          id: randomUUID(),
          reason: 'x',
          admin: adminActor,
        }),
      ).rejects.toMatchObject({ httpStatus: 404 });
      const [b] = await admin.query(
        `SELECT status FROM ${t('channel_connections')} WHERE id = $1`,
        [CONN_B],
      );
      expect(b.status).toBe('REAUTH_REQUIRED');
    });

    it('can disconnect a connection that was never authorised (no credentials, no event)', async () => {
      const id = randomUUID();
      await connection(id, B, BR_B, 'Fresh Shop', 'PENDING_AUTH');
      enqueue.mockClear();
      const res = await service.disconnect({
        id,
        reason: 'cleanup',
        admin: adminActor,
      });
      expect(res.connection.status).toBe('disconnected');
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe('name projections', () => {
    const handler = new NameProjectionHandler();
    const event = (id: string, name: string, updatedAt: string) =>
      ({
        tenantId: A,
        payload: { id, name, updatedAt },
      }) as unknown as EventEnvelope<never>;

    it('applies the newest name and ignores an older or repeated event', async () => {
      const tenant = randomUUID();
      const apply = (name: string, at: string) =>
        roleDs.transaction((em) =>
          handler.onTenantUpdated(event(tenant, name, at), em),
        );
      await apply('Second', '2031-01-02T00:00:00.000Z');
      await apply('First', '2031-01-01T00:00:00.000Z');
      await apply('Second', '2031-01-02T00:00:00.000Z');
      const [row] = await admin.query(
        `SELECT name FROM ${t('tenant_projection')} WHERE tenant_id = $1`,
        [tenant],
      );
      expect(row.name).toBe('Second');

      const branch = randomUUID();
      await roleDs.transaction((em) =>
        handler.onBranchCreated(
          event(branch, 'CN9', '2031-01-01T00:00:00.000Z'),
          em,
        ),
      );
      await roleDs.transaction((em) =>
        handler.onBranchUpdated(
          event(branch, 'CN9 renamed', '2031-02-01T00:00:00.000Z'),
          em,
        ),
      );
      const [b] = await admin.query(
        `SELECT name, tenant_id FROM ${t('branch_projection')} WHERE branch_id = $1`,
        [branch],
      );
      expect(b).toEqual({ name: 'CN9 renamed', tenant_id: A });
    });
  });
});
