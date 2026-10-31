import { ForbiddenException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

/** Header carrying the service-to-service secret (value of INTERNAL_S2S_TOKEN). */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Service-to-service check for `@Public()` internal routes. Fails closed when
 * `INTERNAL_S2S_TOKEN` is unset (only `NODE_ENV=test` may run without it) and
 * compares in constant time. Call it BEFORE trusting any header such as
 * `x-tenant-id`.
 */
export function assertInternalToken(provided: string | undefined): void {
  const expected = process.env.INTERNAL_S2S_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    throw new ForbiddenException('Internal S2S token is not configured');
  }
  if (
    typeof provided !== 'string' ||
    !timingSafeEqual(digest(provided), digest(expected))
  ) {
    throw new ForbiddenException('Invalid internal S2S token');
  }
}
