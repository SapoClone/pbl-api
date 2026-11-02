import { isTestEnvironment } from '../config/sales.config';

/**
 * Drops the request fields that force a failure path for tests (`simulate…`, e.g. `simulateFailureAfterReserve`)
 * unless NODE_ENV=test, so a client cannot push a checkout into a failure or recovery state.
 */
export function withoutTestSwitches<T extends object>(
  dto: T,
  env: Record<string, string | undefined> = process.env,
): T {
  if (isTestEnvironment(env)) return dto;
  for (const key of Object.keys(dto)) {
    if (key.startsWith('simulate')) {
      delete (dto as Record<string, unknown>)[key];
    }
  }
  return dto;
}
