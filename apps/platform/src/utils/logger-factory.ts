import { type AllConfigType } from '@/config/config.type';
import { loggingRedactPaths, LogService } from '@/constants/app.constant';
import { ConfigService } from '@nestjs/config';
import { genReqId } from '@pbl/common';
import { type IncomingMessage, type ServerResponse } from 'http';
import { Params } from 'nestjs-pino';
import { Options } from 'pino-http';

// https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#logseverity
const PinoLevelToGoogleLoggingSeverityLookup = Object.freeze({
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
});

const customSuccessMessage = (
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  responseTime: number,
) => {
  return `[${req.id || '*'}] "${req.method} ${req.url}" ${res.statusCode} - "${req.headers['host']}" "${req.headers['user-agent']}" - ${responseTime} ms`;
};

const customReceivedMessage = (req: IncomingMessage) => {
  return `[${req.id || '*'}] "${req.method} ${req.url}"`;
};

const customErrorMessage = (req, res, err) => {
  return `[${req.id || '*'}] "${req.method} ${req.url}" ${res.statusCode} - "${req.headers['host']}" "${req.headers['user-agent']}" - message: ${err.message}`;
};

function logServiceConfig(logService: string): Options {
  switch (logService) {
    case LogService.GOOGLE_LOGGING:
      return googleLoggingConfig();
    case LogService.AWS_CLOUDWATCH:
      return cloudwatchLoggingConfig();
    case LogService.CONSOLE:
    default:
      return consoleLoggingConfig();
  }
}

function cloudwatchLoggingConfig(): Options {
  // FIXME: Implement AWS CloudWatch logging configuration
  return {
    messageKey: 'message',
  };
}

function googleLoggingConfig(): Options {
  return {
    messageKey: 'message',
    formatters: {
      level(label, number) {
        return {
          severity:
            PinoLevelToGoogleLoggingSeverityLookup[label] ||
            PinoLevelToGoogleLoggingSeverityLookup['info'],
          level: number,
        };
      },
    },
  };
}

function consoleLoggingConfig(): Options {
  return {
    messageKey: 'msg',
    transport: {
      target: 'pino-pretty',
      options: {
        singleLine: true,
        ignore:
          'req.id,req.method,req.url,req.headers,req.remoteAddress,req.remotePort,res.headers',
      },
    },
  };
}

async function loggerFactory(
  configService: ConfigService<AllConfigType>,
): Promise<Params> {
  const logLevel = configService.get('app.logLevel', { infer: true });
  const logService = configService.get('app.logService', { infer: true });
  const isDebug = configService.get('app.debug', { infer: true });

  const pinoHttpOptions: Options = {
    level: logLevel,
    // Always: the id is echoed as X-Request-Id on every response, not just
    // in debug mode.
    genReqId,
    serializers: isDebug
      ? {
          req: (req) => {
            req.body = req.raw.body;
            return req;
          },
        }
      : undefined,
    customSuccessMessage,
    customReceivedMessage,
    customErrorMessage,
    redact: {
      paths: loggingRedactPaths,
      censor: '**GDPR COMPLIANT**',
    }, // Redact sensitive information
    ...logServiceConfig(logService),
  };

  return {
    // See pinoLoggerOptions: the default route is skipped by Nest because
    // main.ts excludes '/' from the global prefix.
    forRoutes: ['*'],
    pinoHttp: pinoHttpOptions,
  };
}

export default loggerFactory;
