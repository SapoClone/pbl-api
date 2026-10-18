/**
 * Settings of inventory, read once from the environment (the one place it is
 * read, like the other services' config files).
 */
export const RESERVATION_TTL_MINUTES = Symbol(
  'INVENTORY_RESERVATION_TTL_MINUTES',
);

const DEFAULT_TTL_MINUTES = 15;

/** Minutes a hold lasts for an order that is never completed: a whole number of at least 1 */
export function readReservationTtlMinutes(
  env: Record<string, string | undefined> = process.env,
): number {
  const minutes = Number(env.INVENTORY_RESERVATION_TTL_MINUTES);
  return Number.isInteger(minutes) && minutes >= 1
    ? minutes
    : DEFAULT_TTL_MINUTES;
}
