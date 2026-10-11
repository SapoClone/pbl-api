export const PBL_PROPAGATION_OPTIONS = Symbol('PBL_PROPAGATION_OPTIONS');

export interface PblPropagationOptions {
  /**
   * Hosts (`host` or `host:port`) the user's Authorization may be forwarded
   * to on absolute URLs.
   */
  allowedHosts?: string[];
  /**
   * Base URL of the callee. Relative URLs resolve against it and absolute
   * URLs must have its origin.
   */
  baseURL?: string;
}
