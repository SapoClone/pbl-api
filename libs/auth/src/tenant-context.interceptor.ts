import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { RequestContext, RequestContextState } from '@pbl/common';
import { Observable } from 'rxjs';
import { AuthUser } from './auth.types';

/**
 * Runs every request handler inside the request context with the tenant of
 * the verified access token (ADR-0008): `request.user.tenantId`, set only by
 * AuthGuard, or null for public/anonymous routes and tokens without `tid`.
 * Never read from a header, body or query. Also captures the request id, the
 * raw Authorization header and the actor for propagation (internal HTTP
 * client, event envelopes).
 *
 * An interceptor (registered by PblAuthModule as APP_INTERCEPTOR) rather than
 * a middleware: it runs after the guards, so the token is already verified.
 * The handler observable is subscribed inside `run`, so the handler and all
 * its async continuations (awaits, timers, Observables) see the context.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    let user: AuthUser | undefined;
    let requestId: string | undefined;
    let authorization: string | undefined;
    if (context.getType() === 'http') {
      const http = context.switchToHttp();
      const req = http.getRequest();
      user = req['user'];
      // req.id is set by nestjs-pino's genReqId, which also echoes the
      // X-Request-Id response header.
      const id = req.id ?? http.getResponse()?.getHeader?.('x-request-id');
      requestId = id === undefined || id === null ? undefined : String(id);
      authorization = req.headers?.['authorization'];
    }
    const state: RequestContextState = {
      tenantId: user?.tenantId ?? null,
      requestId,
      authorization,
      actor: user ? { id: user.id, type: user.subjectType } : null,
    };
    return new Observable((subscriber) =>
      RequestContext.run(state, () => next.handle().subscribe(subscriber)),
    );
  }
}
