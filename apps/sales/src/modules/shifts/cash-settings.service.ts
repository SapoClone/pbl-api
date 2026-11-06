import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { toMoney } from '../../common/money';
import { inTenantTx } from '../../common/tenant-tx';
import {
  CASH_RESPONSIBILITIES,
  CashResponsibility,
  DEFAULT_CASH_DENOMINATIONS,
  SalesDomainError,
  SalesDomainErrorCode,
} from '../../domain/sales-domain';
import { getSchemaPrefix } from '../../infrastructure/persistence/sales-code.generator';
import { UpdateCashSettingsDto } from './shifts.dto';

export interface CashSettings {
  toleranceVnd: number;
  approvalAboveVnd: number;
  responsibility: CashResponsibility;
  maxOpenHours: number;
  maxOpeningFloatVnd: number;
  denominations: number[];
}

export const DEFAULT_CASH_SETTINGS: CashSettings = {
  toleranceVnd: 10000,
  approvalAboveVnd: 10000,
  responsibility: 'none',
  maxOpenHours: 16,
  maxOpeningFloatVnd: 5000000,
  denominations: DEFAULT_CASH_DENOMINATIONS,
};

function map(row: Record<string, unknown>): CashSettings {
  return {
    toleranceVnd: toMoney(row.tolerance_vnd),
    approvalAboveVnd: toMoney(row.approval_above_vnd),
    responsibility: row.responsibility as CashResponsibility,
    maxOpenHours: Number(row.max_open_hours),
    maxOpeningFloatVnd: toMoney(row.max_opening_float_vnd),
    denominations: (row.denominations as number[]).map(Number),
  };
}

/** The store's effective cash settings (defaults until the first PATCH), read inside a tenant tx */
export async function loadCashSettings(
  em: EntityManager,
  tenantId: string,
): Promise<CashSettings> {
  const rows = await em.query(
    `SELECT * FROM ${getSchemaPrefix(em)}"cash_setting" WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows.length === 0
    ? { ...DEFAULT_CASH_SETTINGS }
    : map(rows[0] as Record<string, unknown>);
}

/** Pure validation of the merged settings (whole VND, tolerance <= approval, notes positive and unique) */
export function validateCashSettings(s: CashSettings): void {
  const bad = (message: string) =>
    new SalesDomainError(
      SalesDomainErrorCode.CASH_SETTINGS_INVALID,
      message,
      400,
    );
  for (const [k, v] of Object.entries({
    toleranceVnd: s.toleranceVnd,
    approvalAboveVnd: s.approvalAboveVnd,
    maxOpeningFloatVnd: s.maxOpeningFloatVnd,
  })) {
    if (!Number.isSafeInteger(v) || v < 0) {
      throw bad(`${k} must be a whole number of VND (0 or more)`);
    }
  }
  if (s.toleranceVnd > s.approvalAboveVnd) {
    throw bad('toleranceVnd must not be above approvalAboveVnd');
  }
  if (!Number.isInteger(s.maxOpenHours) || s.maxOpenHours < 1) {
    throw bad('maxOpenHours must be a whole number of hours (1 or more)');
  }
  if (
    !(CASH_RESPONSIBILITIES as readonly string[]).includes(s.responsibility)
  ) {
    throw bad(
      `responsibility must be one of ${CASH_RESPONSIBILITIES.join(', ')}`,
    );
  }
  if (
    s.denominations.length === 0 ||
    s.denominations.some((d) => !Number.isSafeInteger(d) || d <= 0) ||
    new Set(s.denominations).size !== s.denominations.length
  ) {
    throw bad(
      'denominations must be a non-empty list of unique positive whole VND notes',
    );
  }
}

@Injectable()
export class CashSettingsService {
  constructor(private readonly dataSource: DataSource) {}

  get(): Promise<CashSettings> {
    return inTenantTx(this.dataSource, (em, tenantId) =>
      loadCashSettings(em, tenantId),
    );
  }

  async update(
    actorId: string,
    dto: UpdateCashSettingsDto,
  ): Promise<CashSettings> {
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      const prefix = getSchemaPrefix(em);
      await em.query(
        `INSERT INTO ${prefix}"cash_setting" (id, tenant_id, denominations)
         VALUES ($1, $2, $3::jsonb) ON CONFLICT (tenant_id) DO NOTHING`,
        [randomUUID(), tenantId, JSON.stringify(DEFAULT_CASH_DENOMINATIONS)],
      );
      await em.query(
        `SELECT 1 FROM ${prefix}"cash_setting" WHERE tenant_id = $1 FOR UPDATE`,
        [tenantId],
      );
      const current = await loadCashSettings(em, tenantId);
      const next: CashSettings = {
        toleranceVnd: dto.toleranceVnd ?? current.toleranceVnd,
        approvalAboveVnd: dto.approvalAboveVnd ?? current.approvalAboveVnd,
        responsibility:
          (dto.responsibility as CashResponsibility) ?? current.responsibility,
        maxOpenHours: dto.maxOpenHours ?? current.maxOpenHours,
        maxOpeningFloatVnd:
          dto.maxOpeningFloatVnd ?? current.maxOpeningFloatVnd,
        denominations: dto.denominations ?? current.denominations,
      };
      validateCashSettings(next);
      await em.query(
        `UPDATE ${prefix}"cash_setting"
         SET tolerance_vnd = $2, approval_above_vnd = $3, responsibility = $4, max_open_hours = $5,
             max_opening_float_vnd = $6, denominations = $7::jsonb, updated_by = $8, updated_at = now()
         WHERE tenant_id = $1`,
        [
          tenantId,
          next.toleranceVnd,
          next.approvalAboveVnd,
          next.responsibility,
          next.maxOpenHours,
          next.maxOpeningFloatVnd,
          JSON.stringify(next.denominations),
          actorId,
        ],
      );
      return next;
    });
  }
}
