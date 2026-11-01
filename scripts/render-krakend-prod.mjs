#!/usr/bin/env node
/**
 * Renders the production gateway config from `krakend/krakend.json` (the local one is the
 * single source of routes): the JWKS URL and the allowed web origins come from the
 * environment, and the local-only `disable_jwk_security` is dropped when the JWKS URL is https.
 *
 *   JWKS_URL=http://platform:3000/.well-known/jwks.json \
 *   CORS_ORIGINS=https://app.example.com,https://admin.example.com \
 *   node scripts/render-krakend-prod.mjs > krakend/krakend.prod.json
 *
 * Service hosts (`http://<service>:3000`) are kept: in ECS they are ECS Service Connect names.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(
  readFileSync(join(root, 'krakend/krakend.json'), 'utf8'),
);

const jwksUrl =
  process.env.JWKS_URL ?? 'http://platform:3000/.well-known/jwks.json';
const origins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (origins.some((o) => o === '*' || !/^https?:\/\/[^/]+$/.test(o))) {
  throw new Error(
    `CORS_ORIGINS must be exact origins (scheme://host[:port]), got ${origins}`,
  );
}

config.name = 'pbl6-gateway';
config.extra_config['security/cors'].allow_origins = origins;

let validators = 0;
for (const endpoint of config.endpoints) {
  const validator = endpoint.extra_config?.['auth/validator'];
  if (!validator) continue;
  validators += 1;
  validator.jwk_url = jwksUrl;
  if (jwksUrl.startsWith('https://')) delete validator.disable_jwk_security;
  else validator.disable_jwk_security = true;
}
if (validators === 0)
  throw new Error('no protected endpoint found: the config shape changed');

process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
