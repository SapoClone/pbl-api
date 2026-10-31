import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { INSIGHT_RECONCILIATION_DISCREPANCY_DETECTED } from '@pbl/contracts';
import { EventOutbox, qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  formatScaledDecimal,
  parseScaledDecimal,
  subDecimals,
  toReportingDateBucket,
} from '../../domain/insight-domain';
import { ProjectionsService } from '../projections/projections.service';

export interface RunReconciliationInput {
  scope?: 'ALL' | 'SALES' | 'INVENTORY';
  fromDate?: string;
  toDate?: string;
  branchId?: string;
  triggeredBy?: string;
}

@Injectable()
export class InsightReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly projections: ProjectionsService,
    private readonly outbox: EventOutbox,
  ) {}

  async listReconciliationRuns() {
    const tenantId = TenantContext.require();
    const runsTable = qualifiedTable(this.dataSource, 'reconciliation_runs');
    const rows = await this.dataSource.query(
      `SELECT * FROM ${runsTable}
       WHERE "tenant_id" = $1
       ORDER BY "started_at" DESC
       LIMIT 50`,
      [tenantId],
    );
    return {
      data: rows.map((r: Record<string, unknown>) => this.mapRunRow(r)),
    };
  }

  async getReconciliationRun(runId: string) {
    const tenantId = TenantContext.require();
    const runsTable = qualifiedTable(this.dataSource, 'reconciliation_runs');
    const issuesTable = qualifiedTable(
      this.dataSource,
      'reconciliation_issues',
    );

    const runRows = await this.dataSource.query(
      `SELECT * FROM ${runsTable} WHERE "tenant_id" = $1 AND "id" = $2 LIMIT 1`,
      [tenantId, runId],
    );
    if (!runRows[0]) {
      throw new NotFoundException(`Reconciliation run ${runId} not found`);
    }

    const issueRows = await this.dataSource.query(
      `SELECT * FROM ${issuesTable}
       WHERE "tenant_id" = $1 AND "run_id" = $2
       ORDER BY "detected_at" ASC, "id" ASC`,
      [tenantId, runId],
    );

    return {
      ...this.mapRunRow(runRows[0]),
      issues: issueRows.map((i: Record<string, unknown>) => ({
        id: i.id,
        runId: i.run_id,
        scope: i.scope,
        metricName: i.metric_name,
        dimensionKey: i.dimension_key,
        expectedValue: formatScaledDecimal(
          parseScaledDecimal(i.expected_value as string),
          2,
        ),
        actualValue: formatScaledDecimal(
          parseScaledDecimal(i.actual_value as string),
          2,
        ),
        deltaValue: formatScaledDecimal(
          parseScaledDecimal(i.delta_value as string),
          2,
        ),
        severity: i.severity,
        details: i.details,
        detectedAt: i.detected_at,
      })),
    };
  }

  /**
   * Executes analytical reconciliation by comparing pre-aggregated summary tables
   * against normalized fact baselines (`sales_order_facts`, `sales_order_line_facts`,
   * `sales_return_facts`, `inventory_movement_projections`) for the requested window.
   */
  async executeReconciliation(input: RunReconciliationInput) {
    const tenantId = TenantContext.require();
    const today = toReportingDateBucket(new Date());
    const fromDate = input.fromDate ?? today;
    const toDate = input.toDate ?? today;
    const scope = (input.scope ?? 'ALL').toUpperCase();
    const triggeredBy = input.triggeredBy ?? 'system-admin';
    const runId = randomUUID();

    return this.dataSource.transaction(async (manager) => {
      const runsTable = qualifiedTable(
        manager.connection,
        'reconciliation_runs',
      );
      const issuesTable = qualifiedTable(
        manager.connection,
        'reconciliation_issues',
      );
      const orderFactsTable = qualifiedTable(
        manager.connection,
        'sales_order_facts',
      );
      const returnFactsTable = qualifiedTable(
        manager.connection,
        'sales_return_facts',
      );
      const dailyTable = qualifiedTable(
        manager.connection,
        'daily_sales_summaries',
      );

      const { activeGenerationId } =
        await this.projections.getActiveGenerations(
          manager,
          tenantId,
          'sales_analytics',
        );

      const params: unknown[] = [tenantId, fromDate, toDate];
      let branchClause = '';
      if (input.branchId) {
        params.push(input.branchId);
        branchClause = ` AND "branch_id" = $4`;
      }

      // 1. Expected totals from normalized fact tables
      const factOrderRows = await manager.query(
        `SELECT
          COALESCE(SUM("contributed_gmv"), 0) AS "expected_gmv",
          COALESCE(SUM("contributed_gross_revenue"), 0) AS "expected_gross_rev",
          COALESCE(SUM("contributed_discount"), 0) AS "expected_discount",
          COALESCE(SUM("contributed_net_revenue"), 0) AS "expected_order_net_rev",
          COALESCE(SUM("contributed_cogs"), 0) AS "expected_order_cogs",
          COALESCE(SUM("contributed_order_count"), 0)::int AS "expected_order_count",
          COALESCE(SUM("contributed_completed_count"), 0)::int AS "expected_completed_count",
          COALESCE(SUM("contributed_cancelled_count"), 0)::int AS "expected_cancelled_count"
         FROM ${orderFactsTable}
         WHERE "tenant_id" = $1 AND "date_bucket" >= $2 AND "date_bucket" <= $3${branchClause}`,
        params,
      );

      const factReturnRows = await manager.query(
        `SELECT
          COALESCE(SUM("refund_amount"), 0) AS "expected_returns_amount",
          COALESCE(SUM("returned_cogs_amount"), 0) AS "expected_returned_cogs"
         FROM ${returnFactsTable}
         WHERE "tenant_id" = $1 AND "date_bucket" >= $2 AND "date_bucket" <= $3${branchClause}`,
        params,
      );

      // 2. Actual totals from pre-aggregated daily_sales_summaries
      const summaryParams: unknown[] = [
        tenantId,
        activeGenerationId,
        fromDate,
        toDate,
      ];
      let summaryBranchClause = '';
      if (input.branchId) {
        summaryParams.push(input.branchId);
        summaryBranchClause = ` AND "branch_id" = $5`;
      }

      const actualSummaryRows = await manager.query(
        `SELECT
          COALESCE(SUM("gmv"), 0) AS "actual_gmv",
          COALESCE(SUM("gross_sales_revenue"), 0) AS "actual_gross_rev",
          COALESCE(SUM("discount_total"), 0) AS "actual_discount",
          COALESCE(SUM("returns_amount"), 0) AS "actual_returns_amount",
          COALESCE(SUM("net_sales_revenue"), 0) AS "actual_net_rev",
          COALESCE(SUM("net_cogs_amount"), 0) AS "actual_net_cogs",
          COALESCE(SUM("gross_profit"), 0) AS "actual_gross_profit",
          COALESCE(SUM("order_count"), 0)::int AS "actual_order_count",
          COALESCE(SUM("completed_order_count"), 0)::int AS "actual_completed_count",
          COALESCE(SUM("cancelled_order_count"), 0)::int AS "actual_cancelled_count"
         FROM ${dailyTable}
         WHERE "tenant_id" = $1 AND "generation_id" = $2
           AND "date_bucket" >= $3 AND "date_bucket" <= $4${summaryBranchClause}`,
        summaryParams,
      );

      const fo = factOrderRows[0] ?? {};
      const fr = factReturnRows[0] ?? {};
      const act = actualSummaryRows[0] ?? {};

      const expectedNetRev = subDecimals(
        fo.expected_order_net_rev as string,
        fr.expected_returns_amount as string,
        4,
      );
      const expectedNetCogs = subDecimals(
        fo.expected_order_cogs as string,
        fr.expected_returned_cogs as string,
        4,
      );
      const expectedGrossProfit = subDecimals(
        expectedNetRev,
        expectedNetCogs,
        4,
      );

      const checks: Array<{
        metricName: string;
        expected: string;
        actual: string;
        severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      }> = [
        {
          metricName: 'gmv',
          expected: formatScaledDecimal(
            parseScaledDecimal(fo.expected_gmv as string),
            4,
          ),
          actual: formatScaledDecimal(
            parseScaledDecimal(act.actual_gmv as string),
            4,
          ),
          severity: 'MEDIUM',
        },
        {
          metricName: 'gross_sales_revenue',
          expected: formatScaledDecimal(
            parseScaledDecimal(fo.expected_gross_rev as string),
            4,
          ),
          actual: formatScaledDecimal(
            parseScaledDecimal(act.actual_gross_rev as string),
            4,
          ),
          severity: 'HIGH',
        },
        {
          metricName: 'returns_amount',
          expected: formatScaledDecimal(
            parseScaledDecimal(fr.expected_returns_amount as string),
            4,
          ),
          actual: formatScaledDecimal(
            parseScaledDecimal(act.actual_returns_amount as string),
            4,
          ),
          severity: 'HIGH',
        },
        {
          metricName: 'net_sales_revenue',
          expected: expectedNetRev,
          actual: formatScaledDecimal(
            parseScaledDecimal(act.actual_net_rev as string),
            4,
          ),
          severity: 'CRITICAL',
        },
        {
          metricName: 'gross_profit',
          expected: expectedGrossProfit,
          actual: formatScaledDecimal(
            parseScaledDecimal(act.actual_gross_profit as string),
            4,
          ),
          severity: 'HIGH',
        },
        {
          metricName: 'completed_order_count',
          expected: formatScaledDecimal(
            parseScaledDecimal(fo.expected_completed_count as number),
            4,
          ),
          actual: formatScaledDecimal(
            parseScaledDecimal(act.actual_completed_count as number),
            4,
          ),
          severity: 'HIGH',
        },
        {
          metricName: 'cancelled_order_count',
          expected: formatScaledDecimal(
            parseScaledDecimal(fo.expected_cancelled_count as number),
            4,
          ),
          actual: formatScaledDecimal(
            parseScaledDecimal(act.actual_cancelled_count as number),
            4,
          ),
          severity: 'MEDIUM',
        },
      ];

      const issues: Array<Record<string, unknown>> = [];
      const dimensionKey = `${fromDate}..${toDate}:${input.branchId ?? 'ALL_BRANCHES'}`;

      for (const check of checks) {
        const expScaled = parseScaledDecimal(check.expected);
        const actScaled = parseScaledDecimal(check.actual);
        const deltaScaled = actScaled - expScaled;
        if (deltaScaled !== 0n) {
          const issueId = randomUUID();
          const deltaStr = formatScaledDecimal(deltaScaled, 4);
          await manager.query(
            `INSERT INTO ${issuesTable} (
              "id", "tenant_id", "run_id", "scope", "metric_name", "dimension_key",
              "expected_value", "actual_value", "delta_value", "severity", "details", "detected_at"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, now())`,
            [
              issueId,
              tenantId,
              runId,
              scope,
              check.metricName,
              dimensionKey,
              check.expected,
              check.actual,
              deltaStr,
              check.severity,
              JSON.stringify({
                generationId: activeGenerationId,
                fromDate,
                toDate,
                branchId: input.branchId ?? null,
              }),
            ],
          );

          await this.outbox.enqueue(
            manager,
            INSIGHT_RECONCILIATION_DISCREPANCY_DETECTED,
            {
              tenantId,
              aggregateId: runId,
              payload: {
                runId,
                issueId,
                scope,
                metricName: check.metricName,
                dimensionKey,
                expectedValue: formatScaledDecimal(expScaled, 2),
                actualValue: formatScaledDecimal(actScaled, 2),
                deltaValue: formatScaledDecimal(deltaScaled, 2),
                severity: check.severity,
                occurredAt: new Date().toISOString(),
              },
            },
          );

          issues.push({
            id: issueId,
            metricName: check.metricName,
            dimensionKey,
            expectedValue: formatScaledDecimal(expScaled, 2),
            actualValue: formatScaledDecimal(actScaled, 2),
            deltaValue: formatScaledDecimal(deltaScaled, 2),
            severity: check.severity,
          });
        }
      }

      const status = issues.length > 0 ? 'COMPLETED_WITH_ISSUES' : 'COMPLETED';
      const summaryReport = {
        activeGenerationId,
        expectedNetSalesRevenue: formatScaledDecimal(
          parseScaledDecimal(expectedNetRev),
          2,
        ),
        actualNetSalesRevenue: formatScaledDecimal(
          parseScaledDecimal(act.actual_net_rev as string),
          2,
        ),
        expectedGrossProfit: formatScaledDecimal(
          parseScaledDecimal(expectedGrossProfit),
          2,
        ),
        actualGrossProfit: formatScaledDecimal(
          parseScaledDecimal(act.actual_gross_profit as string),
          2,
        ),
      };

      await manager.query(
        `INSERT INTO ${runsTable} (
          "id", "tenant_id", "scope", "from_date", "to_date", "branch_id",
          "status", "metrics_checked", "discrepancies_found", "summary_report",
          "triggered_by", "started_at", "completed_at"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, now(), now())`,
        [
          runId,
          tenantId,
          scope,
          fromDate,
          toDate,
          input.branchId ?? null,
          status,
          checks.length,
          issues.length,
          JSON.stringify(summaryReport),
          triggeredBy,
        ],
      );

      return {
        id: runId,
        scope,
        fromDate,
        toDate,
        branchId: input.branchId ?? null,
        status,
        metricsChecked: checks.length,
        discrepanciesFound: issues.length,
        summaryReport,
        issues,
      };
    });
  }

  private mapRunRow(r: Record<string, unknown>) {
    return {
      id: r.id,
      scope: r.scope,
      fromDate:
        typeof r.from_date === 'string'
          ? r.from_date.slice(0, 10)
          : r.from_date instanceof Date
            ? `${r.from_date.getFullYear()}-${String(r.from_date.getMonth() + 1).padStart(2, '0')}-${String(r.from_date.getDate()).padStart(2, '0')}`
            : String(r.from_date).slice(0, 10),
      toDate:
        typeof r.to_date === 'string'
          ? r.to_date.slice(0, 10)
          : r.to_date instanceof Date
            ? `${r.to_date.getFullYear()}-${String(r.to_date.getMonth() + 1).padStart(2, '0')}-${String(r.to_date.getDate()).padStart(2, '0')}`
            : String(r.to_date).slice(0, 10),
      branchId: r.branch_id,
      status: r.status,
      metricsChecked: Number(r.metrics_checked ?? 0),
      discrepanciesFound: Number(r.discrepancies_found ?? 0),
      summaryReport: r.summary_report,
      triggeredBy: r.triggered_by,
      startedAt: r.started_at,
      completedAt: r.completed_at,
    };
  }
}
