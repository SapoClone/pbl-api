import * as fs from 'fs';
import * as path from 'path';
import { isHealthPath, isInternalPath, routeKey } from './merge';

export interface KrakendRoute {
  method: string;
  /** gateway path, e.g. `/sales/api/v1/orders/{id}` */
  path: string;
}

const KRAKEND_JSON = path.resolve(__dirname, '../../krakend/krakend.json');

/** Client-facing routes of the gateway: every endpoint but health probes and internal routes. */
export function loadKrakendRoutes(file = KRAKEND_JSON): KrakendRoute[] {
  const config = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    endpoints: { endpoint: string; method: string }[];
  };
  return config.endpoints
    .filter((e) => {
      const rest = e.endpoint.replace(/^\/[a-z]+/, '') || '/';
      return !isHealthPath(rest) && !isInternalPath(rest);
    })
    .map((e) => ({ method: e.method.toLowerCase(), path: e.endpoint }));
}

export function krakendRouteKeys(routes = loadKrakendRoutes()): Set<string> {
  return new Set(routes.map((r) => routeKey(r.method, r.path)));
}
