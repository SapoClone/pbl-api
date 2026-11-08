import {
  RequestMethod,
  VersioningType,
  type INestApplication,
} from '@nestjs/common';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

import { IS_AUTH_OPTIONAL, IS_PUBLIC } from '@pbl/auth';
import { PLATFORM_SWAGGER_TAGS } from '../../apps/platform/src/utils/setup-swagger';

export const SERVICES = [
  'platform',
  'catalog',
  'inventory',
  'sales',
  'finance',
  'integration',
  'insight',
  'customer',
] as const;
export type ServiceName = (typeof SERVICES)[number];

/**
 * Dummy configuration so the apps' config validation passes. Nothing
 * connects anywhere: the apps are created with `preview: true`, which builds
 * the route table without instantiating a single provider (no database, no
 * queue, no Redis).
 */
const DUMMY_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  APP_PORT: '3000',
  APP_NAME: 'openapi',
  APP_URL: 'http://localhost:3000',
  FRONTEND_DOMAIN: 'http://localhost:3001',
  BACKEND_DOMAIN: 'http://localhost:3000',
  DATABASE_URL: 'postgres://u:p@127.0.0.1:1/openapi',
  DATABASE_HOST: '127.0.0.1',
  DATABASE_PORT: '1',
  DATABASE_USERNAME: 'u',
  DATABASE_PASSWORD: 'p',
  DATABASE_NAME: 'openapi',
  AUTH_JWKS_URL: 'http://127.0.0.1:1/.well-known/jwks.json',
  AUTH_JWT_PRIVATE_KEY: 'x',
  AUTH_JWT_PUBLIC_KEY: 'x',
  AUTH_JWT_SECRET: 'x',
  AUTH_REFRESH_SECRET: 'x',
  AUTH_FORGOT_SECRET: 'x',
  AUTH_CONFIRM_EMAIL_SECRET: 'x',
  REDIS_URL: 'redis://127.0.0.1:1',
};

function applyDummyEnv(): void {
  for (const [key, value] of Object.entries(DUMMY_ENV)) {
    process.env[key] ??= value;
  }
  process.env.APP_SWAGGER_ENABLED = 'false';
}

async function loadAppModule(service: ServiceName): Promise<unknown> {
  const mod = (await import(`../../apps/${service}/src/app.module`)) as {
    AppModule: unknown;
  };
  return mod.AppModule;
}

/** Mirrors apps/platform/src/main.ts: global `api` prefix + URI versioning. */
function configurePlatformRouting(app: INestApplication): void {
  app.setGlobalPrefix(process.env.API_PREFIX || 'api', {
    exclude: [
      { method: RequestMethod.GET, path: '/' },
      { method: RequestMethod.GET, path: 'health' },
      { method: RequestMethod.GET, path: 'health/live' },
      { method: RequestMethod.GET, path: 'health/ready' },
      { method: RequestMethod.GET, path: '.well-known/jwks.json' },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI });
}

/** What the global auth guard does with a route, read from the same metadata the guard reads. */
export type RouteAccess = 'public' | 'optional' | 'protected';

export interface ServiceDocument {
  document: OpenAPIObject;
  /** `<Controller>_<method>` -> access, to compare with each operation's `security` */
  access: Record<string, RouteAccess>;
}

/** Reads @Public() / @AuthOptional() per handler (handler overrides controller, as in AuthGuard). */
function collectAccess(app: INestApplication): Record<string, RouteAccess> {
  const access: Record<string, RouteAccess> = {};
  const flag = (key: string, handler: object, controller: object) =>
    (Reflect.getMetadata(key, handler) ??
      Reflect.getMetadata(key, controller)) as boolean | undefined;
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as
        | (new (...args: never[]) => object)
        | null;
      if (!controller) continue;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata('path', handler) === undefined) continue;
        access[`${controller.name}_${name}`] = flag(
          IS_PUBLIC,
          handler,
          controller,
        )
          ? 'public'
          : flag(IS_AUTH_OPTIONAL, handler, controller)
            ? 'optional'
            : 'protected';
      }
    }
  }
  return access;
}

/** Builds one service's OpenAPI document from its controllers. */
export async function createServiceDocument(
  service: ServiceName,
): Promise<ServiceDocument> {
  applyDummyEnv();
  const appModule = await loadAppModule(service);
  const app = await NestFactory.create(appModule as never, {
    preview: true,
    abortOnError: false,
    logger: false,
  });
  if (service === 'platform') configurePlatformRouting(app);
  const config = new DocumentBuilder()
    .setTitle(`SapoClone - ${service} service`)
    .setDescription(`OpenAPI specification of the ${service} microservice`)
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  // the same tag list platform's own /api-docs uses (admin groups first)
  if (service === 'platform') config.tags = PLATFORM_SWAGGER_TAGS;
  const document = SwaggerModule.createDocument(app, config);
  const access = collectAccess(app);
  await app.close();
  return { document, access };
}
