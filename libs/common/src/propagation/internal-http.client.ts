import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { RequestContext } from '../context';
import {
  PBL_PROPAGATION_OPTIONS,
  PblPropagationOptions,
} from './propagation-options';

export interface InternalHttpOptions {
  /**
   * Allow the call outside a request context (jobs, consumers). No user
   * credentials are sent then. Service-to-service authentication without a
   * user is out of scope for now (follow-up).
   */
  asService?: boolean;
}

/** Thrown when the client is used outside a request context */
export class MissingRequestContextError extends Error {
  constructor() {
    super(
      'InternalHttpClient called outside a request context; pass { asService: true } for service calls',
    );
    this.name = 'MissingRequestContextError';
  }
}

/** Thrown when a call would forward the user's credentials somewhere not configured */
export class InternalHttpForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InternalHttpForbiddenError';
  }
}

/** Headers a caller may never set: identity is derived by the callee */
const isReserved = (name: string) => {
  const n = name.toLowerCase();
  return (
    n === 'authorization' ||
    n === 'x-request-id' ||
    n === 'x-tenant-id' ||
    n.startsWith('x-user-')
  );
};

/** axios merges these nested blocks under the top-level headers */
const NESTED_BLOCKS = new Set([
  'common',
  'delete',
  'get',
  'head',
  'post',
  'put',
  'patch',
]);

const isPlainObject = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Copies headers, dropping reserved names at the top level and inside the nested axios blocks */
function sanitizeHeaders(input: unknown): Record<string, any> {
  const source: Record<string, any> =
    isPlainObject(input) && typeof (input as any).toJSON === 'function'
      ? (input as any).toJSON()
      : ((input ?? {}) as Record<string, any>);
  const headers: Record<string, any> = {};
  for (const [name, value] of Object.entries(source)) {
    if (NESTED_BLOCKS.has(name.toLowerCase()) && isPlainObject(value)) {
      headers[name] = sanitizeHeaders(value);
    } else if (!isReserved(name)) {
      headers[name] = value;
    }
  }
  return headers;
}

const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

/** Removes the user's credentials from an axios error before it is rethrown (it ends up in logs) */
function redactError(err: any): void {
  if (!err || typeof err !== 'object') return;
  for (const config of [err.config, err.response?.config]) {
    if (!config) continue;
    if (config.auth) delete config.auth;
    const headers = config.headers;
    if (!headers) continue;
    const blocks = [headers, ...Object.values(headers).filter(isPlainObject)];
    for (const block of blocks) {
      for (const key of Object.keys(block)) {
        if (key.toLowerCase() === 'authorization') delete block[key];
      }
    }
  }
  // the ClientRequest holds the raw header block
  if ('request' in err) err.request = undefined;
  if (err.response && 'request' in err.response) {
    err.response.request = undefined;
  }
}

/**
 * HTTP client for service-to-service calls. Forwards the caller's
 * Authorization and X-Request-Id from the request context, so the callee
 * verifies the token and derives the tenant itself (ADR-0008). It never sends
 * X-Tenant-Id or X-User-* headers, and drops them if a caller passes them.
 *
 * The user's Authorization is only forwarded to a configured destination:
 * `PblPropagationModule.forRoot({ baseURL, allowedHosts })`. With neither
 * configured, a call that would forward it throws. `config.auth` is refused,
 * redirects are not followed when the token is forwarded, and the token is
 * stripped from errors before they are rethrown.
 */
@Injectable()
export class InternalHttpClient {
  constructor(
    private readonly http: HttpService,
    @Optional()
    @Inject(PBL_PROPAGATION_OPTIONS)
    private readonly options: PblPropagationOptions = {},
  ) {}

  async request<T = any>(
    config: AxiosRequestConfig,
    options: InternalHttpOptions = {},
  ): Promise<AxiosResponse<T>> {
    const state = RequestContext.get();
    if (!state && !options.asService) throw new MissingRequestContextError();
    if (config.auth) {
      throw new InternalHttpForbiddenError(
        'config.auth is not supported: credentials come from the request context',
      );
    }

    const forwardAuth = !!state?.authorization && !options.asService;
    const headers = sanitizeHeaders(config.headers);
    // context values are written last so nothing above can override them
    if (state?.requestId) headers['X-Request-Id'] = state.requestId;
    if (forwardAuth) headers['Authorization'] = state!.authorization;

    const final: AxiosRequestConfig = { ...config, headers };
    const resolved = this.resolveUrl(config, forwardAuth);
    if (resolved !== undefined) {
      final.url = resolved;
      final.baseURL = undefined;
    }
    if (forwardAuth) final.maxRedirects = 0;

    try {
      return await firstValueFrom(this.http.request<T>(final));
    } catch (err) {
      redactError(err);
      throw err;
    }
  }

  /**
   * Returns the absolute URL to call, or undefined to leave the config as is
   * (only when no credentials are forwarded). Throws when credentials would
   * go to a destination that is not configured.
   */
  private resolveUrl(
    config: AxiosRequestConfig,
    forwardAuth: boolean,
  ): string | undefined {
    const url = config.url ?? '';
    const base = this.options?.baseURL
      ? new URL(this.options.baseURL)
      : undefined;
    const hosts = (this.options?.allowedHosts ?? []).map((h) =>
      h.toLowerCase(),
    );

    if (!ABSOLUTE_URL.test(url)) {
      if (base) {
        const target = new URL(url, base.href.replace(/\/?$/, '/'));
        if (target.origin !== base.origin) {
          throw new InternalHttpForbiddenError(
            'Relative URL escapes the configured baseURL',
          );
        }
        return target.href;
      }
      if (!forwardAuth) return undefined;
      throw new InternalHttpForbiddenError(
        'A relative URL needs PblPropagationModule.forRoot({ baseURL })',
      );
    }

    if (!forwardAuth) return undefined;
    let target: URL;
    try {
      target = new URL(url, 'http://invalid.invalid');
    } catch {
      throw new InternalHttpForbiddenError('Invalid URL');
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new InternalHttpForbiddenError('Only http(s) URLs are allowed');
    }
    const matchesBase = !!base && target.origin === base.origin;
    const matchesHost =
      hosts.includes(target.host.toLowerCase()) ||
      hosts.includes(target.hostname.toLowerCase());
    if (!matchesBase && !matchesHost) {
      throw new InternalHttpForbiddenError(
        `Refusing to forward Authorization to ${target.host}: not the configured baseURL or in allowedHosts`,
      );
    }
    return target.href;
  }

  get<T = any>(
    url: string,
    config?: AxiosRequestConfig,
    options?: InternalHttpOptions,
  ) {
    return this.request<T>({ ...config, url, method: 'GET' }, options);
  }

  delete<T = any>(
    url: string,
    config?: AxiosRequestConfig,
    options?: InternalHttpOptions,
  ) {
    return this.request<T>({ ...config, url, method: 'DELETE' }, options);
  }

  post<T = any>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
    options?: InternalHttpOptions,
  ) {
    return this.request<T>({ ...config, url, data, method: 'POST' }, options);
  }

  put<T = any>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
    options?: InternalHttpOptions,
  ) {
    return this.request<T>({ ...config, url, data, method: 'PUT' }, options);
  }

  patch<T = any>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
    options?: InternalHttpOptions,
  ) {
    return this.request<T>({ ...config, url, data, method: 'PATCH' }, options);
  }
}
