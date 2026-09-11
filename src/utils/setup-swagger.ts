import { type AllConfigType } from '@/config/config.type';
import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

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
    .setDescription('A boilerplate project')
    .setVersion('1.0')
    .setContact('Company Name', 'https://example.com', 'contact@company.com')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'Api-Key', in: 'header' }, 'Api-Key')
    .addServer(
      configService.getOrThrow('app.url', { infer: true }),
      'Development',
    )
    .addServer('https://example.com', 'Staging')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    customSiteTitle: appName,
  });
}

export default setupSwagger;
