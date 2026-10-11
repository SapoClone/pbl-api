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
  // abortOnError: false makes a failure reject instead of process.exit(1)
  // inside Nest's exception zone. That is what lets the probe below be a
  // plain try/catch; a start-up failure still ends the process, as an
  // unhandled rejection.
  const app = await NestFactory.create(appModule, {
    bufferLogs: true,
    abortOnError: false,
  });

  // The module tree normally imports PblLoggingModule. Without it, keep
  // Nest's default logger and release the logs buffered during start-up.
  try {
    app.useLogger(app.get(Logger, { strict: false }));
  } catch {
    app.flushLogs();
  }

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
