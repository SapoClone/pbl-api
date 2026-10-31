import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  InMemoryFileStorage,
  LocalDiskFileStorage,
  publicUrlFor,
} from './file-storage';

describe.each([
  ['memory', () => new InMemoryFileStorage(), async () => undefined],
])('%s storage', (_n, make) => {
  it('round-trips and deletes', async () => {
    const s = make();
    expect(await s.get('t/a/b.png')).toBeNull();
    await s.put('t/a/b.png', Buffer.from('x'), 'image/png');
    expect((await s.get('t/a/b.png'))?.toString()).toBe('x');
    await s.delete('t/a/b.png');
    expect(await s.get('t/a/b.png')).toBeNull();
  });

  it.each(['../x', 'a/../b', '/abs', 'a//b', ''])(
    'refuses key %j',
    async (k) => {
      await expect(
        make().put(k, Buffer.from('x'), 'text/csv'),
      ).rejects.toThrow();
    },
  );
});

describe('local disk storage', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'catalog-storage-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('round-trips, returns null for a missing key, refuses traversal', async () => {
    const s = new LocalDiskFileStorage(dir);
    await s.put('t/1/image/a.png', Buffer.from('abc'), 'image/png');
    expect((await s.get('t/1/image/a.png'))?.toString()).toBe('abc');
    expect(await s.get('t/1/image/none.png')).toBeNull();
    await s.delete('t/1/image/a.png');
    expect(await s.get('t/1/image/a.png')).toBeNull();
    await expect(
      s.put('../escape', Buffer.from('x'), 'text/csv'),
    ).rejects.toThrow();
  });
});

describe('publicUrlFor', () => {
  it('builds /t/<tenant>/p/<id>.<ext> under the asset base', () => {
    expect(publicUrlFor('T', 'I', 'png')).toBe('/static/t/T/p/I.png');
  });
});
