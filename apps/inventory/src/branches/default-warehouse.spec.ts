import { TenantScopedRepository } from '@pbl/common';
import { EntityManager } from 'typeorm';
import { BranchProjectionHandler } from './branch-projection.handler';
import { resolveBranchWarehouse } from './branch-warehouse';
import {
  deactivateEmptyBranchWarehouses,
  ensureDefaultBranchWarehouse,
  warehouseCodeCandidate,
  warehouseCodeFromBranch,
} from './default-warehouse';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRANCH = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';

/** A manager whose `query` answers from a script, in order of the SQL it matches */
function fakeManager(
  answers: [RegExp, unknown[]][],
): EntityManager & { calls: [string, unknown[]][] } {
  const calls: [string, unknown[]][] = [];
  return {
    calls,
    connection: { options: { schema: 'inv' } },
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      const hit = answers.find(([re]) => re.test(sql));
      return hit ? hit[1] : [];
    }),
  } as unknown as EntityManager & { calls: [string, unknown[]][] };
}
const inserts = (m: { calls: [string, unknown[]][] }) =>
  m.calls.filter(([sql]) => /INSERT INTO/.test(sql));

describe('warehouse code from a branch code', () => {
  it('upper-cases, joins spaces and drops characters a code does not allow', () => {
    expect(warehouseCodeFromBranch(' cn 01 ')).toBe('CN-01');
    expect(warehouseCodeFromBranch('hà#nội')).toBe('HNI');
    expect(warehouseCodeFromBranch('-x')).toBe('WH-X');
  });

  it('numbers a clash and stays within 32 characters', () => {
    expect(warehouseCodeCandidate('CN01', 1)).toBe('CN01');
    expect(warehouseCodeCandidate('CN01', 3)).toBe('CN01-3');
    const long = 'A'.repeat(40);
    expect(warehouseCodeCandidate(long, 1)).toHaveLength(32);
    expect(warehouseCodeCandidate(long, 12)).toHaveLength(32);
    expect(warehouseCodeCandidate(long, 12).endsWith('-12')).toBe(true);
  });
});

describe('ensureDefaultBranchWarehouse', () => {
  const branch = {
    id: BRANCH,
    code: 'CN01',
    name: 'Chi nhanh',
    status: 'active',
  };

  it('creates the default BRANCH warehouse of an active branch with none', async () => {
    const m = fakeManager([]);
    const id = await ensureDefaultBranchWarehouse(m, TENANT, branch);
    expect(id).toEqual(expect.any(String));
    const [[sql, params]] = inserts(m);
    expect(sql).toContain(`'BRANCH', true, 'ACTIVE'`);
    expect(params.slice(1)).toEqual([TENANT, BRANCH, 'CN01', 'Chi nhanh']);
  });

  it('takes the next code when the tenant already uses it', async () => {
    let n = 0;
    const m = fakeManager([]);
    (m.query as jest.Mock).mockImplementation(async (sql: string) =>
      /SELECT 1 FROM/.test(sql) ? (n++ < 2 ? [{}] : []) : [],
    );
    await ensureDefaultBranchWarehouse(m, TENANT, branch);
    const insert = (m.query as jest.Mock).mock.calls.find(([s]) =>
      /INSERT INTO/.test(s),
    );
    expect(insert[1][3]).toBe('CN01-3');
  });

  it('keeps an existing default and creates nothing', async () => {
    const m = fakeManager([
      [
        /FROM "inv"."warehouse"\s+WHERE/,
        [{ id: 'w1', status: 'ACTIVE', isDefault: true }],
      ],
    ]);
    expect(await ensureDefaultBranchWarehouse(m, TENANT, branch)).toBe('w1');
    expect(inserts(m)).toHaveLength(0);
    expect(m.calls.some(([s]) => /UPDATE/.test(s))).toBe(false);
  });

  it('re-activates the default only when asked to', async () => {
    const rows = [{ id: 'w1', status: 'INACTIVE', isDefault: true }];
    const on = fakeManager([[/FROM "inv"."warehouse"\s+WHERE/, rows]]);
    await ensureDefaultBranchWarehouse(on, TENANT, branch, true);
    expect(
      on.calls.some(([s]) =>
        /SET is_default = true, status = 'ACTIVE'/.test(s),
      ),
    ).toBe(true);
    const off = fakeManager([[/FROM "inv"."warehouse"\s+WHERE/, rows]]);
    await ensureDefaultBranchWarehouse(off, TENANT, branch, false);
    expect(off.calls.some(([s]) => /UPDATE/.test(s))).toBe(false);
  });

  it('promotes the oldest BRANCH warehouse when the branch has none as default', async () => {
    const m = fakeManager([
      [
        /FROM "inv"."warehouse"\s+WHERE/,
        [{ id: 'w2', status: 'ACTIVE', isDefault: false }],
      ],
    ]);
    expect(await ensureDefaultBranchWarehouse(m, TENANT, branch)).toBe('w2');
    expect(inserts(m)).toHaveLength(0);
  });

  it('does nothing for a branch that is not active', async () => {
    const m = fakeManager([]);
    expect(
      await ensureDefaultBranchWarehouse(m, TENANT, {
        ...branch,
        status: 'inactive',
      }),
    ).toBeNull();
    expect(m.calls).toHaveLength(0);
  });

  it('deactivates only warehouses without stock', async () => {
    const m = fakeManager([]);
    await deactivateEmptyBranchWarehouses(m, TENANT, BRANCH);
    const [sql] = m.calls[0];
    expect(sql).toContain("SET status = 'INACTIVE'");
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('on_hand_qty > 0');
  });
});

describe('BranchProjectionHandler', () => {
  const payload = (status: string, updatedAt = '2026-01-02T00:00:00.000Z') => ({
    id: BRANCH,
    code: 'CN01',
    name: 'Chi nhanh',
    isWarehouse: false,
    status,
    updatedAt,
  });
  const run = async (
    existing: { status: string; sourceUpdatedAt: Date } | null,
    status: string,
    updatedAt?: string,
  ) => {
    const repo = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (x) => x),
    };
    jest
      .spyOn(TenantScopedRepository, 'forEntity')
      .mockReturnValue(repo as never);
    const m = fakeManager([]);
    await new BranchProjectionHandler().onUpdated(
      { tenantId: TENANT, payload: payload(status, updatedAt) } as never,
      m,
    );
    return { m, repo };
  };
  afterEach(() => jest.restoreAllMocks());

  it('creates the warehouse in the same manager as the projection upsert', async () => {
    const { m, repo } = await run(null, 'active');
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(inserts(m)).toHaveLength(1);
  });

  it('creates nothing and switches empty warehouses off for an inactive or deleted branch', async () => {
    for (const status of ['inactive', 'deleted']) {
      const { m } = await run(null, status);
      expect(inserts(m)).toHaveLength(0);
      expect(m.calls.some(([s]) => /SET status = 'INACTIVE'/.test(s))).toBe(
        true,
      );
    }
  });

  it('ignores an event older than the projection', async () => {
    const { m, repo } = await run(
      { status: 'active', sourceUpdatedAt: new Date('2026-05-01') },
      'inactive',
    );
    expect(repo.save).not.toHaveBeenCalled();
    expect(m.calls.some(([s]) => /UPDATE|INSERT/.test(s))).toBe(false);
  });
});

describe('resolveBranchWarehouse', () => {
  const wh = (over: Record<string, unknown>) => ({
    id: 'w',
    code: 'W',
    name: 'W',
    kind: 'BRANCH',
    branchId: BRANCH,
    status: 'ACTIVE',
    ...over,
  });

  it.each([
    ['another branch', wh({ branchId: 'other' })],
    ['a CENTRAL warehouse', wh({ kind: 'CENTRAL', branchId: null })],
    ['a QUARANTINE warehouse', wh({ kind: 'QUARANTINE', branchId: null })],
  ])('refuses %s with WAREHOUSE_NOT_IN_BRANCH', async (_n, row) => {
    const m = fakeManager([[/WHERE tenant_id = \$1 AND id = \$2/, [row]]]);
    await expect(
      resolveBranchWarehouse(m, TENANT, BRANCH, 'w'),
    ).rejects.toMatchObject({
      code: 'WAREHOUSE_NOT_IN_BRANCH',
      httpStatus: 409,
    });
  });

  it('refuses an unknown or inactive named warehouse', async () => {
    await expect(
      resolveBranchWarehouse(fakeManager([]), TENANT, BRANCH, 'w'),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_NOT_FOUND', httpStatus: 404 });
    const m = fakeManager([
      [/WHERE tenant_id = \$1 AND id = \$2/, [wh({ status: 'INACTIVE' })]],
    ]);
    await expect(
      resolveBranchWarehouse(m, TENANT, BRANCH, 'w'),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_INACTIVE' });
  });

  it('answers BRANCH_HAS_NO_WAREHOUSE without a default, else the default', async () => {
    await expect(
      resolveBranchWarehouse(fakeManager([]), TENANT, BRANCH),
    ).rejects.toMatchObject({
      code: 'BRANCH_HAS_NO_WAREHOUSE',
      httpStatus: 409,
    });
    const m = fakeManager([
      [/is_default AND status = 'ACTIVE'/, [{ id: 'd', code: 'D', name: 'D' }]],
    ]);
    expect(await resolveBranchWarehouse(m, TENANT, BRANCH)).toMatchObject({
      id: 'd',
    });
  });
});
