import { UnprocessableEntityException, ValidationError } from '@nestjs/common';
import { ErrorDetail } from './error-response';

function flatten(errors: ValidationError[], parent?: string): ErrorDetail[] {
  return errors.flatMap((error) => {
    const property = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.entries(error.constraints ?? {}).map(
      ([code, message]) => ({ property, code, message }),
    );
    return [...own, ...flatten(error.children ?? [], property)];
  });
}

/** ValidationPipe exceptionFactory: 422 with `details` per failed constraint */
export function validationExceptionFactory(
  errors: ValidationError[],
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    message: 'Validation failed',
    details: flatten(errors),
  });
}
