import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { Observable } from 'rxjs';
import { AuthUser } from './auth.types';

/**
 * Runs every request handler inside TenantContext with the tenant of the
 * verified access token (ADR-0008): `request.user.tenantId`, set only by
 * AuthGuard, or null for public/anonymous routes and tokens without `tid`.
 * Never read from a header, body or query.
 *
 * An interceptor (registered by PblAuthModule as APP_INTERCEPTOR) rather than
 * a middleware: it runs after the guards, so the token is already verified.
 * The handler observable is subscribed inside `run`, so the handler and all
 * its async continuations (awaits, timers, Observables) see the context.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user: AuthUser | undefined =
      context.getType() === 'http'
        ? context.switchToHttp().getRequest()['user']
        : undefined;
    const tenantId = user?.tenantId ?? null;
    return new Observable((subscriber) =>
      TenantContext.run(tenantId, () => next.handle().subscribe(subscriber)),
    );
  }
}
