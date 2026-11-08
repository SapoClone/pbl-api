import type { OpenAPIObject } from '@nestjs/swagger';
import {
  SERVICES,
  createServiceDocument,
  type RouteAccess,
  type ServiceName,
} from './create-documents';
import { krakendRouteKeys } from './krakend';
import { mergeDocuments, type UnexposedRoute } from './merge';

export interface BuiltDocuments {
  services: Record<ServiceName, OpenAPIObject>;
  /** per service: `<Controller>_<method>` -> how the auth guard treats it */
  access: Record<ServiceName, Record<string, RouteAccess>>;
  merged: OpenAPIObject;
  unexposed: UnexposedRoute[];
}

/** Generates every service document and the merged gateway document, in memory. */
export async function buildDocuments(): Promise<BuiltDocuments> {
  const services = {} as Record<ServiceName, OpenAPIObject>;
  const access = {} as BuiltDocuments['access'];
  for (const service of SERVICES) {
    const built = await createServiceDocument(service);
    services[service] = built.document;
    access[service] = built.access;
  }
  const { document, unexposed } = mergeDocuments({
    documents: services,
    exposed: krakendRouteKeys(),
  });
  return { services, access, merged: document, unexposed };
}
