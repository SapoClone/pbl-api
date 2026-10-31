import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/** Header that carries the service-to-service token on internal routes */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/** Environment variable holding the shared token */
export const INTERNAL_TOKEN_ENV = 'INTERNAL_S2S_TOKEN';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Service-to-service check for the `internal/**` routes (phase-2 rule 6; same guard as inventory and customer).
 * The request must carry `x-internal-token` equal to `INTERNAL_S2S_TOKEN`,
 * compared in constant time. With no token configured the guard fails closed,
 * except under `NODE_ENV=test`. It runs before a handler reads `X-Tenant-Id`,
 * so a tenant from a header counts only for a caller that holds the token.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly logger = new Logger(InternalTokenGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env[INTERNAL_TOKEN_ENV];
    if (!expected) {
      if (process.env.NODE_ENV === 'test') return true;
      this.logger.error(
        `${INTERNAL_TOKEN_ENV} is not set: internal routes are closed`,
      );
      throw new UnauthorizedException('Internal token required');
    }
    const request = context.switchToHttp().getRequest<Request>();
    const raw = request.headers[INTERNAL_TOKEN_HEADER];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (
      typeof provided !== 'string' ||
      !timingSafeEqual(digest(provided), digest(expected))
    ) {
      throw new UnauthorizedException('Internal token required');
    }
    return true;
  }
}
