import { MissingTenantContextError, RequestContext } from '@pbl/common';
import { PLATFORM_BRANCH_CREATED } from '@pbl/contracts';
import { EntityManager } from 'typeorm';
import { EventOutbox } from './event-outbox.service';

const managerWith = (insert: jest.Mock) =>
  ({ getRepository: () => ({ insert }) }) as unknown as EntityManager;

describe('EventOutbox', () => {
  const outbox = new EventOutbox();

  it('writes the context tenant, actor and trace id into the outbox row', async () => {
    const insert = jest.fn();
    const envelope = await RequestContext.run(
      {
        tenantId: 'tenant-a',
        requestId: 'req-1',
        actor: { id: 'acc-1', type: 'account' },
      },
      () =>
        outbox.add(managerWith(insert), PLATFORM_BRANCH_CREATED, { id: 'b1' }),
    );

    expect(envelope).toMatchObject({
      type: 'platform.branch.created',
      version: 1,
      tenantId: 'tenant-a',
      traceId: 'req-1',
      actor: { id: 'acc-1', type: 'account' },
      payload: { id: 'b1' },
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: envelope.id,
        tenantId: 'tenant-a',
        type: 'platform.branch.created',
        payload: envelope,
      }),
    );
  });

  it('refuses to run outside a tenant context', async () => {
    await expect(
      outbox.add(managerWith(jest.fn()), PLATFORM_BRANCH_CREATED, {}),
    ).rejects.toThrow(MissingTenantContextError);
  });

  it('takes an explicit tenant when the request has none (a login)', async () => {
    const insert = jest.fn();
    const envelope = await RequestContext.run(
      { tenantId: null, requestId: 'req-2', actor: null },
      () =>
        outbox.add(
          managerWith(insert),
          PLATFORM_BRANCH_CREATED,
          {},
          {
            tenantId: 'tenant-b',
          },
        ),
    );
    expect(envelope.tenantId).toBe('tenant-b');
    expect(envelope.traceId).toBe('req-2');
    expect(insert).toHaveBeenCalled();
  });

  it('does not write the row when the event cannot be built', async () => {
    const insert = jest.fn();
    await expect(
      outbox.add(managerWith(insert), PLATFORM_BRANCH_CREATED, {}),
    ).rejects.toBeDefined();
    expect(insert).not.toHaveBeenCalled();
  });
});
