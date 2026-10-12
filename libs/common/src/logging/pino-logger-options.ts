import { Params } from 'nestjs-pino';
import { genReqId } from './gen-req-id';

/** JSON log lines with `req.id`, `service`, and credentials redacted */
export function pinoLoggerOptions(serviceName: string): Params {
  return {
    // Plain '*', not nestjs-pino's default { path: '*', method: ALL }: when
    // setGlobalPrefix excludes '/', Nest drops the default and the logger
    // middleware (and so X-Request-Id) never runs.
    forRoutes: ['*'],
    pinoHttp: {
      level: process.env.LOG_LEVEL || 'info',
      genReqId,
      base: { service: serviceName },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '**REDACTED**',
      },
    },
  };
}
