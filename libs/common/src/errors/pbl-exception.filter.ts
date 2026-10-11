import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'http';
import { ErrorResponse } from './error-response';

@Catch()
export class PblExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PblExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const body = this.toBody(exception);
    if (process.env.APP_DEBUG === 'true' && exception instanceof Error) {
      body.stack = exception.stack;
    }
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorResponse {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const res = exception.getResponse();
      const obj = typeof res === 'object' && res !== null ? (res as any) : {};
      const rawMessage = typeof res === 'string' ? res : obj.message;
      const message = Array.isArray(rawMessage)
        ? rawMessage.join('; ')
        : (rawMessage ?? exception.message);
      const body: ErrorResponse = {
        timestamp: new Date().toISOString(),
        statusCode,
        error: STATUS_CODES[statusCode] ?? 'Error',
        message,
      };
      if (obj.errorCode) body.errorCode = obj.errorCode;
      if (obj.details) body.details = obj.details;
      return body;
    }
    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined,
    );
    return {
      timestamp: new Date().toISOString(),
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: STATUS_CODES[500],
      message: 'Internal Server Error',
    };
  }
}
