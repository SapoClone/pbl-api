/**
 * Drops the request fields that force a failure path for tests (`simulate…`, e.g. `simulateProviderTimeout`)
 * unless NODE_ENV=test, so a client cannot steer a refund into a failure state.
 */
export function withoutTestSwitches<T extends object>(
  dto: T,
  env: Record<string, string | undefined> = process.env,
): T {
  if (env.NODE_ENV === 'test') return dto;
  for (const key of Object.keys(dto)) {
    if (key.startsWith('simulate')) {
      delete (dto as Record<string, unknown>)[key];
    }
  }
  return dto;
}
