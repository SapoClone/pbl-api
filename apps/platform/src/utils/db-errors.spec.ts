import { QueryFailedError } from 'typeorm';
import { isUniqueViolation } from './db-errors';

const pgError = (code: string, constraint: string) =>
  new QueryFailedError(
    'INSERT …',
    [],
    Object.assign(new Error('dup'), { code, constraint }),
  );

describe('isUniqueViolation', () => {
  it('matches a unique violation on the named constraint', () => {
    expect(
      isUniqueViolation(
        pgError('23505', 'UQ_tenant_subdomain'),
        'UQ_tenant_subdomain',
      ),
    ).toBe(true);
  });

  it('ignores other constraints, other errors and non-errors', () => {
    expect(
      isUniqueViolation(pgError('23505', 'UQ_other'), 'UQ_tenant_subdomain'),
    ).toBe(false);
    expect(
      isUniqueViolation(
        pgError('23503', 'UQ_tenant_subdomain'),
        'UQ_tenant_subdomain',
      ),
    ).toBe(false);
    expect(isUniqueViolation(new Error('x'), 'UQ_tenant_subdomain')).toBe(
      false,
    );
    expect(isUniqueViolation(undefined, 'UQ_tenant_subdomain')).toBe(false);
  });
});
