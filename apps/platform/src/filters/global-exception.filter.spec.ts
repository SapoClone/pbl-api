import { ErrorCode } from '@/constants/error-code.constant';
import {
  ConflictCodeException,
  NotFoundCodeException,
} from '@/exceptions/coded.exception';
import { ValidationException } from '@/exceptions/validation.exception';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter (errors with a code)', () => {
  const run = (exception: unknown) => {
    const filter = new GlobalExceptionFilter({
      getOrThrow: () => false,
    } as never);
    const json = jest.fn<void, [unknown]>();
    const status = jest.fn<{ json: typeof json }, [number]>(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          i18nContext: { t: (key: string) => `translated:${key}` },
        }),
      }),
    };
    filter.catch(exception, host as never);
    return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
  };

  it('formats a 409 carrying an error code with its translated message and code name', () => {
    const { status, body } = run(new ConflictCodeException(ErrorCode.R005));

    expect(status).toBe(409);
    expect(body).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      errorCode: 'R005',
      message: 'translated:role.error.in_use',
    });
  });

  it('formats a 404 carrying an error code', () => {
    const { status, body } = run(new NotFoundCodeException(ErrorCode.R006));

    expect(status).toBe(404);
    expect(body).toMatchObject({
      statusCode: 404,
      errorCode: 'R006',
      message: 'translated:role.error.not_found',
    });
  });

  it('still formats a ValidationException as a 400 with its code', () => {
    const { status, body } = run(new ValidationException(ErrorCode.R001));

    expect(status).toBe(400);
    expect(body).toMatchObject({ errorCode: 'R001' });
  });

  it('leaves plain 404 and 409 exceptions as they were', () => {
    expect(run(new NotFoundException()).body).toMatchObject({
      statusCode: 404,
      message: 'Not Found',
    });
    expect(run(new ConflictException('taken')).body).toMatchObject({
      statusCode: 409,
      message: 'taken',
    });
  });
});
