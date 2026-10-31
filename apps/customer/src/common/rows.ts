/**
 * `em.query` answers `[rows, affected]` for an UPDATE or DELETE and the rows
 * for an INSERT ... RETURNING or a SELECT; this gives the rows of either.
 */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return result as T[];
}
