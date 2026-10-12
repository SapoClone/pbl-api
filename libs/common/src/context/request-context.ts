import { AsyncLocalStorage } from 'async_hooks';

/** Verified token subject (or the producer of an event) */
export interface RequestActor {
  id: string;
  type: string;
}

/**
 * Per-request state, carried across async continuations by one
 * AsyncLocalStorage. Entered by @pbl/auth's interceptor after the guard has
 * verified the access token; never filled from a header, body or query
 * (requestId and authorization are only captured for forwarding).
 * One store for every per-request concern, not one per concern.
 */
export interface RequestContextState {
  /** Selected store from the verified token's `tid`; null without one */
  tenantId: string | null;
  /** X-Request-Id of the request (client-supplied or generated) */
  requestId?: string;
  /** Raw Authorization header, forwarded on internal HTTP calls */
  authorization?: string;
  /** Verified token subject; null for anonymous requests */
  actor?: RequestActor | null;
}

const storage = new AsyncLocalStorage<RequestContextState>();

export const RequestContext = {
  /**
   * Runs `fn` (and everything it awaits or schedules) with `state`.
   * Only the @pbl/auth interceptor and `consumeEvent` may call this; never
   * with a value derived from request input (header, body, query, path).
   */
  run<T>(state: RequestContextState, fn: () => T): T {
    return storage.run(state, fn);
  },

  /** The current state, or undefined outside any request context */
  get(): RequestContextState | undefined {
    return storage.getStore();
  },
};
