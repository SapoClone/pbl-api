import {
  DynamicModule,
  INestApplication,
  Type,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { PblExceptionFilter } from '../errors/pbl-exception.filter';
import { validationExceptionFactory } from '../errors/validation-exception.factory';

export interface BootstrapOptions {
  name: string;
  /** Defaults to PORT, then 3000. Use 0 for a random port (tests). */
  port?: number;
}

/**
 * Standard service start-up: pino logger, shutdown hooks, validation (422
 * with details), the shared error filter, no CORS (the gateway owns it) and
 * Swagger at /api-docs unless APP_SWAGGER_ENABLED=false.
 */
export async function bootstrapService(
  appModule: Type<unknown> | DynamicModule,
  options: BootstrapOptions,
): Promise<INestApplication> {
  const app = await NestFactory.create(appModule, { bufferLogs: true });

  // The module tree imports PblLoggingModule; tolerate its absence.
  const logger = app.get(Logger, { strict: false });
  if (logger) app.useLogger(logger);

  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalFilters(new PblExceptionFilter());

  if (process.env.APP_SWAGGER_ENABLED !== 'false') {
    const config = new DocumentBuilder()
      .setTitle(options.name)
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'api-docs',
      app,
      SwaggerModule.createDocument(app, config),
    );
  }

  await app.listen(options.port ?? process.env.PORT ?? 3000);
  return app;
}
