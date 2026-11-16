import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Settings of integration read from the environment (the one place it is
 * read). Required values fail closed: the service does not start without them,
 * except under NODE_ENV=test, where the tests set their own.
 */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

export const DEFAULT_LAZADA_CALLBACK_URL =
  'https://api.sai.makeasy.id.vn/api/v1/integrations/lazada/callback';

export interface LazadaProviderConfig {
  liveEnabled: boolean;
  appKey: string | null;
  appSecret: string | null;
  region: string;
  apiBaseUrl: string;
  authUrl: string;
  authApiBaseUrl: string;
  authTokenUrl: string;
  callbackUrl: string;
  oauthStateSecret: string | null;
  frontendRedirectUrl: string | null;
  httpTimeoutMs: number;
}

const isTest = (env: Record<string, string | undefined>) =>
  env.NODE_ENV === 'test';

/**
 * Loads `.env` from the working directory into `process.env` if the file exists,
 * without overriding already-defined environment variables.
 */
export function loadIntegrationEnvFileIfPresent(
  envFilePath: string = resolve(process.cwd(), '.env'),
): void {
  if (!existsSync(envFilePath)) return;
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envFilePath);
  }
}

/** The background sync job worker; off under NODE_ENV=test, where tests run jobs themselves. */
export function isSyncJobWorkerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.INTEGRATION_SYNC_WORKER_ENABLED !== undefined) {
    return env.INTEGRATION_SYNC_WORKER_ENABLED === 'true';
  }
  return !isTest(env);
}

export function readCredentialMasterKey(
  env: Record<string, string | undefined> = process.env,
): string {
  const key = env.INTEGRATION_CREDENTIAL_MASTER_KEY;
  if (!key) {
    throw new Error(
      'INTEGRATION_CREDENTIAL_MASTER_KEY is not set: marketplace credentials cannot be encrypted',
    );
  }
  if (key.trim().length < 16) {
    throw new Error(
      'INTEGRATION_CREDENTIAL_MASTER_KEY is too short: must be at least 16 characters',
    );
  }
  return key;
}

export function readLazadaOAuthStateSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = env.LAZADA_OAUTH_STATE_SECRET?.trim();
  if (secret) {
    if (secret.length < 16) {
      throw new Error(
        'LAZADA_OAUTH_STATE_SECRET is too short: must be at least 16 characters',
      );
    }
    return secret;
  }
  if (env.LAZADA_LIVE_ENABLED === 'true') {
    throw new Error(
      'LAZADA_OAUTH_STATE_SECRET is not set: required when LAZADA_LIVE_ENABLED=true',
    );
  }
  if (env.INTEGRATION_CREDENTIAL_MASTER_KEY?.trim()) {
    return readCredentialMasterKey(env);
  }
  if (isTest(env)) {
    return 'test-lazada-oauth-state-secret-only-32b';
  }
  throw new Error(
    'LAZADA_OAUTH_STATE_SECRET is not set: cannot sign or verify Lazada OAuth state tokens',
  );
}

export function readSalesUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url = env.SALES_SERVICE_URL;
  if (!url) {
    throw new Error(
      'SALES_SERVICE_URL is not set: integration cannot create sales orders',
    );
  }
  return url.replace(/\/+$/, '');
}

/** The shared secret sent to sales in `x-internal-token` (rule 6). */
export function readInternalToken(
  env: Record<string, string | undefined> = process.env,
): string {
  const token = env.INTERNAL_S2S_TOKEN;
  if (!token) {
    throw new Error(
      'INTERNAL_S2S_TOKEN is not set: integration cannot call other services',
    );
  }
  return token;
}

/**
 * Reads and validates Lazada Open Platform configuration.
 * When `LAZADA_LIVE_ENABLED=true`, fails closed if `LAZADA_APP_KEY`, `LAZADA_APP_SECRET`,
 * `LAZADA_OAUTH_STATE_SECRET`, or a valid `LAZADA_CALLBACK_URL` is missing.
 */
export function readLazadaConfig(
  env: Record<string, string | undefined> = process.env,
): LazadaProviderConfig {
  const liveEnabled = env.LAZADA_LIVE_ENABLED === 'true';
  const appKey = env.LAZADA_APP_KEY?.trim() || null;
  const appSecret = env.LAZADA_APP_SECRET?.trim() || null;
  const region = (env.LAZADA_REGION?.trim() || 'VN').toUpperCase();
  const oauthStateSecret = env.LAZADA_OAUTH_STATE_SECRET?.trim() || null;
  const callbackUrl = (
    env.LAZADA_CALLBACK_URL?.trim() || DEFAULT_LAZADA_CALLBACK_URL
  ).replace(/\/+$/, '');
  const frontendRedirectUrl =
    env.LAZADA_FRONTEND_REDIRECT_URL?.trim().replace(/\/+$/, '') || null;
  const authApiBaseUrl = (
    env.LAZADA_AUTH_API_BASE_URL?.trim() ||
    env.LAZADA_AUTH_TOKEN_URL?.trim() ||
    'https://auth.lazada.com/rest'
  ).replace(/\/+$/, '');

  if (liveEnabled) {
    if (!appKey) {
      throw new Error(
        'LAZADA_APP_KEY is not set: required when LAZADA_LIVE_ENABLED=true',
      );
    }
    if (!appSecret) {
      throw new Error(
        'LAZADA_APP_SECRET is not set: required when LAZADA_LIVE_ENABLED=true',
      );
    }
    if (!oauthStateSecret) {
      throw new Error(
        'LAZADA_OAUTH_STATE_SECRET is not set: required when LAZADA_LIVE_ENABLED=true',
      );
    }
    if (oauthStateSecret.length < 16) {
      throw new Error(
        'LAZADA_OAUTH_STATE_SECRET is too short: must be at least 16 characters',
      );
    }
    try {
      const parsedCallback = new URL(callbackUrl);
      if (
        parsedCallback.protocol !== 'https:' &&
        parsedCallback.hostname !== 'localhost' &&
        parsedCallback.hostname !== '127.0.0.1'
      ) {
        throw new Error(
          'LAZADA_CALLBACK_URL must use https:// in non-local environments',
        );
      }
    } catch (err) {
      throw new Error(
        `LAZADA_CALLBACK_URL is invalid: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    liveEnabled,
    appKey,
    appSecret,
    region,
    apiBaseUrl: (
      env.LAZADA_API_BASE_URL?.trim() || 'https://api.lazada.vn/rest'
    ).replace(/\/+$/, ''),
    authUrl: (
      env.LAZADA_AUTH_URL?.trim() || 'https://auth.lazada.com/oauth/authorize'
    ).replace(/\/+$/, ''),
    authApiBaseUrl,
    authTokenUrl: authApiBaseUrl,
    callbackUrl,
    oauthStateSecret,
    frontendRedirectUrl,
    httpTimeoutMs: Math.max(
      1000,
      Number(env.LAZADA_HTTP_TIMEOUT_MS || 10_000) || 10_000,
    ),
  };
}

/** Called before the app starts: throws (naming the variable, never a value) when a required one is missing. */
export function assertIntegrationConfig(
  env: Record<string, string | undefined> = process.env,
): void {
  if (isTest(env)) return;
  readCredentialMasterKey(env);
  readSalesUrl(env);
  readInternalToken(env);
  readLazadaConfig(env);
}
