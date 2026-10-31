import { ErrorCode } from '@/constants/error-code.constant';
import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * 409 / 404 carrying an i18n error code, formatted by GlobalExceptionFilter
 * like a ValidationException (which is always 400).
 */
export class ConflictCodeException extends ConflictException {
  constructor(error: ErrorCode, message?: string) {
    super({ errorCode: error, message });
  }
}

export class NotFoundCodeException extends NotFoundException {
  constructor(error: ErrorCode, message?: string) {
    super({ errorCode: error, message });
  }
}
