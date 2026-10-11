import { Test } from '@nestjs/testing';
import { createServer, IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';
import { inspect } from 'util';
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
      imports: [PblPropagationModule.forRoot({ baseURL: baseUrl })],
    }).compile();
    client = moduleRef.get(InternalHttpClient);
  });

  const clientWith = async (
    options: Parameters<typeof PblPropagationModule.forRoot>[0],
  ) =>
    (
      await Test.createTestingModule({
        imports: [PblPropagationModule.forRoot(options)],
      }).compile()
    ).get(InternalHttpClient);

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
  it('strips reserved headers inside nested axios blocks (common, get, post)', async () => {
    await inContext(() =>
      client.get(`${baseUrl}/x`, {
        headers: {
          common: { Authorization: 'Bearer evil', 'X-Tenant-Id': 'evil' },
          get: { authorization: 'Bearer evil', 'x-user-id': 'evil' },
          post: { 'X-Request-Id': 'evil' },
          'X-Custom': 'kept',
        } as any,
      }),
    );
    expect(received['authorization']).toBe('Bearer abc.def.ghi');
    expect(received['x-request-id']).toBe('req-123');
    expect(received['x-tenant-id']).toBeUndefined();
    expect(received['x-user-id']).toBeUndefined();
    expect(received['x-custom']).toBe('kept');
  });

  it('refuses config.auth', async () => {
    await expect(
      inContext(() =>
        client.get(`${baseUrl}/x`, { auth: { username: 'a', password: 'b' } }),
      ),
    ).rejects.toThrow(/config\.auth/);
  });

  describe('destination allow-list', () => {
    it('resolves a relative URL against baseURL', async () => {
      await inContext(() => client.get('/rel'));
      expect(received['authorization']).toBe('Bearer abc.def.ghi');
    });

    it('rejects an absolute URL on another origin than baseURL', async () => {
      await expect(
        inContext(() => client.get('http://evil.example/x')),
      ).rejects.toThrow(/Refusing to forward/);
    });

    it('rejects a protocol-relative URL on another host', async () => {
      await expect(
        inContext(() => client.get('//evil.example/x')),
      ).rejects.toThrow(/Refusing to forward/);
    });

    it('with allowedHosts, accepts a listed host and rejects others', async () => {
      const c = await clientWith({
        allowedHosts: [new URL(baseUrl).host],
      });
      await inContext(() => c.get(`${baseUrl}/x`));
      expect(received['authorization']).toBe('Bearer abc.def.ghi');
      await expect(
        inContext(() => c.get('http://evil.example/x')),
      ).rejects.toThrow(/Refusing to forward/);
    });

    it('with nothing configured, refuses to forward Authorization to an absolute URL', async () => {
      const c = await clientWith({});
      await expect(inContext(() => c.get(`${baseUrl}/x`))).rejects.toThrow(
        /Refusing to forward/,
      );
    });

    it('a relative URL without baseURL throws', async () => {
      const c = await clientWith({});
      await expect(inContext(() => c.get('/rel'))).rejects.toThrow(/baseURL/);
    });

    it('asService calls without Authorization stay allowed with nothing configured', async () => {
      const c = await clientWith({});
      await c.get(`${baseUrl}/x`, undefined, { asService: true });
      expect(received['authorization']).toBeUndefined();
    });
  });

  it('does not leak the token in a failed call error', async () => {
    const c = await clientWith({ baseURL: 'http://127.0.0.1:1' });
    const err: any = await inContext(() => c.get('/x')).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(JSON.stringify(err)).not.toContain('abc.def.ghi');
    expect(inspect(err, { depth: 8, showHidden: true })).not.toContain(
      'abc.def.ghi',
    );
    expect(err.config?.headers?.Authorization).toBeUndefined();
    expect(err.request).toBeUndefined();
  });

  it('does not leak the token in an HTTP error response', async () => {
    const failing = createServer((req, res) => {
      res.statusCode = 500;
      res.end('{}');
    });
    await new Promise<void>((r) => failing.listen(0, r));
    const url = `http://127.0.0.1:${(failing.address() as AddressInfo).port}`;
    const c = await clientWith({ baseURL: url });
    const err: any = await inContext(() => c.get('/x')).catch((e) => e);
    await new Promise((r) => failing.close(r));
    expect(err.response?.status).toBe(500);
    expect(JSON.stringify(err)).not.toContain('abc.def.ghi');
    expect(inspect(err, { depth: 8, showHidden: true })).not.toContain(
      'abc.def.ghi',
    );
  });
});
