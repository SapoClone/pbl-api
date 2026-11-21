import { RequestContext } from '../context';
import { TenantContext } from '../tenancy';
import {
  consumeEvent,
  createEvent,
  createPlatformEvent,
  InvalidEventEnvelopeError,
} from './event-envelope';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('createEvent', () => {
  it('takes tenant, trace id and actor from the context', () => {
    const event = RequestContext.run(
      {
        tenantId: 'tenant-1',
        requestId: 'req-1',
        actor: { id: 'user-1', type: 'account' },
      },
      () => createEvent('order.created', 1, { orderId: 'o1' }),
    );
    expect(event).toEqual({
      id: expect.stringMatching(UUID),
      type: 'order.created',
      version: 1,
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      tenantId: 'tenant-1',
      actor: { id: 'user-1', type: 'account' },
      traceId: 'req-1',
      payload: { orderId: 'o1' },
    });
  });

  it('uses a null actor when anonymous and a generated trace id when none', () => {
    const event = TenantContext.run('tenant-1', () => createEvent('x', 1, {}));
    expect(event.actor).toBeNull();
    expect(event.traceId).toMatch(UUID);
  });

  it('throws without a tenant', () => {
    expect(() => createEvent('x', 1, {})).toThrow();
    expect(() =>
      TenantContext.run(null, () => createEvent('x', 1, {})),
    ).toThrow();
  });
});

describe('createPlatformEvent', () => {
  it('has no tenant, whatever the context says, and keeps trace and actor', () => {
    const event = RequestContext.run(
      {
        tenantId: 'tenant-1',
        requestId: 'req-1',
        actor: { id: 'admin-1', type: 'platform_admin' },
      },
      () => createPlatformEvent('platform.settings.changed', 1, { k: 1 }),
    );
    expect(event).toEqual({
      id: expect.stringMatching(UUID),
      type: 'platform.settings.changed',
      version: 1,
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      tenantId: null,
      actor: { id: 'admin-1', type: 'platform_admin' },
      traceId: 'req-1',
      payload: { k: 1 },
    });
  });

  it('needs no context at all', () => {
    expect(createPlatformEvent('x', 1, {}).tenantId).toBeNull();
  });
});

describe('consumeEvent of a platform-scope event', () => {
  it('accepts tenantId null and enters no tenant context', async () => {
    const seen = await RequestContext.run(
      { tenantId: 'leaked', requestId: 'other' },
      () =>
        consumeEvent(createPlatformEvent('x', 1, { n: 1 }), async (event) => ({
          tenantId: event.tenantId,
          tenant: TenantContext.current(),
          required: () => TenantContext.require(),
        })),
    );
    expect(seen.tenantId).toBeNull();
    expect(seen.tenant).toBeNull();
    expect(seen.required).toThrow();
  });
});

describe('consumeEvent', () => {
  const envelope = () =>
    RequestContext.run({ tenantId: 'tenant-9', requestId: 'req-9' }, () =>
      createEvent('x', 2, { n: 1 }),
    );

  it('runs the handler in the envelope tenant and trace id, without any caller credentials', async () => {
    const seen = await RequestContext.run(
      { tenantId: 'other', authorization: 'Bearer leaked' },
      () =>
        consumeEvent(envelope(), async (event) => {
          await new Promise((resolve) => setImmediate(resolve));
          return {
            payload: event.payload,
            tenant: TenantContext.current(),
            state: RequestContext.get(),
          };
        }),
    );
    expect(seen.payload).toEqual({ n: 1 });
    expect(seen.tenant).toBe('tenant-9');
    expect(seen.state?.requestId).toBe('req-9');
    expect(seen.state?.authorization).toBeUndefined();
  });

  it.each([
    ['tenantId missing', { tenantId: undefined }],
    ['tenantId empty', { tenantId: '' }],
    ['id missing', { id: undefined }],
    ['type missing', { type: undefined }],
    ['version not a number', { version: 'a' }],
    ['traceId missing', { traceId: undefined }],
    ['occurredAt invalid', { occurredAt: 'nope' }],
    ['actor malformed', { actor: { id: 1 } }],
  ])('rejects an envelope with %s', async (_, patch) => {
    const handler = jest.fn();
    await expect(
      consumeEvent({ ...envelope(), ...patch } as any, handler),
    ).rejects.toThrow(InvalidEventEnvelopeError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a non-object', async () => {
    await expect(consumeEvent(null as any, jest.fn())).rejects.toThrow(
      InvalidEventEnvelopeError,
    );
  });
});
