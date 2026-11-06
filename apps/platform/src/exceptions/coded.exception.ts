import { ErrorCode } from '@/constants/error-code.constant';
import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * 409 / 404 carrying an i18n error code, formatted by GlobalExceptionFilter
 * like a ValidationException (which is always 400).
 */
export class ConflictCodeException extends ConflictException {
  /** `details` is passed to the client as is (the plan-limit error says which key, how much and which plan) */
  constructor(
    error: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super({ errorCode: error, message, details });
  }
}

export class NotFoundCodeException extends NotFoundException {
  constructor(error: ErrorCode, message?: string) {
    super({ errorCode: error, message });
  }
}
