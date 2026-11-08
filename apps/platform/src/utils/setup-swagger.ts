import { type AllConfigType } from '@/config/config.type';
import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const ADMIN_TOKEN_NOTE =
  'Needs an admin token (`sub_type = platform_admin`, from `POST /api/v1/admin/auth/login`); a store token is refused.';

/**
 * Tag order in Swagger UI follows this list. The platform-admin groups come
 * first; tags a controller uses but this list lacks would sink to the bottom.
 */
export const PLATFORM_SWAGGER_TAGS: { name: string; description: string }[] = [
  {
    name: 'admin-auth',
    description: `Platform-admin sign-in, refresh and sign-out. Login is public; the rest ${ADMIN_TOKEN_NOTE.toLowerCase()}`,
  },
  {
    name: 'admin-tenants',
    description: `Stores: list, create, edit, suspend and reactivate. ${ADMIN_TOKEN_NOTE}`,
  },
  {
    name: 'admin-accounts',
    description: `Store users' accounts and their sessions. ${ADMIN_TOKEN_NOTE}`,
  },
  {
    name: 'admin-admins',
    description: `Platform administrators (super admin only). ${ADMIN_TOKEN_NOTE}`,
  },
  {
    name: 'admin-plans',
    description: `Subscription plans and their limits. ${ADMIN_TOKEN_NOTE}`,
  },
  {
    name: 'admin-subscriptions',
    description: `Store subscriptions, payments and plan changes. ${ADMIN_TOKEN_NOTE}`,
  },
  {
    name: 'admin-usage',
    description: `Usage of each store against its plan limits. ${ADMIN_TOKEN_NOTE}`,
  },
  {
    name: 'admin-settings',
    description: `Platform-wide settings. ${ADMIN_TOKEN_NOTE}`,
  },
  {
    name: 'auth',
    description:
      'Store sign-in, registration, token refresh and switching the selected store',
  },
  {
    name: 'accounts',
    description: "The signed-in user's own account, password and sessions",
  },
  {
    name: 'tenants',
    description: 'Stores: the current store, its members and invitations',
  },
  { name: 'branches', description: 'Branches of the current store' },
  { name: 'permissions', description: 'Permission codes that roles grant' },
  { name: 'roles', description: 'Roles of the current store' },
  {
    name: 'staff-schedules',
    description: 'Work shifts and who is on duty',
  },
  {
    name: 'health',
    description:
      'Liveness and readiness probes (/health, /health/live, /health/ready)',
  },
];

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, and comparing lengths first is safe — length alone isn't
  // useful information for an attacker guessing a password.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function basicAuthMiddleware(username: string, password: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Basic ')) {
      const [user, pass] = Buffer.from(header.slice(6), 'base64')
        .toString('utf-8')
        .split(':');
      if (safeEqual(user ?? '', username) && safeEqual(pass ?? '', password)) {
        next();
        return;
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="API Docs"');
    res.status(401).send('Authentication required');
  };
}

function setupSwagger(app: INestApplication) {
  const configService = app.get(ConfigService<AllConfigType>);
  const appName = configService.getOrThrow('app.name', { infer: true });
  const swaggerUser = configService.get('app.swaggerUser', { infer: true });
  const swaggerPassword = configService.get('app.swaggerPassword', {
    infer: true,
  });

  // Only gated when both are set — local dev typically leaves them unset
  // and gets Swagger with no prompt, same as before this was added.
  if (swaggerUser && swaggerPassword) {
    app.use(
      ['/api-docs', '/api-docs-json'],
      basicAuthMiddleware(swaggerUser, swaggerPassword),
    );
  }

  const config = new DocumentBuilder()
    .setTitle(appName)
    .setDescription(
      'SapoClone platform service: IAM, accounts, stores, branches, roles and the platform-admin API. The other services document themselves at their own /api-docs, and every client-facing route is in the merged gateway document (docs/guides/openapi.md).',
    )
    .setVersion('1.0')
    .setContact(
      'SapoClone Engineering',
      'https://example.com',
      'contact@company.com',
    )
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'Api-Key', in: 'header' }, 'Api-Key')
    .addServer(
      configService.getOrThrow('app.url', { infer: true }),
      'Development (Platform Direct)',
    )
    .addServer(
      'http://localhost:8080',
      'KrakenD API Gateway (All Microservices)',
    )
    .addServer('https://example.com', 'Staging')
    .build();
  config.tags = PLATFORM_SWAGGER_TAGS;
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    customSiteTitle: appName,
  });
}

export default setupSwagger;
