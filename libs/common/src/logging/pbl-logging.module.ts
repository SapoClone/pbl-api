import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { pinoLoggerOptions } from './pino-logger-options';

/** JSON request logging with the request id; import once per service */
@Module({})
export class PblLoggingModule {
  static forRoot(serviceName: string): DynamicModule {
    return {
      module: PblLoggingModule,
      imports: [LoggerModule.forRoot(pinoLoggerOptions(serviceName))],
    };
  }
}
