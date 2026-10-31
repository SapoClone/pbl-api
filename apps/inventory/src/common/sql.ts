import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { RequestContext } from '@pbl/common';
import { EntityManager } from 'typeorm';

export const TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const EXPORT_ROW_CAP = 10_000;

export const badRequest = (errorCode: string, message: string) =>
  new BadRequestException({ errorCode, message });
export const conflict = (
  errorCode: string,
  message: string,
  details?: unknown[],
) =>
  new ConflictException({
    errorCode,
    message,
    ...(details ? { details } : {}),
  });
export const notFound = (what: string) =>
  new NotFoundException(`${what} not found`);

/** Branches the caller may act in (`allowedBranches`); null = every branch (ADR-0012 §8) */
export type Scope = string[] | null;

export const inScope = (scope: Scope, branchId: string): boolean =>
  scope === null || scope.includes(branchId);

/** A branch outside the caller's scope answers 404, never 403, so existence is not leaked */
export function assertBranchInScope(scope: Scope, branchId: string): void {
  if (!inScope(scope, branchId)) throw notFound('Branch');
}

/** Same for a document that belongs to branches; visible when any of them is in scope */
export function assertVisible(scope: Scope, what: string, ...ids: string[]) {
  if (scope !== null && !ids.some((id) => scope.includes(id))) {
    throw notFound(what);
  }
}

/** pg returns bigint as a string: money and counts leave the service as JSON numbers */
export const num = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);
export const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

export const iso = (value: Date | string | null): string | null =>
  value === null || value === undefined ? null : new Date(value).toISOString();

/** The actor of the request when it is a uuid, for `created_by` */
export const actorId = (): string | null => {
  const id = RequestContext.get()?.actor?.id;
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
};

/** Builds `WHERE a = $1 AND ...` with numbered parameters */
export class Where {
  readonly params: unknown[] = [];
  private readonly clauses: string[] = [];

  /** Adds a parameter and returns its placeholder */
  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  /** each `?` in the clause becomes the next placeholder */
  add(clause: string, ...values: unknown[]): this {
    let sql = clause;
    for (const value of values) sql = sql.replace('?', this.param(value));
    this.clauses.push(sql);
    return this;
  }

  /** `from` / `to` are YYYY-MM-DD, both inclusive, in the store's time zone */
  dateRange(column: string, from?: string, to?: string): this {
    if (from) {
      this.add(
        `${column} >= (?::date)::timestamp AT TIME ZONE '${TIME_ZONE}'`,
        from,
      );
    }
    if (to) {
      this.add(
        `${column} < ((?::date) + 1)::timestamp AT TIME ZONE '${TIME_ZONE}'`,
        to,
      );
    }
    return this;
  }

  /**
   * Restricts `column` (a uuid) to the allowed branches; no-op for every branch. With
   * several columns a row passes when any of them is allowed.
   */
  branchScope(scope: Scope, ...columns: string[]): this {
    if (scope === null) return this;
    const p = this.param(scope);
    const any = columns.map((c) => `${c} = ANY(${p}::uuid[])`).join(' OR ');
    this.add(columns.length > 1 ? `(${any})` : any);
    return this;
  }

  get sql(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }
}

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

export function pageOf<T>(
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

/** ILIKE pattern that treats the user's text literally */
export const likePattern = (text: string): string =>
  `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const formatCode = (prefix: string, value: number, width: number) =>
  `${prefix}${String(value).padStart(width, '0')}`;

/**
 * Next number of a per-tenant counter (api D4), inside the caller's transaction:
 * `PO` + 5 digits -> `PO00127`.
 */
export async function nextCode(
  em: EntityManager,
  tenantId: string,
  table: string,
  key: string,
  prefix: string,
  width: number,
): Promise<string> {
  const rows = await em.query(
    `INSERT INTO ${table} ("tenant_id", "key", "value") VALUES ($1, $2, 1)
     ON CONFLICT ("tenant_id", "key") DO UPDATE SET "value" = ${table}."value" + 1
     RETURNING "value"`,
    [tenantId, key],
  );
  return formatCode(prefix, Number(rows[0].value), width);
}

/** One CSV field; a leading = + - @ is neutralised so a spreadsheet does not run it */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text))) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return (
    [headers, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') +
    '\r\n'
  );
}
