import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InventoryDomainError } from '../domain/inventory-domain';

export function rethrowInventoryHttpError(error: unknown): never {
  if (error instanceof HttpException) {
    throw error;
  }
  if (error instanceof InventoryDomainError) {
    const body = {
      errorCode: error.errorCode,
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
    switch (error.httpStatus) {
      case 403:
        throw new ForbiddenException(body);
      case 404:
        throw new NotFoundException(body);
      case 409:
        throw new ConflictException(body);
      case 422:
        throw new UnprocessableEntityException(body);
      default:
        throw new BadRequestException(body);
    }
  }
  throw error;
}
