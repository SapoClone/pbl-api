import {
  Body,
  Controller,
  Get,
  Injectable,
  Patch,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, CurrentUser, RequirePermission } from '@pbl/auth';
import { DataSource } from 'typeorm';
import { toMoney } from '../../common/money';
import { inTenantTx } from '../../common/tenant-tx';
import { getSchemaPrefix } from '../../infrastructure/persistence/sales-code.generator';
import { BranchScope, branchFilter } from '../../presentation/access';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import { CashSettingsService } from './cash-settings.service';
import { CashShortagesQueryDto, UpdateCashSettingsDto } from './shifts.dto';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Shortage and overage totals from the closing entries, so repeated shortages stand out */
@Injectable()
export class CashReportsService {
  constructor(private readonly dataSource: DataSource) {}

  async shortages(query: CashShortagesQueryDto, scope: BranchScope) {
    const groupBy = query.groupBy ?? 'staff';
    const branchIds = branchFilter(
      scope,
      query.branchId,
      'SHIFT_NOT_FOUND',
      'Branch not found',
    );
    if (scope !== null && scope.length === 0) return { groupBy, data: [] };
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      const params: unknown[] = [tenantId];
      const filters: string[] = [`e.kind IN ('CASH_SHORTAGE', 'CASH_OVERAGE')`];
      if (branchIds) {
        params.push(branchIds);
        filters.push(`e.branch_id = ANY($${params.length}::uuid[])`);
      }
      // days are counted in UTC+7, `to` included
      const bound = (v: string | undefined, op: string, plusDay: boolean) => {
        if (!v) return;
        params.push(v);
        const expr = DAY.test(v)
          ? `($${params.length}::date${plusDay ? ' + 1' : ''})::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'`
          : `$${params.length}::timestamptz`;
        filters.push(`e.recorded_at ${op} ${expr}`);
      };
      bound(query.from, '>=', false);
      bound(query.to, DAY.test(query.to ?? '') ? '<' : '<=', true);

      const key =
        groupBy === 'staff'
          ? 'e.staff_id::text'
          : groupBy === 'branch'
            ? 'e.branch_id::text'
            : `to_char(e.recorded_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`;
      const rows = await em.query(
        `SELECT ${key} AS key,
                COALESCE(SUM(-e.amount) FILTER (WHERE e.kind = 'CASH_SHORTAGE'), 0)::bigint AS shortage_total,
                COUNT(*) FILTER (WHERE e.kind = 'CASH_SHORTAGE')::int AS shortage_count,
                COUNT(DISTINCT e.shift_id) FILTER (WHERE e.kind = 'CASH_SHORTAGE')::int AS shortage_shifts,
                COALESCE(SUM(e.amount) FILTER (WHERE e.kind = 'CASH_OVERAGE'), 0)::bigint AS overage_total,
                COUNT(*) FILTER (WHERE e.kind = 'CASH_OVERAGE')::int AS overage_count
         FROM ${getSchemaPrefix(em)}"pos_shift_cash_entry" e
         WHERE e.tenant_id = $1 AND ${filters.join(' AND ')}
         GROUP BY 1
         ORDER BY shortage_total DESC, key ASC`,
        params,
      );
      return {
        groupBy,
        data: rows.map((r: Record<string, string | number>) => ({
          [groupBy === 'day'
            ? 'day'
            : groupBy === 'staff'
              ? 'staffId'
              : 'branchId']: r.key,
          shortageTotal: toMoney(r.shortage_total),
          shortageCount: Number(r.shortage_count),
          shortageShifts: Number(r.shortage_shifts),
          overageTotal: toMoney(r.overage_total),
          overageCount: Number(r.overage_count),
        })),
      };
    });
  }
}

@ApiTags('cash')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@Controller('api/v1')
export class CashReportsController {
  constructor(
    private readonly reports: CashReportsService,
    private readonly settings: CashSettingsService,
  ) {}

  @Get('cash-shortages')
  @RequirePermission('reports.view')
  @ApiOperation({
    summary: 'Cash shortages and overages by staff, branch or day',
  })
  shortages(
    @Query() query: CashShortagesQueryDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.reports.shortages(query, scope);
  }

  @Get('cash-settings')
  @RequirePermission('settings.view')
  @ApiOperation({ summary: "The store's cash drawer settings" })
  getSettings() {
    return this.settings.get();
  }

  @Patch('cash-settings')
  @RequirePermission('settings.update')
  @ApiOperation({ summary: "Change the store's cash drawer settings" })
  updateSettings(
    @CurrentUser('id') actorId: string,
    @Body() dto: UpdateCashSettingsDto,
  ) {
    return this.settings.update(actorId, dto);
  }
}
