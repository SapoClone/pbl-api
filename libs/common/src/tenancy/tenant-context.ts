import { RequestContext } from '../context/request-context';

/**
 * Thrown when tenant-scoped data access runs without a selected tenant. It is
 * a programming error (a code path outside a request, or a route that lets
 * callers without a store reach tenant data), so it stays a plain Error and
 * becomes a 500, never a client error.
 */
export class MissingTenantContextError extends Error {
  constructor() {
    super('No tenant in the current context');
    this.name = 'MissingTenantContextError';
  }
}

/**
 * The selected tenant of the current request: a view over RequestContext.
 * Set only by @pbl/auth's interceptor from the verified token (ADR-0008).
 */
export const TenantContext = {
  /**
   * Runs `fn` with `tenantId`, keeping the other request-context fields.
   * Only the @pbl/auth interceptor and `consumeEvent` may call this; never
   * with a value derived from request input (header, body, query, path).
   */
  run<T>(tenantId: string | null, fn: () => T): T {
    return RequestContext.run({ ...RequestContext.get(), tenantId }, fn);
  },

  /**
   * The tenant id; null inside a context without a tenant (public route,
   * token without `tid`); undefined outside any context.
   */
  current(): string | null | undefined {
    const state = RequestContext.get();
    return state ? state.tenantId : undefined;
  },

  /** The tenant id, or MissingTenantContextError */
  require(): string {
    const tenantId = RequestContext.get()?.tenantId;
    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      throw new MissingTenantContextError();
    }
    return tenantId;
  },
};
