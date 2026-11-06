import { DataSource } from 'typeorm';
import { PlatformSettingReader } from './platform-setting.reader';

const reader = (rows: { key: string; value: unknown }[] | Error) => {
  const find = jest.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  const dataSource = {
    getRepository: () => ({ find }),
  } as unknown as DataSource;
  return { reader: new PlatformSettingReader(dataSource), find };
};

describe('PlatformSettingReader', () => {
  it('gives the defaults when nothing is stored: 7 days of grace, 5 attempts, 15 minutes', async () => {
    const { reader: r } = reader([]);
    expect(await r.graceDays()).toBe(7);
    expect(await r.lockout()).toEqual({
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000,
    });
  });

  it('reads stored values, and never lets the attempts fall below 3', async () => {
    const { reader: r } = reader([
      { key: 'billing.graceDays', value: 0 },
      { key: 'security.lockoutMaxAttempts', value: 1 },
      { key: 'security.lockoutWindowMinutes', value: 30 },
    ]);
    expect(await r.graceDays()).toBe(0);
    expect(await r.lockout()).toEqual({
      maxAttempts: 3,
      windowMs: 30 * 60 * 1000,
    });
  });

  it('caches for 30 seconds', async () => {
    const { reader: r, find } = reader([]);
    await r.graceDays(1_000);
    await r.lockout(20_000);
    expect(find).toHaveBeenCalledTimes(1);
    await r.graceDays(40_000);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('falls back to the defaults when the settings cannot be read', async () => {
    const { reader: r } = reader(new Error('down'));
    expect(await r.graceDays()).toBe(7);
  });
});
