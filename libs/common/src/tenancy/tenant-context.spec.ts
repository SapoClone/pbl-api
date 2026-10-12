import { setImmediate as tick } from 'timers/promises';
import { RequestContext } from '../context/request-context';
import { MissingTenantContextError, TenantContext } from './tenant-context';

describe('TenantContext', () => {
  it('has no tenant outside any context', () => {
    expect(TenantContext.current()).toBeUndefined();
    expect(() => TenantContext.require()).toThrow(MissingTenantContextError);
  });

  it('exposes the tenant inside run(), across async continuations', async () => {
    const seen = await TenantContext.run('t1', async () => {
      const before = TenantContext.current();
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return [before, TenantContext.current(), TenantContext.require()];
    });

    expect(seen).toEqual(['t1', 't1', 't1']);
    expect(TenantContext.current()).toBeUndefined();
  });

  it('keeps concurrent contexts apart', async () => {
    const read = (tenantId: string) =>
      TenantContext.run(tenantId, async () => {
        await tick();
        return TenantContext.require();
      });

    await expect(
      Promise.all([read('a'), read('b'), read('c')]),
    ).resolves.toEqual(['a', 'b', 'c']);
  });

  it('runs with a null tenant: current() is null and require() throws', () => {
    TenantContext.run(null, () => {
      expect(TenantContext.current()).toBeNull();
      expect(() => TenantContext.require()).toThrow(MissingTenantContextError);
    });
  });

  it('is a view over the request context store', () => {
    RequestContext.run({ tenantId: 't9' }, () => {
      expect(TenantContext.current()).toBe('t9');
      expect(RequestContext.get()).toEqual({ tenantId: 't9' });
    });
  });

  it('keeps the other request-context fields when nested', () => {
    const outer = { tenantId: null, extra: 'x' } as unknown as {
      tenantId: string | null;
    };
    RequestContext.run(outer, () => {
      TenantContext.run('t2', () => {
        expect(RequestContext.get()).toEqual({ tenantId: 't2', extra: 'x' });
      });
      expect(TenantContext.current()).toBeNull();
    });
  });

  it('MissingTenantContextError is a plain Error (a 500, not a client error)', () => {
    const error = new MissingTenantContextError();
    expect(error).toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(error.constructor)).toBe(Error);
    expect(error.name).toBe('MissingTenantContextError');
  });
});
