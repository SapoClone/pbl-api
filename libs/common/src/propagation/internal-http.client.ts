import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { RequestContext } from '../context';

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

/**
 * HTTP client for service-to-service calls. Forwards the caller's
 * Authorization and X-Request-Id from the request context, so the callee
 * verifies the token and derives the tenant itself (ADR-0008). It never sends
 * X-Tenant-Id or X-User-* headers, and drops them if a caller passes them.
 */
@Injectable()
export class InternalHttpClient {
  constructor(private readonly http: HttpService) {}

  async request<T = any>(
    config: AxiosRequestConfig,
    options: InternalHttpOptions = {},
  ): Promise<AxiosResponse<T>> {
    const state = RequestContext.get();
    if (!state && !options.asService) throw new MissingRequestContextError();

    const headers: Record<string, any> = {};
    for (const [name, value] of Object.entries(
      (config.headers ?? {}) as Record<string, any>,
    )) {
      if (!isReserved(name)) headers[name] = value;
    }
    if (state?.requestId) headers['X-Request-Id'] = state.requestId;
    if (state?.authorization && !options.asService) {
      headers['Authorization'] = state.authorization;
    }
    return firstValueFrom(this.http.request<T>({ ...config, headers }));
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
