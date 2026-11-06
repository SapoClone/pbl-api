/**
 * The platform admin's accounts, admins and settings against a real Postgres, in a throwaway schema. Run with
 * `pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1`
 */
import { randomUUID } from 'crypto';
import {
  PlatformAdminRole,
  PlatformAdminStatus,
} from '../src/api/platform-admin/entities/platform-admin.entity';
import { startAdminDb } from './support/admin-harness';

const SUPER = randomUUID();

describe('platform admin accounts, admins and settings (Postgres)', () => {
  let h: Awaited<ReturnType<typeof startAdminDb>>;
  const sql = <T = unknown>(text: string, params: unknown[] = []) =>
    h.sql<T>(text, params);
  const ids: Record<string, string> = {};

  const insertAccount = async (key: string, createdAt: string) => {
    const [{ id }] = await sql<{ id: string }[]>(
      `INSERT INTO "account" ("email","password","name","created_at","created_by","updated_by")
       VALUES ($1,'x',$2,$3,'t','t') RETURNING "id"`,
      [`${key}@old.vn`, `Old ${key}`, createdAt],
    );
    ids[key] = id;
  };

  beforeAll(async () => {
    h = await startAdminDb('people');
    // accounts that exist before the migration: it gives them codes in sign-up order
    await insertAccount('second', '2026-02-01T00:00:00Z');
    await insertAccount('first', '2026-01-01T00:00:00Z');
    await h.applyPlanMigration();
  });
  afterAll(() => h.stop());

  describe('account codes', () => {
    it('backfills US00001 in sign-up order and issues the next one to a new account', async () => {
      const codes = await sql<{ email: string; code: string }[]>(
        `SELECT "email","code" FROM "account" ORDER BY "code"`,
      );
      expect(codes).toEqual([
        { email: 'first@old.vn', code: 'US00001' },
        { email: 'second@old.vn', code: 'US00002' },
      ]);
      const store = await h.services.tenants.create(SUPER, {
        name: 'Mộc Store',
        subdomain: 'moc-store',
        owner: { name: 'Minh Anh', email: 'minhanh@moc.vn' },
      });
      ids.store = store.id;
      const [owner] = await sql<{ id: string; code: string }[]>(
        `SELECT "id","code" FROM "account" WHERE "email" = 'minhanh@moc.vn'`,
      );
      expect(owner.code).toBe('US00003');
      ids.owner = owner.id;
    });
  });

  describe('accounts', () => {
    it('lists accounts with their stores and roles, and filters', async () => {
      const all = await h.services.accounts.list({
        limit: 20,
        page: 1,
      } as never);
      expect(all.pagination.totalRecords).toBe(3);
      const owner = all.data.find((a) => a.email === 'minhanh@moc.vn');
      expect(owner).toMatchObject({
        code: 'US00003',
        name: 'Minh Anh',
        status: 'active',
        memberships: [
          { tenantId: ids.store, tenantName: 'Mộc Store', role: 'owner' },
        ],
      });
      const list = (query: object) =>
        h.services.accounts.list({ limit: 20, page: 1, ...query } as never);
      expect((await list({ q: 'minh' })).data).toHaveLength(1);
      expect((await list({ q: 'US00002' })).data[0].email).toBe(
        'second@old.vn',
      );
      expect((await list({ tenantId: ids.store })).data).toHaveLength(1);
      expect((await list({ role: 'owner' })).data).toHaveLength(1);
      expect((await list({ role: 'sales_staff' })).data).toHaveLength(0);
      expect((await list({ role: 'custom' })).data).toHaveLength(0);
      expect((await list({ status: 'disabled' })).data).toHaveLength(0);
      expect(
        (await list({ status: 'pending_verification' })).data,
      ).toHaveLength(0);
    });

    it('treats a role of the store`s own as custom', async () => {
      await sql(
        `UPDATE "account_tenant" SET "role" = 'night_guard' WHERE "account_id" = $1`,
        [ids.owner],
      );
      const custom = await h.services.accounts.list({
        limit: 20,
        page: 1,
        role: 'custom',
      } as never);
      expect(custom.data.map((a) => a.email)).toEqual(['minhanh@moc.vn']);
      await sql(
        `UPDATE "account_tenant" SET "role" = 'owner' WHERE "account_id" = $1`,
        [ids.owner],
      );
    });

    it('shows one account with a masked phone and its live session count', async () => {
      await sql(`UPDATE "account" SET "phone" = '0901234567' WHERE "id" = $1`, [
        ids.owner,
      ]);
      expect(await h.services.accounts.get(ids.owner)).toMatchObject({
        code: 'US00003',
        phoneMasked: '090 •••• •• 67',
        activeSessionCount: 0,
        memberships: [{ tenantCode: expect.stringMatching(/^TN/) }],
      });
      await expect(h.services.accounts.get(randomUUID())).rejects.toMatchObject(
        { status: 404 },
      );
    });

    it('lists live logins by family, newest first, and leaves out revoked and expired ones', async () => {
      const token = (
        familyId: string,
        hash: string,
        opts: {
          created: string;
          revoked?: string;
          expires: string;
          ua?: string;
        },
      ) =>
        sql(
          `INSERT INTO "refresh_token" ("family_id","subject_type","subject_id","tenant_id","token_hash","user_agent","ip","expires_at","revoked_at","created_at","created_by","updated_by")
           VALUES ($1,'account',$2,$3,$4,$5,'1.2.3.4',$6,$7,$8,'t','t')`,
          [
            familyId,
            ids.owner,
            ids.store,
            hash,
            opts.ua ?? 'Mozilla/5.0 (Windows NT 10.0) Chrome/120',
            opts.expires,
            opts.revoked ?? null,
            opts.created,
          ],
        );
      const live = randomUUID();
      const rotated = randomUUID();
      const dead = randomUUID();
      const old = randomUUID();
      // a login rotated once: the first token is revoked, the second is live
      await token(live, 'h1', {
        created: '2999-01-01T00:00:00Z',
        revoked: '2999-01-02T00:00:00Z',
        expires: '2999-02-01T00:00:00Z',
      });
      await token(live, 'h2', {
        created: '2999-01-02T00:00:00Z',
        expires: '2999-02-02T00:00:00Z',
      });
      await token(rotated, 'h3', {
        created: '2999-01-05T00:00:00Z',
        expires: '2999-02-05T00:00:00Z',
      });
      await token(dead, 'h4', {
        created: '2999-01-06T00:00:00Z',
        revoked: '2999-01-07T00:00:00Z',
        expires: '2999-02-06T00:00:00Z',
      });
      await token(old, 'h5', {
        created: '2000-01-01T00:00:00Z',
        expires: '2000-02-01T00:00:00Z',
      });

      const page = await h.services.accounts.sessionsOf(ids.owner, {
        limit: 20,
        page: 1,
      } as never);
      expect(page.pagination.totalRecords).toBe(2);
      expect(page.data.map((s) => s.sessionId)).toEqual([rotated, live]);
      expect(page.data[1]).toMatchObject({
        tenantName: 'Mộc Store',
        ip: '1.2.3.4',
        createdAt: '2999-01-01T00:00:00.000Z',
        lastUsedAt: '2999-01-02T00:00:00.000Z',
        expiresAt: '2999-02-02T00:00:00.000Z',
      });
      expect(
        (await h.services.accounts.get(ids.owner)).activeSessionCount,
      ).toBe(2);
    });

    it('ends the sessions of an account through the session service', async () => {
      expect(await h.services.accounts.revokeSessions(ids.owner)).toEqual({
        revokedCount: 2,
      });
      expect(h.sessions.revokeAll).toHaveBeenCalledWith(ids.owner);
      await expect(
        h.services.accounts.revokeSessions(randomUUID()),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('admins', () => {
    const add = (over: object = {}) =>
      h.services.admins.create(SUPER, {
        name: 'Quốc Minh',
        email: 'minh@omniretail.vn',
        role: PlatformAdminRole.ADMIN,
        ...over,
      });
    let superId: string;
    let adminId: string;

    beforeAll(async () => {
      const [{ id }] = await sql<{ id: string }[]>(
        `INSERT INTO "platform_admin" ("email","name","role","status","created_by","updated_by")
         VALUES ('lananh@omniretail.vn','Lan Anh','super_admin','active','t','t') RETURNING "id"`,
      );
      superId = id;
    });

    it('creates an admin, lower-casing the email, and refuses a taken email (A010)', async () => {
      const created = await add({ email: 'minh@omniretail.vn' });
      adminId = created.id;
      expect(created).toMatchObject({
        name: 'Quốc Minh',
        email: 'minh@omniretail.vn',
        role: 'admin',
        status: 'active',
        lastLoginAt: null,
      });
      await expect(add()).rejects.toMatchObject({
        response: { errorCode: 'admin.error.email_taken' },
      });
    });

    it('stores a password only as a hash, and an admin with none cannot sign in', async () => {
      await add({
        email: 'with-pw@omniretail.vn',
        password: 'Str0ngPassw0rd!',
      });
      const [row] = await sql<{ password: string | null }[]>(
        `SELECT "password" FROM "platform_admin" WHERE "email" = 'with-pw@omniretail.vn'`,
      );
      expect(row.password).toMatch(/^\$argon2/);
      const [none] = await sql<{ password: string | null }[]>(
        `SELECT "password" FROM "platform_admin" WHERE "email" = 'minh@omniretail.vn'`,
      );
      expect(none.password).toBeNull();
    });

    it('lists admins with filters', async () => {
      const list = (query: object) =>
        h.services.admins.list({ limit: 20, page: 1, ...query } as never);
      expect((await list({})).pagination.totalRecords).toBe(3);
      expect(
        (await list({ role: 'super_admin' })).data.map((a) => a.email),
      ).toEqual(['lananh@omniretail.vn']);
      expect((await list({ q: 'quốc' })).data).toHaveLength(2);
      expect((await list({ q: 'lananh' })).data).toHaveLength(1);
      expect((await list({ status: 'disabled' })).data).toHaveLength(0);
    });

    it('promotes an admin, then lets the other super admin demote them', async () => {
      h.sessions.revokeAllOfAdmin.mockClear();
      expect(
        await h.services.admins.update(superId, adminId, {
          role: PlatformAdminRole.SUPER_ADMIN,
        }),
      ).toMatchObject({ role: 'super_admin' });
      expect(
        await h.services.admins.update(superId, adminId, {
          role: PlatformAdminRole.ADMIN,
        }),
      ).toMatchObject({ role: 'admin' });
      // demoting ends the sessions at once: a token minted as super admin must not outlive the role (D36)
      expect(h.sessions.revokeAllOfAdmin).toHaveBeenCalledTimes(1);
      expect(h.sessions.revokeAllOfAdmin).toHaveBeenCalledWith(adminId);
    });

    it('refuses to demote or disable yourself (A011)', async () => {
      await expect(
        h.services.admins.update(superId, superId, {
          role: PlatformAdminRole.ADMIN,
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'admin.error.protected_admin' },
      });
      await expect(
        h.services.admins.update(superId, superId, {
          status: PlatformAdminStatus.DISABLED,
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'admin.error.protected_admin' },
      });
    });

    it('refuses to take the last super admin away (A011), even for another super admin', async () => {
      // adminId is a plain admin: they cannot act as the caller here, but the rule is about the target
      await expect(
        h.services.admins.update(adminId, superId, {
          status: PlatformAdminStatus.DISABLED,
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'admin.error.protected_admin' },
      });
      await expect(
        h.services.admins.update(adminId, superId, {
          role: PlatformAdminRole.ADMIN,
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'admin.error.protected_admin' },
      });
    });

    it('disables an admin and ends their sessions, and a disabled super admin can go once another stands', async () => {
      h.sessions.revokeAllOfAdmin.mockClear();
      await h.services.admins.update(superId, adminId, {
        status: PlatformAdminStatus.DISABLED,
      });
      expect(h.sessions.revokeAllOfAdmin).toHaveBeenCalledWith(adminId);
      await h.services.admins.update(superId, adminId, {
        role: PlatformAdminRole.SUPER_ADMIN,
        status: PlatformAdminStatus.ACTIVE,
      });
      // two active super admins now: either may be disabled by the other
      await h.services.admins.update(adminId, superId, {
        status: PlatformAdminStatus.DISABLED,
      });
      await expect(
        h.services.admins.update(adminId, randomUUID(), {
          role: PlatformAdminRole.ADMIN,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('serialises two changes that would together remove every super admin', async () => {
      await h.services.admins.update(adminId, superId, {
        status: PlatformAdminStatus.ACTIVE,
      });
      // both are active super admins; each disables the other at once
      const results = await Promise.allSettled([
        h.services.admins.update(superId, adminId, {
          status: PlatformAdminStatus.DISABLED,
        }),
        h.services.admins.update(adminId, superId, {
          status: PlatformAdminStatus.DISABLED,
        }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [{ n }] = await sql<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "platform_admin" WHERE "role" = 'super_admin' AND "status" = 'active'`,
      );
      expect(n).toBe(1);
    });
  });

  describe('settings', () => {
    it('answers the defaults of contract 04 before anything is set', async () => {
      expect(await h.services.settings.get()).toEqual({
        general: {
          platformName: 'Omniretail',
          supportEmail: 'support@omniretail.vn',
          timezone: 'Asia/Ho_Chi_Minh',
          dateFormat: 'dd/mm/yyyy',
          currency: 'VND',
          defaultLocale: 'vi',
        },
        security: {
          lockoutMaxAttempts: 5,
          lockoutWindowMinutes: 15,
          resetLinkTtlMinutes: 15,
          resetLinkSingleUse: true,
          auditRetentionMonths: 12,
        },
        email: {
          senderName: 'Omniretail',
          senderEmail: 'no-reply@omniretail.vn',
        },
        billing: { graceDays: 7 },
      });
    });

    it('changes a subset, one row per key, and leaves the rest alone', async () => {
      const saved = await h.services.settings.update(SUPER, {
        general: { supportEmail: 'help@omniretail.vn' },
        security: { lockoutMaxAttempts: 8, resetLinkSingleUse: false },
      });
      expect(saved.general.supportEmail).toBe('help@omniretail.vn');
      expect(saved.general.platformName).toBe('Omniretail');
      expect(saved.security).toMatchObject({
        lockoutMaxAttempts: 8,
        resetLinkSingleUse: false,
        lockoutWindowMinutes: 15,
      });
      const rows = await sql<{ key: string; updated_by: string }[]>(
        `SELECT "key","updated_by" FROM "platform_setting" ORDER BY "key"`,
      );
      expect(rows).toEqual([
        { key: 'general.supportEmail', updated_by: SUPER },
        { key: 'security.lockoutMaxAttempts', updated_by: SUPER },
        { key: 'security.resetLinkSingleUse', updated_by: SUPER },
      ]);
      // a second change of the same key replaces the row
      await h.services.settings.update(SUPER, {
        security: { lockoutMaxAttempts: 4 },
      });
      expect(
        (await h.services.settings.get()).security.lockoutMaxAttempts,
      ).toBe(4);
      expect(await sql(`SELECT 1 FROM "platform_setting"`)).toHaveLength(3);
    });
  });
});
