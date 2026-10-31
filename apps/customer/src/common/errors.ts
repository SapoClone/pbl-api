/** Error codes of this service (a domain letter plus 3 digits, api-conventions §6) */
export const CustomerErrorCode = {
  /** The phone belongs to another customer of the store (the body has `existingCustomerId`) */
  PHONE_TAKEN: 'U001',
  /** An address is incomplete or more than one is marked as the default */
  INVALID_ADDRESS: 'U002',
  /** A tag with this name exists */
  TAG_NAME_TAKEN: 'U004',
  /** The balance would go below zero */
  NEGATIVE_BALANCE: 'U005',
  /** A group or tag id is not one of this store's */
  UNKNOWN_REFERENCE: 'U006',
  /** A group with this name exists */
  GROUP_NAME_TAKEN: 'U007',
} as const;

export interface Page<T> {
  data: T[];
  pagination: {
    limit: number;
    currentPage: number;
    nextPage?: number;
    totalRecords: number;
    totalPages: number;
  };
}

export function toPage<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): Page<T> {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    data,
    pagination: {
      limit,
      currentPage: page,
      ...(page < totalPages ? { nextPage: page + 1 } : {}),
      totalRecords: total,
      totalPages,
    },
  };
}

/** bigint columns come back as strings; money is integer VND (api-conventions §3) */
export const bigintNumber = {
  to: (value?: number) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : Number(value),
};

/** Postgres unique violation */
export const isUniqueViolation = (error: unknown, constraint?: string) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: string }).code === '23505' &&
  (constraint === undefined ||
    (error as { constraint?: string }).constraint === constraint);
