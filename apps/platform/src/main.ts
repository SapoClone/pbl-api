import {
  ClassSerializerInterceptor,
  HttpStatus,
  RequestMethod,
  UnprocessableEntityException,
  ValidationError,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import compression from 'compression';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AuthService } from './api/auth/auth.service';
import { AppModule, ObserveInstrument } from './app.module';
import { type AllConfigType } from './config/config.type';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { AuthGuard } from './guards/auth.guard';
import setupSwagger from './utils/setup-swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    instrument: ObserveInstrument,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  // Defense-in-depth: a well-behaved app shouldn't produce unhandled
  // rejections, but third-party client libraries can still introduce
  // floating promises outside our control (this was hit for real with an
  // earlier @google-cloud/tasks integration, now replaced by QStash — kept
  // as a general safeguard). Log through the app's
  // structured (pino) logger and keep serving, instead of letting Node's
  // default behavior (crashing the whole process) take down every in-flight
  // request over one library-internal rejection, and instead of a raw
  // console.error line that bypasses the normal log stream/aggregation.
  // Registered here (after app.useLogger) rather than at module scope so it
  // shares the same structured logger as the rest of the app; this means it
  // won't catch a rejection during the NestFactory.create(...) call above,
  // which is an acceptable trade-off for keeping all crash logs consistent.
  process.on('unhandledRejection', (reason) => {
    logger.error(reason, 'unhandledRejection');
  });

  // OBSERVE_APP_KEY/OBSERVE_APP_SECRET are read straight off process.env in
  // app.module.ts's createObserveModule() call, bypassing the class-validator
  // validateConfig pattern used elsewhere — so a missing/empty value fails
  // silently (monitoring just stops working) instead of crashing the app.
  // Warn loudly at boot so this doesn't go unnoticed.
  if (!process.env.OBSERVE_APP_KEY || !process.env.OBSERVE_APP_SECRET) {
    logger.warn(
      'OBSERVE_APP_KEY and/or OBSERVE_APP_SECRET is unset — Observe monitoring is disabled/broken.',
      'ObserveConfig',
    );
  }

  const configService = app.get(ConfigService<AllConfigType>);
  const reflector = app.get(Reflector);

  // Setup security headers. "upgrade-insecure-requests" (one of helmet's
  // default CSP directives) tells the browser to transparently retry every
  // subresource request over HTTPS — harmless when the app is actually
  // served over HTTPS, but fatal when it isn't yet (e.g. the ALB here has
  // no HTTPS listener configured): every asset request silently gets
  // upgraded to a port the load balancer isn't listening on and just hangs,
  // which is exactly what broke Swagger's UI loading blank/forever. Drop
  // the directive whenever app.url isn't itself https.
  const appUrl = configService.getOrThrow('app.url', { infer: true });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          ...(appUrl.startsWith('https://')
            ? {}
            : { 'upgrade-insecure-requests': null }),
        },
      },
    }),
  );

  // For high-traffic websites in production, it is strongly recommended to offload compression from the application server - typically in a reverse proxy (e.g., Nginx). In that case, you should not use compression middleware.
  app.use(compression());
  const isDevelopment =
    configService.getOrThrow('app.nodeEnv', { infer: true }) === 'development';
  const corsOrigin = configService.getOrThrow('app.corsOrigin', {
    infer: true,
  });

  app.enableCors({
    origin: corsOrigin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Accept',
    credentials: true,
  });
  console.info('CORS Origin:', corsOrigin);

  // Use global prefix if you don't have subdomain
  app.setGlobalPrefix(
    configService.getOrThrow('app.apiPrefix', { infer: true }),
    {
      exclude: [
        { method: RequestMethod.GET, path: '/' },
        { method: RequestMethod.GET, path: 'health' },
      ],
    },
  );

  app.enableVersioning({
    type: VersioningType.URI,
  });

  app.useGlobalGuards(new AuthGuard(reflector, app.get(AuthService)));
  app.useGlobalFilters(new GlobalExceptionFilter(configService));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      exceptionFactory: (errors: ValidationError[]) => {
        return new UnprocessableEntityException(errors);
      },
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(reflector));

  const swaggerEnabled = configService.getOrThrow('app.swaggerEnabled', {
    infer: true,
  });
  if (isDevelopment || swaggerEnabled) {
    setupSwagger(app);
  }

  await app.listen(configService.getOrThrow('app.port', { infer: true }));

  console.info(`Server running on ${await app.getUrl()}`);

  return app;
}

void bootstrap();
