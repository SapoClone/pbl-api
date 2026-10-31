import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/**
 * Service-to-service check (phase-2 rule 6): the caller must send the shared
 * secret `INTERNAL_S2S_TOKEN` in `x-internal-token`. Fails closed when the
 * variable is unset, except under NODE_ENV=test. Compared in constant time.
 * Anything taken from a header (tenant) counts only after this passes.
 */
export function isValidInternalToken(
  provided: string | string[] | undefined,
  expected: string | undefined = process.env.INTERNAL_S2S_TOKEN,
  env: string | undefined = process.env.NODE_ENV,
): boolean {
  if (!expected) return env === 'test';
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!isValidInternalToken(req.headers?.[INTERNAL_TOKEN_HEADER])) {
      throw new ForbiddenException('Invalid internal S2S token');
    }
    return true;
  }
}
