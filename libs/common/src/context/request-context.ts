import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request state, carried across async continuations by one
 * AsyncLocalStorage. Entered by @pbl/auth's interceptor after the guard has
 * verified the access token; never filled from a header, body or query.
 * Tenant is the only field for now; request id, authorization and actor
 * join it later (one store, not one per concern).
 */
export interface RequestContextState {
  /** Selected store from the verified token's `tid`; null without one */
  tenantId: string | null;
}

const storage = new AsyncLocalStorage<RequestContextState>();

export const RequestContext = {
  /** Runs `fn` (and everything it awaits or schedules) with `state` */
  run<T>(state: RequestContextState, fn: () => T): T {
    return storage.run(state, fn);
  },

  /** The current state, or undefined outside any request context */
  get(): RequestContextState | undefined {
    return storage.getStore();
  },
};
