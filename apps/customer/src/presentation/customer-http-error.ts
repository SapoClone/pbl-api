import { HttpException } from '@nestjs/common';
import { CustomerDomainError } from '../domain/customer-domain';

export function rethrowCustomerHttpError(error: unknown): never {
  if (error instanceof CustomerDomainError) {
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
