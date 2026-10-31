import { HttpException } from '@nestjs/common';
import { FinanceDomainError } from '../domain/finance-domain';

export function rethrowFinanceHttpError(error: unknown): never {
  if (error instanceof FinanceDomainError) {
    throw new HttpException(
      {
        statusCode: error.httpStatus,
        errorCode: error.code,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        timestamp: new Date().toISOString(),
      },
      error.httpStatus,
    );
  }
  throw error;
}
