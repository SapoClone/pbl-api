import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'http';
import { RequestContext } from '../context';
import { ErrorResponse } from './error-response';

@Catch()
export class PblExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PblExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const response = http.getResponse();
    const body = this.toBody(exception);
    const headerTraceId = request?.headers?.['x-trace-id'];
    const traceId =
      RequestContext.get()?.requestId ||
      (typeof headerTraceId === 'string' && headerTraceId.trim().length > 0
        ? headerTraceId.trim()
        : undefined);
    if (traceId) {
      body.traceId = traceId;
    }
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
      // only a list (validation errors) is copied, never an arbitrary object
      if (Array.isArray(obj.details)) body.details = obj.details;
      if (statusCode >= 500) {
        this.logger.error(
          `${statusCode} ${String(body.message)}`,
          exception.stack,
        );
      }
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
