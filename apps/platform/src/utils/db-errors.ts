import { QueryFailedError } from 'typeorm';

const PG_UNIQUE_VIOLATION = '23505';

/** True when a Postgres insert/update hit the named unique constraint/index. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as {
    code?: string;
    constraint?: string;
  };
  return (
    driverError?.code === PG_UNIQUE_VIOLATION &&
    driverError?.constraint === constraint
  );
}

const PG_FOREIGN_KEY_VIOLATION = '23503';

/** True when a Postgres delete/insert broke the named foreign key. */
export function isForeignKeyViolation(
  error: unknown,
  constraint: string,
): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as {
    code?: string;
    constraint?: string;
  };
  return (
    driverError?.code === PG_FOREIGN_KEY_VIOLATION &&
    driverError?.constraint === constraint
  );
}
