/**
 * Settings of integration read from the environment (the one place it is
 * read). Required values fail closed: the service does not start without them,
 * except under NODE_ENV=test, where the tests set their own.
 */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

const isTest = (env: Record<string, string | undefined>) =>
  env.NODE_ENV === 'test';

export function readCredentialMasterKey(
  env: Record<string, string | undefined> = process.env,
): string {
  const key = env.INTEGRATION_CREDENTIAL_MASTER_KEY;
  if (!key) {
    throw new Error(
      'INTEGRATION_CREDENTIAL_MASTER_KEY is not set: marketplace credentials cannot be encrypted',
    );
  }
  return key;
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

/** Called before the app starts: throws (naming the variable, never a value) when a required one is missing. */
export function assertIntegrationConfig(
  env: Record<string, string | undefined> = process.env,
): void {
  if (isTest(env)) return;
  readCredentialMasterKey(env);
  readSalesUrl(env);
  readInternalToken(env);
}
