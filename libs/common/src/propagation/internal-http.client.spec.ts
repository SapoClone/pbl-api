import { Test } from '@nestjs/testing';
import { createServer, IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';
import { RequestContext } from '../context';
import { TenantContext } from '../tenancy';
import { InternalHttpClient } from './internal-http.client';
import { PblPropagationModule } from './pbl-propagation.module';

describe('InternalHttpClient', () => {
  let server: Server;
  let baseUrl: string;
  let received: IncomingHttpHeaders;
  let client: InternalHttpClient;

  beforeAll(async () => {
    server = createServer((req, res) => {
      received = req.headers;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const moduleRef = await Test.createTestingModule({
      imports: [PblPropagationModule.forRoot()],
    }).compile();
    client = moduleRef.get(InternalHttpClient);
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  const inContext = <T>(fn: () => T) =>
    RequestContext.run(
      {
        tenantId: 'tenant-1',
        requestId: 'req-123',
        authorization: 'Bearer abc.def.ghi',
        actor: { id: 'user-1', type: 'account' },
      },
      fn,
    );

  it('forwards Authorization and X-Request-Id from the context', async () => {
    const res = await inContext(() => client.get(`${baseUrl}/x`));
    expect(res.data).toEqual({ ok: true });
    expect(received['authorization']).toBe('Bearer abc.def.ghi');
    expect(received['x-request-id']).toBe('req-123');
  });

  it('never adds tenant or user headers, even when the context has a tenant', async () => {
    await inContext(() => client.post(`${baseUrl}/x`, { a: 1 }));
    expect(received['x-tenant-id']).toBeUndefined();
    expect(Object.keys(received).filter((h) => h.startsWith('x-user'))).toEqual(
      [],
    );
  });

  it('drops caller-supplied tenant/user headers and cannot override the forwarded ones', async () => {
    await inContext(() =>
      client.get(`${baseUrl}/x`, {
        headers: {
          'X-Tenant-Id': 'evil',
          'x-user-id': 'evil',
          Authorization: 'Bearer evil',
          'X-Request-Id': 'evil',
        },
      }),
    );
    expect(received['x-tenant-id']).toBeUndefined();
    expect(received['x-user-id']).toBeUndefined();
    expect(received['authorization']).toBe('Bearer abc.def.ghi');
    expect(received['x-request-id']).toBe('req-123');
  });

  it('throws outside a request context', async () => {
    await expect(client.get(`${baseUrl}/x`)).rejects.toThrow(
      /request context/i,
    );
  });

  it('allows a call outside a context with { asService: true }, sending no user credentials', async () => {
    await client.get(`${baseUrl}/x`, undefined, { asService: true });
    expect(received['authorization']).toBeUndefined();
    expect(received['x-tenant-id']).toBeUndefined();
  });

  it('with asService inside a context still sends no tenant header', async () => {
    await TenantContext.run('tenant-1', () =>
      client.get(`${baseUrl}/x`, undefined, { asService: true }),
    );
    expect(received['x-tenant-id']).toBeUndefined();
  });
});
