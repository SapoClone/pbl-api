import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { SalesDomainError } from '../domain/sales-domain';

export function rethrowSalesHttpError(error: unknown): never {
  if (error instanceof HttpException) {
    throw error;
  }
  if (error instanceof SalesDomainError) {
    throw new HttpException(
      {
        errorCode: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      error.httpStatus,
    );
  }
  throw error;
}

@Catch(SalesDomainError)
export class SalesExceptionFilter implements ExceptionFilter {
  catch(exception: SalesDomainError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    res.status(exception.httpStatus).json({
      errorCode: exception.code,
      message: exception.message,
      ...(exception.details !== undefined
        ? { details: exception.details }
        : {}),
    });
  }
}
