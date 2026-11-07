import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  SALES_SHIFT_CLOSED,
  SALES_SHIFT_OPENED,
  SalesShiftEventPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { toMoney, toMoneyOrNull } from '../../common/money';
import { firstRow } from '../../common/tenant-tx';
import {
  SalesDomainError,
  SalesDomainErrorCode,
  VARIANCE_REASONS,
  countedTotalFromDenominations,
  decideShiftClose,
  expectedCashFromEntries,
  parseVndAmount,
  vndNumber,
} from '../../domain/sales-domain';
import {
  getSchemaPrefix,
  nextTenantDocumentCode,
} from '../../infrastructure/persistence/sales-code.generator';
import {
  BranchScope,
  assertBranchAllowed,
  branchAllowed,
  branchFilter,
} from '../../presentation/access';
import { recordCashEntry } from './cash-ledger';
import { CashSettings, loadCashSettings } from './cash-settings.service';
import {
  AvailableShiftsQueryDto,
  CashEntryReqDto,
  CloseShiftReqDto,
  CountShiftReqDto,
  ListShiftsQueryDto,
  OpenShiftReqDto,
} from './shifts.dto';

export type ShiftStatus =
  | 'OPEN'
  | 'PENDING_CLOSE'
  | 'PENDING_APPROVAL'
  | 'CLOSED';

export interface PosShiftResponse {
  id: string;
  tenantId: string;
  code: string;
  branchId: string;
  registerCode: string;
  registerId: string | null;
  staffId: string;
  status: ShiftStatus;
  openingCash: number;
  cashSalesTotal: number;
  cashRefundsTotal: number;
  expectedCash: number;
  actualCash: number | null;
  variance: number | null;
  openNote: string | null;
  closeNote: string | null;
  closedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  version: number;
  countedByDenomination: Record<string, number> | null;
  countedBy: string | null;
  countedAt: string | null;
  varianceReason: string | null;
  varianceNote: string | null;
  closeRequestedBy: string | null;
  closeRequestedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  responsibility: string | null;
  plannedEndAt: string | null;
  /** Open longer than maxOpenHours, or past plannedEndAt (never closed automatically) */
  overdue: boolean;
}

const ACTIVE = `('OPEN', 'PENDING_CLOSE', 'PENDING_APPROVAL')`;
const iso = (v: unknown) => new Date(v as string | Date).toISOString();

@Injectable()
export class ShiftsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
  ) {}

  private tx<T>(fn: (em: EntityManager, tenantId: string) => Promise<T>) {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return fn(em, tenantId);
    });
  }

  private notFound(shiftId: string) {
    return new SalesDomainError(
      SalesDomainErrorCode.SHIFT_NOT_FOUND,
      `Shift ${shiftId} not found`,
      404,
    );
  }

  /** The shift row locked for update; 404 when missing or outside the caller's branches */
  private async lockShift(
    em: EntityManager,
    tenantId: string,
    shiftId: string,
    scope: BranchScope,
  ) {
    const rows = await em.query(
      `SELECT * FROM ${getSchemaPrefix(em)}"pos_shifts"
       WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, shiftId],
    );
    if (rows.length === 0 || !branchAllowed(scope, rows[0].branch_id)) {
      throw this.notFound(shiftId);
    }
    return rows[0] as Record<string, any>;
  }

  async openShift(
    staffId: string,
    scope: BranchScope,
    dto: OpenShiftReqDto,
  ): Promise<PosShiftResponse> {
    assertBranchAllowed(
      scope,
      dto.branchId,
      'SHIFT_NOT_FOUND',
      'Branch not found',
    );
    const prefix = getSchemaPrefix(this.dataSource);
    let registerCode = (dto.registerCode ?? 'REG-01').trim().toUpperCase();
    const openingCash = vndNumber(parseVndAmount(dto.openingCash, true));

    try {
      return await this.tx(async (em, tenantId) => {
        const settings = await loadCashSettings(em, tenantId);
        if (openingCash > settings.maxOpeningFloatVnd && !dto.note?.trim()) {
          throw new SalesDomainError(
            SalesDomainErrorCode.OPENING_FLOAT_NOTE_REQUIRED,
            `An opening float above ${settings.maxOpeningFloatVnd} needs a note`,
            400,
          );
        }

        const branchRows = await em.query(
          `SELECT status FROM ${prefix}"branch_projection" WHERE tenant_id = $1 AND branch_id = $2 LIMIT 1`,
          [tenantId, dto.branchId],
        );
        if (branchRows.length === 0 || branchRows[0].status !== 'active') {
          throw new SalesDomainError(
            SalesDomainErrorCode.UNKNOWN_BRANCH,
            `Branch ${dto.branchId} does not exist or is not active`,
            400,
          );
        }

        let registerId: string | null = null;
        if (dto.registerId) {
          const registers = await em.query(
            `SELECT id, code FROM ${prefix}"registers"
             WHERE tenant_id = $1 AND id = $2 AND branch_id = $3 AND status = 'active'
             FOR UPDATE`,
            [tenantId, dto.registerId, dto.branchId],
          );
          if (registers.length === 0) {
            throw new SalesDomainError(
              SalesDomainErrorCode.REGISTER_NOT_FOUND,
              `Register ${dto.registerId} not found in this branch`,
              404,
            );
          }
          registerId = registers[0].id as string;
          registerCode = String(registers[0].code).toUpperCase();
        }

        // One open (or closing) shift per register, whoever opens it, on both routes
        await em.query(
          `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
          [tenantId, `shift:${dto.branchId}:${registerCode}`],
        );
        const busy = await em.query(
          `SELECT id FROM ${prefix}"pos_shifts"
           WHERE tenant_id = $1 AND branch_id = $2 AND status IN ${ACTIVE}
             AND (register_code = $3 OR ($4::uuid IS NOT NULL AND register_id = $4::uuid))
           LIMIT 1`,
          [tenantId, dto.branchId, registerCode, registerId],
        );
        if (busy.length > 0) {
          throw new SalesDomainError(
            SalesDomainErrorCode.SHIFT_ALREADY_OPEN,
            `Register ${registerCode} already has an open shift`,
            409,
          );
        }

        const shiftId = randomUUID();
        const code = await nextTenantDocumentCode(em, tenantId, 'CA');
        const inserted = await em.query(
          `INSERT INTO ${prefix}"pos_shifts" (
             id, tenant_id, code, branch_id, register_code, staff_id,
             status, opening_cash, cash_sales_total, cash_refunds_total,
             expected_cash, open_note, register_id, opened_at, planned_end_at, version
           ) VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7::bigint, 0, 0, $7::bigint, $8, $9, now(),
                     now() + make_interval(hours => $10::int), 1)
           RETURNING *`,
          [
            shiftId,
            tenantId,
            code,
            dto.branchId,
            registerCode,
            staffId,
            openingCash,
            dto.note ?? null,
            registerId,
            settings.maxOpenHours,
          ],
        );
        const row = inserted[0];
        await this.outbox.add(em, SALES_SHIFT_OPENED, {
          shiftId: row.id,
          code: row.code,
          branchId: row.branch_id,
          staffId: row.staff_id,
          status: 'OPEN',
          openingCash: toMoney(row.opening_cash),
          occurredAt: iso(row.opened_at),
        } satisfies SalesShiftEventPayload);
        return this.mapShiftRow(row, settings);
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === '23505'
      ) {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_ALREADY_OPEN,
          `Register ${registerCode} already has an open shift`,
          409,
        );
      }
      throw error;
    }
  }

  async getActiveShift(
    staffId: string,
    scope: BranchScope,
    branchId?: string,
    registerCode?: string,
  ): Promise<PosShiftResponse> {
    const branchIds = branchFilter(
      scope,
      branchId,
      'SHIFT_NOT_FOUND',
      'Branch not found',
    );
    return this.tx(async (em, tenantId) => {
      const params: unknown[] = [tenantId, staffId];
      const filters: string[] = [];
      if (branchIds) {
        params.push(branchIds);
        filters.push(`AND branch_id = ANY($${params.length}::uuid[])`);
      }
      if (registerCode) {
        params.push(registerCode.trim().toUpperCase());
        filters.push(`AND register_code = $${params.length}`);
      }
      const rows = await em.query(
        `SELECT * FROM ${getSchemaPrefix(em)}"pos_shifts"
         WHERE tenant_id = $1 AND staff_id = $2 AND status = 'OPEN' ${filters.join(' ')}
         ORDER BY opened_at DESC LIMIT 1`,
        params,
      );
      if (rows.length === 0) {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_NOT_OPEN,
          'No active OPEN shift found for cashier',
          404,
        );
      }
      return this.mapShiftRow(rows[0], await loadCashSettings(em, tenantId));
    });
  }

  /** Open shifts a cashier may sell into at the branch(es) they can see (a shared drawer is allowed) */
  async available(query: AvailableShiftsQueryDto, scope: BranchScope) {
    const branchIds = branchFilter(
      scope,
      query.branchId,
      'SHIFT_NOT_FOUND',
      'Branch not found',
    );
    return this.tx(async (em, tenantId) => {
      const params: unknown[] = [tenantId];
      let filter = '';
      if (branchIds) {
        params.push(branchIds);
        filter = `AND branch_id = ANY($2::uuid[])`;
      }
      const rows = await em.query(
        `SELECT id, code, branch_id, register_id, register_code, staff_id, opened_at, planned_end_at
         FROM ${getSchemaPrefix(em)}"pos_shifts"
         WHERE tenant_id = $1 AND status = 'OPEN' ${filter}
         ORDER BY opened_at ASC`,
        params,
      );
      return {
        data: rows.map((r: Record<string, any>) => ({
          id: r.id,
          code: r.code,
          branchId: r.branch_id,
          register: { id: r.register_id ?? null, code: r.register_code },
          opener: { id: r.staff_id },
          openedAt: iso(r.opened_at),
          plannedEndAt: r.planned_end_at ? iso(r.planned_end_at) : null,
        })),
      };
    });
  }

  private async assertNoPendingWork(
    em: EntityManager,
    tenantId: string,
    shift: Record<string, any>,
    checkDrafts: boolean,
  ) {
    const prefix = getSchemaPrefix(em);
    const pendingWorkflows = await em.query(
      `SELECT id, state FROM ${prefix}"checkout_workflow"
       WHERE tenant_id = $1 AND shift_id = $2
         AND state IN ('PENDING_STOCK', 'RESERVING', 'RESERVING_STOCK', 'STOCK_RESERVED', 'COMMITTING_STOCK', 'FINALIZING', 'RECOVERY_PENDING')
       LIMIT 1`,
      [tenantId, shift.id],
    );
    if (pendingWorkflows.length > 0) {
      throw new SalesDomainError(
        SalesDomainErrorCode.SHIFT_HAS_PENDING_TRANSACTIONS,
        `Cannot close shift ${shift.code} while checkout ${pendingWorkflows[0].id} is in state ${pendingWorkflows[0].state}`,
        409,
        { pendingCheckoutId: pendingWorkflows[0].id },
      );
    }
    if (checkDrafts) {
      const drafts = await em.query(
        `SELECT id FROM ${prefix}"pos_drafts"
         WHERE tenant_id = $1 AND shift_id = $2 AND status = 'ACTIVE' AND expires_at > now()
         ORDER BY created_at`,
        [tenantId, shift.id],
      );
      if (drafts.length > 0) {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_HAS_OPEN_DRAFTS,
          `Cannot close shift ${shift.code} while draft invoices are open`,
          400,
          { draftIds: drafts.map((d: { id: string }) => d.id) },
        );
      }
    }
  }

  /** expected cash from the entries (the truth the shift totals are derived from) */
  private async expectedFromEntries(
    em: EntityManager,
    tenantId: string,
    shift: Record<string, any>,
  ): Promise<number> {
    const entries = await em.query(
      `SELECT kind, amount FROM ${getSchemaPrefix(em)}"pos_shift_cash_entry"
       WHERE tenant_id = $1 AND shift_id = $2`,
      [tenantId, shift.id],
    );
    return expectedCashFromEntries(
      toMoney(shift.opening_cash),
      entries.map((e: { kind: string; amount: string }) => ({
        kind: e.kind,
        amount: toMoney(e.amount),
      })),
    );
  }

  private pushHistory(
    shift: Record<string, any>,
    step: string,
    by: string,
    extra: Record<string, unknown> = {},
  ): string {
    const history = Array.isArray(shift.close_history)
      ? shift.close_history
      : [];
    return JSON.stringify([
      ...history,
      { step, by, at: new Date().toISOString(), ...extra },
    ]);
  }

  /** The cashier counts the drawer by denomination; returns the computed total, expected and variance */
  async countShift(
    shiftId: string,
    actorId: string,
    scope: BranchScope,
    dto: CountShiftReqDto,
  ) {
    return this.tx(async (em, tenantId) => {
      const shift = await this.lockShift(em, tenantId, shiftId, scope);
      this.assertVersion(shift, dto.version);
      if (shift.status === 'CLOSED') {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_ALREADY_CLOSED,
          `Shift ${shift.code} is already CLOSED`,
          409,
        );
      }
      if (shift.status === 'PENDING_APPROVAL') {
        throw new SalesDomainError(
          SalesDomainErrorCode.APPROVAL_REQUIRED,
          `Shift ${shift.code} waits for a manager: it can only be approved or sent back`,
          409,
        );
      }
      await this.assertNoPendingWork(em, tenantId, shift, false);
      const settings = await loadCashSettings(em, tenantId);
      const counted = countedTotalFromDenominations(
        dto.denominations,
        settings.denominations,
      );
      const expected = await this.expectedFromEntries(em, tenantId, shift);
      const variance = counted - expected;
      const updated = await em.query(
        `UPDATE ${getSchemaPrefix(em)}"pos_shifts"
         SET status = 'PENDING_CLOSE', counted_by_denomination = $3::jsonb, counted_by = $4,
             counted_at = now(), expected_cash = $5::bigint, actual_cash = $6::bigint,
             variance = $7::bigint, close_history = $8::jsonb, version = version + 1
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [
          tenantId,
          shiftId,
          JSON.stringify(dto.denominations),
          actorId,
          expected,
          counted,
          variance,
          this.pushHistory(shift, 'counted', actorId, {
            countedTotal: counted,
            expectedCash: expected,
            variance,
            denominations: dto.denominations,
          }),
        ],
      );
      return {
        shift: this.mapShiftRow(
          firstRow(updated) as Record<string, any>,
          settings,
        ),
        countedTotal: counted,
        expectedCash: expected,
        variance,
        decision: decideShiftClose({
          variance,
          toleranceVnd: settings.toleranceVnd,
          approvalAboveVnd: settings.approvalAboveVnd,
        }),
      };
    });
  }

  private assertVersion(shift: Record<string, any>, version?: number) {
    if (version !== undefined && Number(shift.version) !== version) {
      throw new SalesDomainError(
        SalesDomainErrorCode.RESOURCE_VERSION_CONFLICT,
        `Shift ${shift.code} version mismatch (expected ${version}, actual ${shift.version})`,
        409,
      );
    }
  }

  async closeShift(
    shiftId: string,
    actorId: string,
    scope: BranchScope,
    dto: CloseShiftReqDto,
  ): Promise<PosShiftResponse> {
    return this.tx(async (em, tenantId) => {
      const shift = await this.lockShift(em, tenantId, shiftId, scope);
      this.assertVersion(shift, dto.version);
      if (shift.status === 'CLOSED') {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_ALREADY_CLOSED,
          `Shift ${shift.code} is already CLOSED`,
          409,
        );
      }
      if (shift.status === 'PENDING_APPROVAL') {
        throw new SalesDomainError(
          SalesDomainErrorCode.APPROVAL_REQUIRED,
          `Shift ${shift.code} waits for a manager's approval`,
          409,
        );
      }
      await this.assertNoPendingWork(em, tenantId, shift, true);
      const settings = await loadCashSettings(em, tenantId);

      let counted: number;
      let countedBy: string | null = shift.counted_by;
      let denominations = shift.counted_by_denomination;
      if (dto.actualCash !== undefined) {
        // a total given at close replaces any earlier count (the legacy close)
        counted = vndNumber(parseVndAmount(dto.actualCash, true));
        countedBy = actorId;
        denominations = null;
      } else if (
        shift.status === 'PENDING_CLOSE' &&
        shift.actual_cash != null
      ) {
        counted = toMoney(shift.actual_cash);
      } else {
        throw new SalesDomainError(
          SalesDomainErrorCode.COUNT_REQUIRED,
          'Count the drawer (POST /count) or give actualCash before closing',
          400,
        );
      }
      const expected = await this.expectedFromEntries(em, tenantId, shift);
      const variance = counted - expected;
      const decision = decideShiftClose({
        variance,
        toleranceVnd: settings.toleranceVnd,
        approvalAboveVnd: settings.approvalAboveVnd,
      });
      const reason = dto.reason ?? null;
      if (decision !== 'WITHIN_TOLERANCE' && !reason) {
        throw new SalesDomainError(
          SalesDomainErrorCode.VARIANCE_REASON_REQUIRED,
          `The variance (${variance}) is above the tolerance: choose a reason (${VARIANCE_REASONS.join(', ')})`,
          400,
          { variance, tolerance: settings.toleranceVnd },
        );
      }

      const base = {
        shift,
        counted,
        countedBy: countedBy ?? actorId,
        denominations,
        expected,
        variance,
        reason,
        note: dto.note ?? null,
        settings,
      };
      if (decision === 'APPROVAL_REQUIRED') {
        const updated = await em.query(
          `UPDATE ${getSchemaPrefix(em)}"pos_shifts"
           SET status = 'PENDING_APPROVAL', counted_by_denomination = $3::jsonb, counted_by = $4,
               counted_at = COALESCE(counted_at, now()), expected_cash = $5::bigint,
               actual_cash = $6::bigint, variance = $7::bigint, variance_reason = $8, variance_note = $9,
               close_requested_by = $10, close_requested_at = now(), close_history = $11::jsonb,
               version = version + 1
           WHERE tenant_id = $1 AND id = $2 RETURNING *`,
          [
            tenantId,
            shiftId,
            denominations ? JSON.stringify(denominations) : null,
            base.countedBy,
            expected,
            counted,
            variance,
            reason,
            base.note,
            actorId,
            this.pushHistory(shift, 'close_requested', actorId, {
              variance,
              reason,
              note: base.note,
            }),
          ],
        );
        return this.mapShiftRow(
          firstRow(updated) as Record<string, any>,
          settings,
        );
      }
      return this.finalizeClose(em, tenantId, {
        ...base,
        closedBy: actorId,
        approvedBy: null,
      });
    });
  }

  /** Writes the shortage or overage entry, closes the row and emits `sales.shift.closed` */
  private async finalizeClose(
    em: EntityManager,
    tenantId: string,
    p: {
      shift: Record<string, any>;
      counted: number;
      countedBy: string;
      denominations: unknown;
      expected: number;
      variance: number;
      reason: string | null;
      note: string | null;
      settings: CashSettings;
      closedBy: string;
      approvedBy: string | null;
    },
  ): Promise<PosShiftResponse> {
    const prefix = getSchemaPrefix(em);
    let varianceEntryId: string | null = null;
    if (p.variance !== 0) {
      const entry = await recordCashEntry(
        em,
        {
          tenantId,
          shiftId: p.shift.id,
          kind: p.variance < 0 ? 'CASH_SHORTAGE' : 'CASH_OVERAGE',
          amount: p.variance,
          reason: p.reason ?? 'within_tolerance',
          note: p.note,
          staffId: p.countedBy,
          sourceKey: `close:${p.shift.id}`,
        },
        { closing: true },
      );
      varianceEntryId = entry.entryId;
    }
    const closeNote = p.note ?? p.shift.variance_note ?? null;
    const updatedRows = await em.query(
      `UPDATE ${prefix}"pos_shifts"
       SET status = 'CLOSED', expected_cash = $3::bigint, actual_cash = $4::bigint, variance = $5::bigint,
           close_note = $6, closed_by = $7, closed_at = now(), counted_by = $8,
           counted_by_denomination = $9::jsonb, counted_at = COALESCE(counted_at, now()),
           variance_reason = $10, variance_note = $6, approved_by = $11,
           approved_at = CASE WHEN $11::uuid IS NULL THEN NULL ELSE now() END,
           responsibility = $12, close_history = $13::jsonb, version = version + 1
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [
        tenantId,
        p.shift.id,
        p.expected,
        p.counted,
        p.variance,
        closeNote,
        p.closedBy,
        p.countedBy,
        p.denominations ? JSON.stringify(p.denominations) : null,
        p.reason,
        p.approvedBy,
        p.settings.responsibility,
        this.pushHistory(
          p.shift,
          p.approvedBy ? 'approved' : 'closed',
          p.closedBy,
          { variance: p.variance, reason: p.reason, entryId: varianceEntryId },
        ),
      ],
    );
    const closed = firstRow(updatedRows) as Record<string, any>;
    await this.outbox.add(em, SALES_SHIFT_CLOSED, {
      shiftId: closed.id,
      code: closed.code,
      branchId: closed.branch_id,
      staffId: closed.staff_id,
      status: 'CLOSED',
      openingCash: toMoney(closed.opening_cash),
      expectedCash: toMoney(closed.expected_cash),
      actualCash: toMoney(closed.actual_cash),
      variance: toMoney(closed.variance),
      varianceReason: closed.variance_reason,
      varianceNote: closed.variance_note,
      responsibility: closed.responsibility,
      countedBy: closed.counted_by,
      closedBy: closed.closed_by,
      approvedBy: closed.approved_by,
      varianceEntryId,
      occurredAt: iso(closed.closed_at),
    } satisfies SalesShiftEventPayload);
    return this.mapShiftRow(closed, p.settings);
  }

  /** A manager (pos.approve, not the counter) approves a close that waits for approval */
  async approveClose(
    shiftId: string,
    actorId: string,
    scope: BranchScope,
    note?: string,
  ): Promise<PosShiftResponse> {
    return this.tx(async (em, tenantId) => {
      const shift = await this.lockShift(em, tenantId, shiftId, scope);
      if (shift.status === 'CLOSED') {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_ALREADY_CLOSED,
          `Shift ${shift.code} is already CLOSED`,
          409,
        );
      }
      if (shift.status !== 'PENDING_APPROVAL') {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_NOT_OPEN,
          `Shift ${shift.code} is ${shift.status}, not waiting for approval`,
          409,
        );
      }
      if (
        actorId === shift.counted_by ||
        actorId === shift.close_requested_by
      ) {
        throw new SalesDomainError(
          SalesDomainErrorCode.APPROVER_IS_COUNTER,
          'The approver cannot be the person who counted the drawer or asked to close',
          403,
        );
      }
      const settings = await loadCashSettings(em, tenantId);
      const expected = await this.expectedFromEntries(em, tenantId, shift);
      const counted = toMoney(shift.actual_cash);
      return this.finalizeClose(em, tenantId, {
        shift,
        counted,
        countedBy: shift.counted_by,
        denominations: shift.counted_by_denomination,
        expected,
        variance: counted - expected,
        reason: shift.variance_reason,
        note: note ?? shift.variance_note,
        settings,
        closedBy: actorId,
        approvedBy: actorId,
      });
    });
  }

  /** A manager sends a counted shift back for a recount: it returns to OPEN, the count stays in the history */
  async rejectClose(
    shiftId: string,
    actorId: string,
    scope: BranchScope,
    note: string,
  ): Promise<PosShiftResponse> {
    return this.tx(async (em, tenantId) => {
      const shift = await this.lockShift(em, tenantId, shiftId, scope);
      if (shift.status === 'CLOSED') {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_ALREADY_CLOSED,
          `Shift ${shift.code} is already CLOSED`,
          409,
        );
      }
      if (shift.status === 'OPEN') {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_NOT_OPEN,
          `Shift ${shift.code} has no count to send back`,
          409,
        );
      }
      const updated = await em.query(
        `UPDATE ${getSchemaPrefix(em)}"pos_shifts"
         SET status = 'OPEN', counted_by_denomination = NULL, counted_by = NULL, counted_at = NULL,
             actual_cash = NULL, variance = NULL, variance_reason = NULL, variance_note = NULL,
             close_requested_by = NULL, close_requested_at = NULL, close_history = $3::jsonb,
             version = version + 1
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [
          tenantId,
          shiftId,
          this.pushHistory(shift, 'sent_back', actorId, {
            note,
            countedTotal:
              shift.actual_cash == null ? null : toMoney(shift.actual_cash),
            denominations: shift.counted_by_denomination,
            countedBy: shift.counted_by,
          }),
        ],
      );
      return this.mapShiftRow(
        firstRow(updated) as Record<string, any>,
        await loadCashSettings(em, tenantId),
      );
    });
  }

  /** A pay-in or pay-out on an OPEN shift (reason required, amount above 0) */
  async addCashEntry(
    shiftId: string,
    actorId: string,
    scope: BranchScope,
    key: string | undefined,
    dto: CashEntryReqDto,
  ) {
    return this.tx(async (em, tenantId) => {
      const rows = await em.query(
        `SELECT branch_id FROM ${getSchemaPrefix(em)}"pos_shifts" WHERE tenant_id = $1 AND id = $2`,
        [tenantId, shiftId],
      );
      if (rows.length === 0 || !branchAllowed(scope, rows[0].branch_id)) {
        throw this.notFound(shiftId);
      }
      const sourceKey = key?.trim()
        ? `cash:${shiftId}:${key.trim().slice(0, 100)}`
        : `cash:${randomUUID()}`;
      const result = await recordCashEntry(em, {
        tenantId,
        shiftId,
        kind: dto.kind,
        amount: dto.kind === 'PAY_IN' ? dto.amount : -dto.amount,
        reason: dto.reason.trim(),
        note: dto.note ?? null,
        staffId: actorId,
        sourceKey,
      });
      const entry = await em.query(
        `SELECT * FROM ${getSchemaPrefix(em)}"pos_shift_cash_entry" WHERE id = $1`,
        [result.entryId],
      );
      return { replayed: result.replayed, entry: this.mapEntry(entry[0]) };
    });
  }

  /** A manager moves the planned end of an OPEN shift (design 5.2: for the demo; money is untouched) */
  async patchPlannedEnd(
    shiftId: string,
    scope: BranchScope,
    plannedEndAt: string,
  ): Promise<PosShiftResponse> {
    return this.tx(async (em, tenantId) => {
      const shift = await this.lockShift(em, tenantId, shiftId, scope);
      if (shift.status !== 'OPEN') {
        throw new SalesDomainError(
          shift.status === 'CLOSED'
            ? SalesDomainErrorCode.SHIFT_CLOSED
            : SalesDomainErrorCode.SHIFT_NOT_OPEN,
          `Shift ${shift.code} is ${shift.status}: only an OPEN shift's planned end can change`,
          409,
        );
      }
      const updated = await em.query(
        `UPDATE ${getSchemaPrefix(em)}"pos_shifts"
         SET planned_end_at = $3::timestamptz, version = version + 1
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, shiftId, plannedEndAt],
      );
      return this.mapShiftRow(
        firstRow(updated) as Record<string, any>,
        await loadCashSettings(em, tenantId),
      );
    });
  }

  private mapEntry(r: Record<string, any>) {
    return {
      id: r.id,
      shiftId: r.shift_id,
      kind: r.kind,
      amount: toMoney(r.amount),
      reason: r.reason,
      note: r.note,
      orderId: r.order_id,
      returnId: r.return_id,
      tenderId: r.tender_id,
      staffId: r.staff_id,
      occurredAt: iso(r.occurred_at),
      recordedAt: iso(r.recorded_at),
    };
  }

  /** The shift with every entry, who handled the cash and the close history */
  async getDetail(shiftId: string, scope: BranchScope) {
    return this.tx(async (em, tenantId) => {
      const prefix = getSchemaPrefix(em);
      const rows = await em.query(
        `SELECT * FROM ${prefix}"pos_shifts" WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, shiftId],
      );
      if (rows.length === 0 || !branchAllowed(scope, rows[0].branch_id)) {
        throw this.notFound(shiftId);
      }
      const settings = await loadCashSettings(em, tenantId);
      const entries = await em.query(
        `SELECT * FROM ${prefix}"pos_shift_cash_entry"
         WHERE tenant_id = $1 AND shift_id = $2 ORDER BY recorded_at, id`,
        [tenantId, shiftId],
      );
      const mapped = entries.map((e: Record<string, any>) => this.mapEntry(e));
      const perStaff = new Map<
        string,
        { staffId: string; cashIn: number; cashOut: number; entries: number }
      >();
      for (const e of mapped) {
        if (e.kind === 'CASH_SHORTAGE' || e.kind === 'CASH_OVERAGE') continue;
        const s = perStaff.get(e.staffId) ?? {
          staffId: e.staffId,
          cashIn: 0,
          cashOut: 0,
          entries: 0,
        };
        if (e.amount > 0) s.cashIn += e.amount;
        else s.cashOut += -e.amount;
        s.entries += 1;
        perStaff.set(e.staffId, s);
      }
      return {
        ...this.mapShiftRow(rows[0], settings),
        entries: mapped,
        staffTotals: [...perStaff.values()],
        closeHistory: rows[0].close_history ?? [],
      };
    });
  }

  async getById(
    shiftId: string,
    scope: BranchScope,
  ): Promise<PosShiftResponse> {
    return this.tx(async (em, tenantId) => {
      const rows = await em.query(
        `SELECT * FROM ${getSchemaPrefix(em)}"pos_shifts" WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, shiftId],
      );
      if (rows.length === 0 || !branchAllowed(scope, rows[0].branch_id)) {
        throw this.notFound(shiftId);
      }
      return this.mapShiftRow(rows[0], await loadCashSettings(em, tenantId));
    });
  }

  async listShifts(query: ListShiftsQueryDto, scope: BranchScope) {
    const branchIds = branchFilter(
      scope,
      query.branchId,
      'SHIFT_NOT_FOUND',
      'Branch not found',
    );
    const limit = query.limit ?? 20;
    const page = query.page ?? 1;
    const offset = (page - 1) * limit;

    return this.tx(async (em, tenantId) => {
      const prefix = getSchemaPrefix(em);
      const settings = await loadCashSettings(em, tenantId);
      const params: unknown[] = [tenantId];
      const filters: string[] = [];
      if (branchIds) {
        params.push(branchIds);
        filters.push(`AND branch_id = ANY($${params.length}::uuid[])`);
      }
      if (query.status) {
        params.push(
          query.status
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
        );
        filters.push(`AND status = ANY($${params.length}::text[])`);
      }
      if (query.overdue) {
        params.push(settings.maxOpenHours);
        filters.push(
          `AND status IN ${ACTIVE} AND (now() > planned_end_at OR now() > opened_at + make_interval(hours => $${params.length}::int))`,
        );
      }
      const where = filters.join(' ');
      const countRows = await em.query(
        `SELECT COUNT(*)::int AS total FROM ${prefix}"pos_shifts" WHERE tenant_id = $1 ${where}`,
        params,
      );
      const totalRecords = Number(countRows[0]?.total ?? 0);
      const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
      const dataParams = [...params, limit, offset];
      const rows = await em.query(
        `SELECT * FROM ${prefix}"pos_shifts"
         WHERE tenant_id = $1 ${where}
         ORDER BY (status = 'PENDING_APPROVAL') DESC, opened_at DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams,
      );
      return {
        data: rows.map((r: Record<string, unknown>) =>
          this.mapShiftRow(r, settings),
        ),
        pagination: {
          limit,
          currentPage: page,
          ...(page < totalPages ? { nextPage: page + 1 } : {}),
          totalRecords,
          totalPages,
        },
      };
    });
  }

  private mapShiftRow(
    row: Record<string, unknown>,
    settings: CashSettings,
  ): PosShiftResponse {
    const status = row.status as ShiftStatus;
    const opened = new Date(row.opened_at as string | Date).getTime();
    const now = Date.now();
    const planned = row.planned_end_at
      ? new Date(row.planned_end_at as string | Date).getTime()
      : null;
    const overdue =
      status !== 'CLOSED' &&
      ((planned !== null && now > planned) ||
        now > opened + settings.maxOpenHours * 3600_000);
    const opt = (v: unknown) => (v ? iso(v) : null);
    const str = (v: unknown) => (v ? String(v) : null);
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      code: String(row.code),
      branchId: String(row.branch_id),
      registerCode: String(row.register_code),
      registerId: str(row.register_id),
      staffId: String(row.staff_id),
      status,
      openingCash: toMoney(row.opening_cash),
      cashSalesTotal: toMoney(row.cash_sales_total),
      cashRefundsTotal: toMoney(row.cash_refunds_total),
      expectedCash: toMoney(row.expected_cash),
      actualCash: toMoneyOrNull(row.actual_cash),
      variance: toMoneyOrNull(row.variance),
      openNote: str(row.open_note),
      closeNote: str(row.close_note),
      closedBy: str(row.closed_by),
      openedAt: iso(row.opened_at),
      closedAt: opt(row.closed_at),
      version: Number(row.version ?? 1),
      countedByDenomination:
        (row.counted_by_denomination as Record<string, number> | null) ?? null,
      countedBy: str(row.counted_by),
      countedAt: opt(row.counted_at),
      varianceReason: str(row.variance_reason),
      varianceNote: str(row.variance_note),
      closeRequestedBy: str(row.close_requested_by),
      closeRequestedAt: opt(row.close_requested_at),
      approvedBy: str(row.approved_by),
      approvedAt: opt(row.approved_at),
      responsibility: str(row.responsibility),
      plannedEndAt: opt(row.planned_end_at),
      overdue,
    };
  }
}
