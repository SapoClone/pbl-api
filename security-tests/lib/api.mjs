import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PASSWORD = 'Passw0rd!';
export const UUID_ZERO = '00000000-0000-4000-8000-000000000000';

export function basesFor(gateway) {
  if (!gateway) {
    return {
      platform: 'http://127.0.0.1:3000/api/v1',
      catalog: 'http://127.0.0.1:3001/api/v1',
      inventory: 'http://127.0.0.1:3002/api/v1',
      sales: 'http://127.0.0.1:3003/api/v1',
      customer: 'http://127.0.0.1:3004/api/v1',
      health: { platform: 'http://127.0.0.1:3000/health' },
      mode: 'direct',
    };
  }
  const root = gateway.replace(/\/+$/, '');
  return {
    platform: `${root}/platform/api/v1`,
    catalog: `${root}/catalog/api/v1`,
    inventory: `${root}/inventory/api/v1`,
    sales: `${root}/sales/api/v1`,
    customer: `${root}/customer/api/v1`,
    health: {
      platform: `${root}/platform/health`,
      catalog: `${root}/catalog/health`,
      inventory: `${root}/inventory/health`,
      sales: `${root}/sales/health`,
      customer: `${root}/customer/health`,
    },
    mode: 'gateway',
  };
}

export async function http(method, url, { token, body, headers } = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return {
    status: response.status,
    json,
    text,
    headers: response.headers,
    ms: Date.now() - started,
  };
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function waitForHealth(bases, attempts = 30) {
  const targets = bases.mode === 'gateway'
    ? Object.entries(bases.health)
    : [['platform', bases.health.platform]];
  for (let i = 1; i <= attempts; i += 1) {
    const results = await Promise.all(
      targets.map(async ([name, url]) => {
        try {
          const r = await http('GET', url);
          return { name, ok: r.status === 200, status: r.status };
        } catch (error) {
          return { name, ok: false, status: error.message };
        }
      }),
    );
    if (results.every((r) => r.ok)) return results;
    if (i === attempts) {
      throw new Error(
        `Stack chưa sẵn sàng: ${results.map((r) => `${r.name}=${r.status}`).join(', ')}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export function register(httpBase, email, name) {
  return http('POST', `${httpBase}/auth/email/register`, {
    body: { email, password: PASSWORD, name },
  });
}

export function login(httpBase, email, tenantId) {
  return http('POST', `${httpBase}/auth/email/login`, {
    body: { email, password: PASSWORD, ...(tenantId ? { tenantId } : {}) },
  });
}

export function jwtPayload(token) {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
}

export function tamper(token) {
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  // Đổi payload nhưng giữ nguyên chữ ký cũ: chắc chắn chữ ký không còn khớp.
  // (Chỉ đổi ký tự cuối của chữ ký có thể trùng byte do bit đệm base64url.)
  payload.sec_tampered = true;
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return parts.join('.');
}

export function readPrivateKey(repoRoot) {
  const envPath = path.join(repoRoot, '.env.docker.platform');
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith('AUTH_JWT_PRIVATE_KEY='));
  assert(line, `Không tìm thấy AUTH_JWT_PRIVATE_KEY trong ${envPath}`);
  return Buffer.from(line.slice('AUTH_JWT_PRIVATE_KEY='.length), 'base64').toString('utf8');
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** A structurally valid RS256 token signed by the local key whose `exp` is in the past. */
export function expiredToken(privateKey, { sub, tid, roles = ['owner'], perms = ['*'], branches = ['*'] }) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${base64url({ alg: 'RS256', typ: 'JWT', kid: 'local-dev-1' })}.${base64url({
    sub,
    sid: UUID_ZERO,
    sub_type: 'store_user',
    tid,
    roles,
    perms,
    branches,
    iss: 'platform',
    aud: 'pbl6',
    iat: now - 7200,
    exp: now - 3600,
  })}`;
  const signature = crypto.sign('sha256', Buffer.from(input), privateKey).toString('base64url');
  return `${input}.${signature}`;
}

export async function ensureQuotas({ host, port, user, password, database }) {
  let pg;
  try {
    pg = await import('pg');
  } catch {
    return { updated: false, reason: 'pg không khả dụng' };
  }
  const { Client } = pg.default ?? pg;
  const client = new Client({ host, port, user, password, database });
  try {
    await client.connect();
    const result = await client.query(
      `UPDATE platform.plan
          SET quota_branches = GREATEST(quota_branches, 10),
              quota_users = GREATEST(quota_users, 50)
        WHERE code = 'free'`,
    );
    return { updated: true, rows: result.rowCount };
  } catch (error) {
    return { updated: false, reason: error.message };
  } finally {
    await client.end().catch(() => {});
  }
}
