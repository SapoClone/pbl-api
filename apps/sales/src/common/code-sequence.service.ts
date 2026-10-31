import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { qualifiedTable } from '@pbl/events';
import { EntityManager } from 'typeorm';

/**
 * Per-tenant counters behind the readable codes of D4 (`DH10248`, `CA00028`).
 * Call it inside the transaction that inserts the row, so a rollback gives the
 * number back and two requests never get the same one.
 */
@Injectable()
export class CodeSequenceService {
  /** The next value of `key` for the context's tenant; the first call returns `start` */
  async next(em: EntityManager, key: string, start: number): Promise<number> {
    const table = qualifiedTable(em.connection, 'code_sequence');
    const rows: { value: string }[] = await em.query(
      `INSERT INTO ${table} AS cs ("tenant_id", "key", "value") VALUES ($1, $2, $3)
       ON CONFLICT ("tenant_id", "key") DO UPDATE SET "value" = cs."value" + 1
       RETURNING "value"`,
      [TenantContext.require(), key, start],
    );
    return Number(rows[0].value);
  }
}

/** First order number is DH10001 (D4) */
export const ORDER_CODE_START = 10001;
export const orderCode = (n: number) => `DH${n}`;
export const shiftCode = (n: number) => `CA${String(n).padStart(5, '0')}`;
