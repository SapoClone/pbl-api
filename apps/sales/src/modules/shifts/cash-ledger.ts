import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import {
  CashEntryKind,
  SalesDomainError,
  SalesDomainErrorCode,
} from '../../domain/sales-domain';
import { getSchemaPrefix } from '../../infrastructure/persistence/sales-code.generator';

export interface CashEntryInput {
  tenantId: string;
  shiftId: string;
  kind: CashEntryKind;
  /** Signed integer VND: positive in, negative out */
  amount: number;
  reason?: string | null;
  note?: string | null;
  orderId?: string | null;
  returnId?: string | null;
  tenderId?: string | null;
  /** The signed-in user who handled the cash */
  staffId: string;
  /** Unique per tenant: a retry with the same key writes nothing new */
  sourceKey: string;
}

export const OPEN_SHIFT_STATUSES = [
  'OPEN',
  'PENDING_CLOSE',
  'PENDING_APPROVAL',
] as const;

/**
 * Writes one cash entry and moves the shift's derived totals, inside the caller's tenant transaction.
 * The shift row is locked first, so an entry and a close (or two entries) never interleave.
 * A retry (same `sourceKey`) returns the first entry and changes nothing, even after the shift closed.
 * `closing: true` is for the shortage and overage entries the close itself writes.
 */
export async function recordCashEntry(
  em: EntityManager,
  input: CashEntryInput,
  options: { closing?: boolean } = {},
): Promise<{ entryId: string; replayed: boolean; branchId: string }> {
  const prefix = getSchemaPrefix(em);
  const shifts = await em.query(
    `SELECT id, status, branch_id, code FROM ${prefix}"pos_shifts"
     WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [input.tenantId, input.shiftId],
  );
  if (shifts.length === 0) {
    throw new SalesDomainError(
      SalesDomainErrorCode.SHIFT_NOT_FOUND,
      `POS shift ${input.shiftId} not found`,
      404,
    );
  }
  const shift = shifts[0];

  const existing = await em.query(
    `SELECT id FROM ${prefix}"pos_shift_cash_entry"
     WHERE tenant_id = $1 AND source_key = $2`,
    [input.tenantId, input.sourceKey],
  );
  if (existing.length > 0) {
    return {
      entryId: existing[0].id,
      replayed: true,
      branchId: shift.branch_id,
    };
  }

  if (!options.closing) {
    if (shift.status === 'CLOSED') {
      throw new SalesDomainError(
        SalesDomainErrorCode.SHIFT_CLOSED,
        `Shift ${shift.code} is CLOSED: nothing can be written to it`,
        409,
      );
    }
    if (shift.status !== 'OPEN') {
      throw new SalesDomainError(
        SalesDomainErrorCode.SHIFT_NOT_OPEN,
        `Shift ${shift.code} is ${shift.status} and takes no cash entries`,
        409,
      );
    }
  }

  const entryId = randomUUID();
  await em.query(
    `INSERT INTO ${prefix}"pos_shift_cash_entry"
       (id, tenant_id, shift_id, branch_id, kind, amount, reason, note, order_id, return_id,
        tender_id, staff_id, occurred_at, recorded_at, source_key)
     VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8, $9, $10, $11, $12, now(), now(), $13)`,
    [
      entryId,
      input.tenantId,
      input.shiftId,
      shift.branch_id,
      input.kind,
      input.amount,
      input.reason ?? null,
      input.note ?? null,
      input.orderId ?? null,
      input.returnId ?? null,
      input.tenderId ?? null,
      input.staffId,
      input.sourceKey,
    ],
  );

  if (input.kind === 'CASH_SHORTAGE' || input.kind === 'CASH_OVERAGE') {
    // the closing entries close the gap: expected cash does not move
    return { entryId, replayed: false, branchId: shift.branch_id };
  }
  const salesDelta = input.kind === 'CASH_SALE' ? input.amount : 0;
  const refundsDelta = input.kind === 'CASH_REFUND' ? -input.amount : 0;
  await em.query(
    `UPDATE ${prefix}"pos_shifts"
     SET cash_sales_total = cash_sales_total + $3::bigint,
         cash_refunds_total = cash_refunds_total + $4::bigint,
         expected_cash = expected_cash + $5::bigint,
         version = version + 1
     WHERE tenant_id = $1 AND id = $2`,
    [input.tenantId, input.shiftId, salesDelta, refundsDelta, input.amount],
  );
  return { entryId, replayed: false, branchId: shift.branch_id };
}

/**
 * The shift a cash refund (or a later cash payment without a chosen shift) goes into: the caller's own
 * OPEN shift at the order's branch, chosen by the server. 409 SHIFT_REQUIRED when the caller has none.
 */
export async function findCallersOpenShift(
  em: EntityManager,
  tenantId: string,
  staffId: string,
  branchId: string,
): Promise<string> {
  const rows = await em.query(
    `SELECT id FROM ${getSchemaPrefix(em)}"pos_shifts"
     WHERE tenant_id = $1 AND staff_id = $2 AND branch_id = $3 AND status = 'OPEN'
     ORDER BY opened_at DESC LIMIT 1`,
    [tenantId, staffId, branchId],
  );
  if (rows.length === 0) {
    throw new SalesDomainError(
      SalesDomainErrorCode.SHIFT_REQUIRED,
      'Cash leaves the current drawer: open a shift at this branch first',
      409,
    );
  }
  return rows[0].id as string;
}

/** A shift the caller picked for cash: it must be OPEN and of the order's branch */
export async function assertOpenShiftOfBranch(
  em: EntityManager,
  tenantId: string,
  shiftId: string,
  branchId: string,
): Promise<void> {
  const rows = await em.query(
    `SELECT status, branch_id FROM ${getSchemaPrefix(em)}"pos_shifts"
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, shiftId],
  );
  if (rows.length === 0) {
    throw new SalesDomainError(
      SalesDomainErrorCode.SHIFT_NOT_FOUND,
      `POS shift ${shiftId} not found`,
      404,
    );
  }
  if (rows[0].branch_id !== branchId || rows[0].status !== 'OPEN') {
    throw new SalesDomainError(
      SalesDomainErrorCode.SHIFT_NOT_OPEN,
      `POS shift ${shiftId} is not an OPEN shift of this branch`,
      409,
    );
  }
}
