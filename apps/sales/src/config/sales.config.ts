/**
 * Settings of sales, read from the environment (the one place it is read, like
 * the other services' config files).
 */
export function readInventoryUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.INVENTORY_URL || 'http://inventory:3000';
}

/**
 * The shared service-to-service secret (`INTERNAL_S2S_TOKEN`), sent as the
 * `x-internal-token` header on calls to inventory's internal routes. Empty
 * when unset.
 */
export function readInternalToken(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.INTERNAL_S2S_TOKEN ?? '';
}

/** `NODE_ENV=test` is the only place the token may be absent. */
export function isTestEnvironment(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NODE_ENV === 'test';
}
