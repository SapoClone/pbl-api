import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Who is calling: stored with a login so the session list can show it. */
export type ClientInfo = { userAgent: string | null; ip: string | null };

/**
 * The caller's address. Behind the gateway the socket peer is KrakenD, which
 * puts the real client first in `X-Forwarded-For`; reaching a service directly
 * (local only) falls back to the socket address. The value is only shown in the
 * session list: it decides nothing, so a spoofed header costs nothing.
 */
export function clientIp(
  headers: Request['headers'] | undefined,
  remoteAddress: string | undefined,
): string | null {
  const forwarded = headers?.['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(',')[0]
    ?.trim();
  return (first || remoteAddress || null)?.slice(0, 45) ?? null;
}

export const Client = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ClientInfo => {
    const request = context.switchToHttp().getRequest<Request>();
    const userAgent = request.headers?.['user-agent'];
    return {
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 255) : null,
      ip: clientIp(request.headers, request.ip),
    };
  },
);

/** "Chrome · Windows" from a user agent; null when it says nothing useful. */
export function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\/|Opera/.test(userAgent)
      ? 'Opera'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : null;
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad|iOS/.test(userAgent)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  const label = [browser, os].filter(Boolean).join(' · ');
  return label || userAgent.slice(0, 60);
}
