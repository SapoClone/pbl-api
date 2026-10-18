/**
 * Settings of sales, read from the environment (the one place it is read, like
 * the other services' config files).
 */
export function readInventoryUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.INVENTORY_URL || 'http://inventory:3000';
}
