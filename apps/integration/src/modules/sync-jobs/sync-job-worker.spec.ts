import { DataSource } from 'typeorm';
import { isSyncJobWorkerEnabled } from '../../config/integration.config';
import { SyncJobWorker } from './sync-job-worker';
import { SyncJobsService } from './sync-jobs.service';

function makeWorker(tenants: string[]) {
  const query = jest.fn(async (sql: string) =>
    sql.includes('DISTINCT tenant_id')
      ? tenants.map((tenant_id) => ({ tenant_id }))
      : [],
  );
  const em = { query, connection: { options: { schema: 'integration' } } };
  const dataSource = {
    transaction: jest.fn(async (fn: (e: typeof em) => unknown) => fn(em)),
  } as unknown as DataSource;
  const claimAndProcessBatch = jest.fn(async () => ({
    claimedCount: 2,
    jobs: [],
  }));
  const worker = new SyncJobWorker(dataSource, {
    claimAndProcessBatch,
  } as unknown as SyncJobsService);
  return { worker, query, claimAndProcessBatch };
}

describe('SyncJobWorker', () => {
  it('runs the due jobs of every store that has some, each with its own tenant', async () => {
    const { worker, query, claimAndProcessBatch } = makeWorker(['t1', 't2']);
    await expect(worker.run()).resolves.toBe(4);
    expect(query).toHaveBeenCalledWith(
      `SELECT set_config('app.sync_job_scheduler', 'on', true)`,
    );
    expect(query.mock.calls[1][0]).toContain('"integration"."sync_jobs"');
    expect(
      claimAndProcessBatch.mock.calls.map((c: any[]) => c[0].tenantId),
    ).toEqual(['t1', 't2']);
  });

  it('keeps going when one store fails', async () => {
    const { worker, claimAndProcessBatch } = makeWorker(['t1', 't2']);
    claimAndProcessBatch.mockRejectedValueOnce(new Error('boom'));
    await expect(worker.run()).resolves.toBe(2);
    expect(claimAndProcessBatch).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no job is due', async () => {
    const { worker, claimAndProcessBatch } = makeWorker([]);
    await expect(worker.run()).resolves.toBe(0);
    expect(claimAndProcessBatch).not.toHaveBeenCalled();
  });

  it('does not start a pass while the previous one is still running', async () => {
    const { worker, claimAndProcessBatch } = makeWorker(['t1']);
    let release!: () => void;
    claimAndProcessBatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ claimedCount: 1, jobs: [] });
        }),
    );
    const first = worker.run();
    await new Promise((r) => setImmediate(r));
    await expect(worker.run()).resolves.toBe(0);
    release();
    await expect(first).resolves.toBe(1);
  });
});

describe('isSyncJobWorkerEnabled', () => {
  it('is on outside tests and off under NODE_ENV=test', () => {
    expect(isSyncJobWorkerEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(isSyncJobWorkerEnabled({ NODE_ENV: 'test' })).toBe(false);
  });

  it('follows INTEGRATION_SYNC_WORKER_ENABLED when it is set', () => {
    expect(
      isSyncJobWorkerEnabled({
        NODE_ENV: 'test',
        INTEGRATION_SYNC_WORKER_ENABLED: 'true',
      }),
    ).toBe(true);
    expect(
      isSyncJobWorkerEnabled({
        NODE_ENV: 'production',
        INTEGRATION_SYNC_WORKER_ENABLED: 'false',
      }),
    ).toBe(false);
  });
});
