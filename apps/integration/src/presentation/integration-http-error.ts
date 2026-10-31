import { HttpException } from '@nestjs/common';
import { IntegrationDomainError } from '../domain/integration-domain';

export function rethrowIntegrationHttpError(error: unknown): never {
  if (error instanceof IntegrationDomainError) {
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
