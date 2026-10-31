import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { INSIGHT_PROJECTION_REBUILT } from '@pbl/contracts';
import { EventOutbox, qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  computeTargetOrderContribution,
  formatDateColumn,
  formatScaledDecimal,
  parseScaledDecimal,
  subDecimals,
} from '../../domain/insight-domain';
import { ProjectionsService } from '../projections/projections.service';

export interface TriggerRebuildInput {
  projectionName?: string;
  fromDate?: string;
  toDate?: string;
  triggeredBy?: string;
  reason?: string;
  simulateFailureAfterShadowBuild?: boolean;
}

@Injectable()
export class InsightRebuildService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly projections: ProjectionsService,
    private readonly outbox: EventOutbox,
  ) {}

  async getProjectionsStatus() {
    const tenantId = TenantContext.require();
    const [salesStatus, invStatus] = await Promise.all([
      this.projections.getFreshness(tenantId, 'sales_analytics'),
      this.projections.getFreshness(tenantId, 'inventory_analytics'),
    ]);

    const genTable = qualifiedTable(this.dataSource, 'projection_generations');
    const recentGenerations = await this.dataSource.query(
      `SELECT * FROM ${genTable}
       WHERE "tenant_id" = $1
       ORDER BY "started_at" DESC
       LIMIT 10`,
      [tenantId],
    );

    return {
      projections: [
        {
          projectionName: 'sales_analytics',
          ...salesStatus,
        },
        {
          projectionName: 'inventory_analytics',
          ...invStatus,
        },
      ],
      recentRebuilds: recentGenerations.map((g: Record<string, unknown>) => ({
        id: g.id,
        projectionName: g.projection_name,
        generationId: g.generation_id,
        previousGenerationId: g.previous_generation_id,
        status: g.status,
        fromDate: g.from_date ? formatDateColumn(g.from_date) : null,
        toDate: g.to_date ? formatDateColumn(g.to_date) : null,
        ordersReplayed: Number(g.orders_replayed ?? 0),
        returnsReplayed: Number(g.returns_replayed ?? 0),
        triggeredBy: g.triggered_by,
        reason: g.reason,
        startedAt: g.started_at,
        completedAt: g.completed_at,
        errorMessage: g.error_message,
      })),
    };
  }

  async getRebuildById(id: string) {
    const tenantId = TenantContext.require();
    const genTable = qualifiedTable(this.dataSource, 'projection_generations');
    const rows = await this.dataSource.query(
      `SELECT * FROM ${genTable} WHERE "tenant_id" = $1 AND "id" = $2 LIMIT 1`,
      [tenantId, id],
    );
    const g = rows[0];
    if (!g) {
      throw new NotFoundException(`Projection rebuild ${id} not found`);
    }
    return {
      id: g.id,
      projectionName: g.projection_name,
      generationId: g.generation_id,
      previousGenerationId: g.previous_generation_id,
      status: g.status,
      fromDate: g.from_date ? formatDateColumn(g.from_date) : null,
      toDate: g.to_date ? formatDateColumn(g.to_date) : null,
      ordersReplayed: Number(g.orders_replayed ?? 0),
      returnsReplayed: Number(g.returns_replayed ?? 0),
      triggeredBy: g.triggered_by,
      reason: g.reason,
      startedAt: g.started_at,
      completedAt: g.completed_at,
      errorMessage: g.error_message,
    };
  }

  /**
   * Executes a deterministic generation-based shadow rebuild of analytical summary tables
   * from normalized fact tables (`sales_order_facts`, `sales_order_line_facts`, `sales_return_facts`),
   * then performs an atomic generation pointer cutover.
   */
  async triggerRebuild(input: TriggerRebuildInput) {
    const tenantId = TenantContext.require();
    const projectionName = input.projectionName ?? 'sales_analytics';
    const triggeredBy = input.triggeredBy ?? 'system-admin';
    const startedMs = Date.now();
    const rebuildId = randomUUID();
    const newGenerationId = `gen-${rebuildId.slice(0, 12)}`;

    const genTable = qualifiedTable(this.dataSource, 'projection_generations');
    const cpTable = qualifiedTable(this.dataSource, 'projection_checkpoints');

    const { activeGenerationId: previousGenerationId } =
      await this.projections.getActiveGenerations(
        this.dataSource.manager,
        tenantId,
        projectionName,
      );

    // Record BUILDING generation header first
    await this.dataSource.query(
      `INSERT INTO ${genTable} (
        "id", "tenant_id", "projection_name", "generation_id", "previous_generation_id",
        "status", "from_date", "to_date", "orders_replayed", "returns_replayed",
        "triggered_by", "reason", "started_at"
      ) VALUES ($1, $2, $3, $4, $5, 'BUILDING', $6, $7, 0, 0, $8, $9, now())`,
      [
        rebuildId,
        tenantId,
        projectionName,
        newGenerationId,
        previousGenerationId,
        input.fromDate ?? null,
        input.toDate ?? null,
        triggeredBy,
        input.reason ?? 'Manual projection rebuild',
      ],
    );

    try {
      const result = await this.dataSource.transaction(
        async (manager: EntityManager) => {
          const orderFactsTable = qualifiedTable(
            manager.connection,
            'sales_order_facts',
          );
          const lineFactsTable = qualifiedTable(
            manager.connection,
            'sales_order_line_facts',
          );
          const returnFactsTable = qualifiedTable(
            manager.connection,
            'sales_return_facts',
          );
          const dailyTable = qualifiedTable(
            manager.connection,
            'daily_sales_summaries',
          );
          const productTable = qualifiedTable(
            manager.connection,
            'product_sales_summaries',
          );
          const empTable = qualifiedTable(
            manager.connection,
            'employee_sales_summaries',
          );
          const channelTable = qualifiedTable(
            manager.connection,
            'channel_sales_summaries',
          );
          const cgTable = qualifiedTable(
            manager.connection,
            'customer_group_sales_summaries',
          );

          // If date range is scoped, copy outside-window summary rows from previousGenerationId into newGenerationId
          if (input.fromDate || input.toDate) {
            const copyRangeParams: unknown[] = [
              tenantId,
              previousGenerationId,
              newGenerationId,
            ];
            const dateClauses: string[] = [];
            if (input.fromDate) {
              copyRangeParams.push(input.fromDate);
              dateClauses.push(`"date_bucket" < $${copyRangeParams.length}`);
            }
            if (input.toDate) {
              copyRangeParams.push(input.toDate);
              dateClauses.push(`"date_bucket" > $${copyRangeParams.length}`);
            }
            const outsideFilter =
              dateClauses.length > 0
                ? ` AND (${dateClauses.join(' OR ')})`
                : '';

            if (outsideFilter) {
              await manager.query(
                `INSERT INTO ${dailyTable} (
                  "id", "tenant_id", "generation_id", "date_bucket", "branch_id",
                  "gmv", "gross_sales_revenue", "discount_total", "returns_amount", "net_sales_revenue",
                  "tax_total", "cogs_amount", "returned_cogs_amount", "net_cogs_amount", "gross_profit",
                  "order_count", "completed_order_count", "cancelled_order_count", "return_count",
                  "units_sold", "units_returned", "pending_cost_lines_count",
                  "cash_inflow_amount", "cash_outflow_amount", "debt_collected_amount", "projection_version", "updated_at"
                )
                SELECT
                  gen_random_uuid(), "tenant_id", $3, "date_bucket", "branch_id",
                  "gmv", "gross_sales_revenue", "discount_total", "returns_amount", "net_sales_revenue",
                  "tax_total", "cogs_amount", "returned_cogs_amount", "net_cogs_amount", "gross_profit",
                  "order_count", "completed_order_count", "cancelled_order_count", "return_count",
                  "units_sold", "units_returned", "pending_cost_lines_count",
                  "cash_inflow_amount", "cash_outflow_amount", "debt_collected_amount", "projection_version", now()
                FROM ${dailyTable}
                WHERE "tenant_id" = $1 AND "generation_id" = $2${outsideFilter}
                ON CONFLICT DO NOTHING`,
                copyRangeParams,
              );

              await manager.query(
                `INSERT INTO ${productTable} (
                  "id", "tenant_id", "generation_id", "date_bucket", "branch_id",
                  "variant_id", "product_id", "sku_code", "product_name", "category_id", "brand_id",
                  "units_sold", "units_returned", "gross_sales_revenue", "discount_total",
                  "returns_amount", "net_sales_revenue", "cogs_amount", "returned_cogs_amount",
                  "net_cogs_amount", "gross_profit", "order_count", "pending_cost_lines_count", "updated_at"
                )
                SELECT
                  gen_random_uuid(), "tenant_id", $3, "date_bucket", "branch_id",
                  "variant_id", "product_id", "sku_code", "product_name", "category_id", "brand_id",
                  "units_sold", "units_returned", "gross_sales_revenue", "discount_total",
                  "returns_amount", "net_sales_revenue", "cogs_amount", "returned_cogs_amount",
                  "net_cogs_amount", "gross_profit", "order_count", "pending_cost_lines_count", now()
                FROM ${productTable}
                WHERE "tenant_id" = $1 AND "generation_id" = $2${outsideFilter}
                ON CONFLICT DO NOTHING`,
                copyRangeParams,
              );

              await manager.query(
                `INSERT INTO ${empTable} (
                  "id", "tenant_id", "generation_id", "date_bucket", "branch_id", "employee_id",
                  "gross_sales_revenue", "discount_total", "returns_amount", "net_sales_revenue",
                  "gross_profit", "completed_order_count", "return_count", "units_sold", "updated_at"
                )
                SELECT
                  gen_random_uuid(), "tenant_id", $3, "date_bucket", "branch_id", "employee_id",
                  "gross_sales_revenue", "discount_total", "returns_amount", "net_sales_revenue",
                  "gross_profit", "completed_order_count", "return_count", "units_sold", now()
                FROM ${empTable}
                WHERE "tenant_id" = $1 AND "generation_id" = $2${outsideFilter}
                ON CONFLICT DO NOTHING`,
                copyRangeParams,
              );

              await manager.query(
                `INSERT INTO ${channelTable} (
                  "id", "tenant_id", "generation_id", "date_bucket", "branch_id", "channel_type",
                  "gmv", "gross_sales_revenue", "discount_total", "returns_amount", "net_sales_revenue",
                  "gross_profit", "order_count", "completed_order_count", "cancelled_order_count", "units_sold", "updated_at"
                )
                SELECT
                  gen_random_uuid(), "tenant_id", $3, "date_bucket", "branch_id", "channel_type",
                  "gmv", "gross_sales_revenue", "discount_total", "returns_amount", "net_sales_revenue",
                  "gross_profit", "order_count", "completed_order_count", "cancelled_order_count", "units_sold", now()
                FROM ${channelTable}
                WHERE "tenant_id" = $1 AND "generation_id" = $2${outsideFilter}
                ON CONFLICT DO NOTHING`,
                copyRangeParams,
              );

              await manager.query(
                `INSERT INTO ${cgTable} (
                  "id", "tenant_id", "generation_id", "date_bucket", "branch_id", "customer_group_id",
                  "gross_sales_revenue", "discount_total", "returns_amount", "net_sales_revenue",
                  "gross_profit", "completed_order_count", "units_sold", "loyalty_points_earned", "loyalty_points_redeemed", "updated_at"
                )
                SELECT
                  gen_random_uuid(), "tenant_id", $3, "date_bucket", "branch_id", "customer_group_id",
                  "gross_sales_revenue", "discount_total", "returns_amount", "net_sales_revenue",
                  "gross_profit", "completed_order_count", "units_sold", "loyalty_points_earned", "loyalty_points_redeemed", now()
                FROM ${cgTable}
                WHERE "tenant_id" = $1 AND "generation_id" = $2${outsideFilter}
                ON CONFLICT DO NOTHING`,
                copyRangeParams,
              );
            }
          }

          // Clear any pre-created rows inside the target rebuild window for newGenerationId
          // (in case dual-writes arrived before fact scan started)
          const windowParams: unknown[] = [tenantId, newGenerationId];
          let windowClause = '';
          if (input.fromDate) {
            windowParams.push(input.fromDate);
            windowClause += ` AND "date_bucket" >= $${windowParams.length}`;
          }
          if (input.toDate) {
            windowParams.push(input.toDate);
            windowClause += ` AND "date_bucket" <= $${windowParams.length}`;
          }
          for (const tbl of [
            dailyTable,
            productTable,
            empTable,
            channelTable,
            cgTable,
          ]) {
            await manager.query(
              `DELETE FROM ${tbl} WHERE "tenant_id" = $1 AND "generation_id" = $2${windowClause}`,
              windowParams,
            );
          }

          // Fetch all order facts within rebuild window
          const factParams: unknown[] = [tenantId];
          let factDateClause = '';
          if (input.fromDate) {
            factParams.push(input.fromDate);
            factDateClause += ` AND "date_bucket" >= $${factParams.length}`;
          }
          if (input.toDate) {
            factParams.push(input.toDate);
            factDateClause += ` AND "date_bucket" <= $${factParams.length}`;
          }

          const orderFacts = await manager.query(
            `SELECT * FROM ${orderFactsTable}
             WHERE "tenant_id" = $1${factDateClause}
             ORDER BY "date_bucket" ASC, "occurred_at" ASC`,
            factParams,
          );

          const lineFacts = await manager.query(
            `SELECT * FROM ${lineFactsTable}
             WHERE "tenant_id" = $1${factDateClause}
             ORDER BY "date_bucket" ASC, "order_id" ASC, "line_key" ASC`,
            factParams,
          );
          const linesByOrder = new Map<string, Record<string, unknown>[]>();
          for (const lf of lineFacts) {
            const oid = String(lf.order_id);
            const list = linesByOrder.get(oid) ?? [];
            list.push(lf);
            linesByOrder.set(oid, list);
          }

          for (const order of orderFacts) {
            const dateBucket = formatDateColumn(order.date_bucket);
            const status = String(order.order_status).toUpperCase();
            const orderLines = linesByOrder.get(String(order.order_id)) ?? [];

            let pendingLinesCount = 0;
            for (const line of orderLines) {
              if (
                status === 'COMPLETED' &&
                String(line.cost_status) === 'PENDING'
              ) {
                pendingLinesCount += 1;
              }
              if (status === 'COMPLETED') {
                const lineGross = String(line.line_subtotal);
                const lineDiscount = String(line.line_discount);
                const lineNet = String(line.line_net_revenue);
                const lineCogs = String(line.cogs_amount);
                const lineProfit = subDecimals(lineNet, lineCogs, 4);
                await this.projections.applyProductSummaryDelta(manager, {
                  tenantId,
                  generationId: newGenerationId,
                  dateBucket,
                  branchId: String(order.branch_id),
                  variantId: String(line.variant_id),
                  productId: (line.product_id as string) ?? null,
                  skuCode: String(line.sku_code),
                  productName: String(line.product_name),
                  categoryId: (line.category_id as string) ?? null,
                  brandId: (line.brand_id as string) ?? null,
                  unitsSoldDelta: String(line.quantity),
                  unitsReturnedDelta: '0.0000',
                  grossRevenueDelta: lineGross,
                  discountDelta: lineDiscount,
                  returnsAmountDelta: '0.0000',
                  netRevenueDelta: lineNet,
                  cogsDelta: lineCogs,
                  returnedCogsDelta: '0.0000',
                  grossProfitDelta: lineProfit,
                  orderCountDelta: 1,
                  pendingCostLinesDelta:
                    String(line.cost_status) === 'PENDING' ? 1 : 0,
                });
              }
            }

            const contribution = computeTargetOrderContribution({
              status,
              subtotal: String(order.subtotal),
              discountTotal: String(order.discount_total),
              cogsTotal: String(order.cogs_total),
              unitsTotal: String(order.units_total),
            });
            const grossProfitDelta = subDecimals(
              contribution.netRevenue,
              contribution.cogs,
              4,
            );

            await this.projections.applyOrderDeltaToSummaries(manager, {
              tenantId,
              generationId: newGenerationId,
              dateBucket,
              branchId: String(order.branch_id),
              channelType: String(order.channel_type),
              employeeId: String(order.seller_staff_id ?? 'UNASSIGNED'),
              customerGroupId: String(order.customer_group_id ?? 'WALK_IN'),
              delta: contribution,
              grossProfitDelta,
              pendingCostLinesDelta: pendingLinesCount,
            });
          }

          // Replay return facts within window
          const returnFacts = await manager.query(
            `SELECT * FROM ${returnFactsTable}
             WHERE "tenant_id" = $1${factDateClause}
             ORDER BY "date_bucket" ASC, "occurred_at" ASC`,
            factParams,
          );

          for (const ret of returnFacts) {
            const dateBucket = formatDateColumn(ret.date_bucket);
            const refundAmountStr = String(ret.refund_amount);
            const returnedUnitsStr = String(ret.returned_units);
            const returnedCogsStr = String(ret.returned_cogs_amount);
            const netRevenueDeltaStr = subDecimals('0', refundAmountStr, 4);
            const grossProfitDeltaStr = subDecimals(
              returnedCogsStr,
              refundAmountStr,
              4,
            );

            const orderLines = linesByOrder.get(String(ret.order_id)) ?? [];
            const orderLineBySku = new Map<string, Record<string, unknown>>();
            for (const ol of orderLines) {
              orderLineBySku.set(String(ol.sku_code), ol);
            }

            const retLines = Array.isArray(ret.return_lines)
              ? ret.return_lines
              : [];
            if (retLines.length > 0) {
              for (const rLine of retLines) {
                const skuCode = String(
                  rLine.skuCode ??
                    rLine.sku ??
                    rLine.variantId ??
                    'SKU-DEFAULT',
                );
                const origLine = orderLineBySku.get(skuCode);
                const qtyStr = formatScaledDecimal(
                  parseScaledDecimal(rLine.quantity ?? 1),
                  4,
                );
                const unitCostStr =
                  rLine.unitCost !== undefined
                    ? formatScaledDecimal(parseScaledDecimal(rLine.unitCost), 4)
                    : origLine
                      ? String(origLine.unit_cost_snapshot)
                      : '0.0000';
                const lineCogsStr = ret.restocked
                  ? formatScaledDecimal(
                      (parseScaledDecimal(qtyStr) *
                        parseScaledDecimal(unitCostStr)) /
                        10000n,
                      4,
                    )
                  : '0.0000';
                const lineRefundStr =
                  rLine.refundAmount !== undefined
                    ? formatScaledDecimal(
                        parseScaledDecimal(rLine.refundAmount),
                        4,
                      )
                    : refundAmountStr;

                await this.projections.applyProductSummaryDelta(manager, {
                  tenantId,
                  generationId: newGenerationId,
                  dateBucket,
                  branchId: String(ret.branch_id),
                  variantId: String(origLine?.variant_id ?? skuCode),
                  productId: (origLine?.product_id as string) ?? null,
                  skuCode,
                  productName: String(origLine?.product_name ?? skuCode),
                  categoryId: (origLine?.category_id as string) ?? null,
                  brandId: (origLine?.brand_id as string) ?? null,
                  unitsSoldDelta: '0.0000',
                  unitsReturnedDelta: qtyStr,
                  grossRevenueDelta: '0.0000',
                  discountDelta: '0.0000',
                  returnsAmountDelta: lineRefundStr,
                  netRevenueDelta: subDecimals('0', lineRefundStr, 4),
                  cogsDelta: '0.0000',
                  returnedCogsDelta: lineCogsStr,
                  grossProfitDelta: subDecimals(lineCogsStr, lineRefundStr, 4),
                  orderCountDelta: 0,
                  pendingCostLinesDelta: 0,
                });
              }
            } else if (orderLines.length === 1) {
              const origLine = orderLines[0];
              await this.projections.applyProductSummaryDelta(manager, {
                tenantId,
                generationId: newGenerationId,
                dateBucket,
                branchId: String(ret.branch_id),
                variantId: String(origLine.variant_id),
                productId: (origLine.product_id as string) ?? null,
                skuCode: String(origLine.sku_code),
                productName: String(origLine.product_name),
                categoryId: (origLine.category_id as string) ?? null,
                brandId: (origLine.brand_id as string) ?? null,
                unitsSoldDelta: '0.0000',
                unitsReturnedDelta: returnedUnitsStr,
                grossRevenueDelta: '0.0000',
                discountDelta: '0.0000',
                returnsAmountDelta: refundAmountStr,
                netRevenueDelta: netRevenueDeltaStr,
                cogsDelta: '0.0000',
                returnedCogsDelta: returnedCogsStr,
                grossProfitDelta: grossProfitDeltaStr,
                orderCountDelta: 0,
                pendingCostLinesDelta: 0,
              });
            }

            await this.projections.applyReturnDeltaToSummaries(manager, {
              tenantId,
              generationId: newGenerationId,
              dateBucket,
              branchId: String(ret.branch_id),
              channelType: String(ret.channel_type),
              employeeId: String(ret.seller_staff_id ?? 'UNASSIGNED'),
              customerGroupId: String(ret.customer_group_id ?? 'WALK_IN'),
              refundAmount: refundAmountStr,
              netRevenueDelta: netRevenueDeltaStr,
              returnedCogs: returnedCogsStr,
              grossProfitDelta: grossProfitDeltaStr,
              returnedUnits: returnedUnitsStr,
            });
          }

          if (input.simulateFailureAfterShadowBuild) {
            throw new Error(
              'Simulated mid-rebuild failure before generation cutover',
            );
          }

          // Atomic cutover: point projection_checkpoints.active_generation_id to newGenerationId
          await manager.query(
            `INSERT INTO ${cpTable} (
              "id", "tenant_id", "projection_name", "active_generation_id",
              "last_processed_at", "projection_version", "events_processed_count", "status", "updated_at"
            ) VALUES ($1, $2, $3, $4, now(), 1, $5, 'HEALTHY', now())
            ON CONFLICT ("tenant_id", "projection_name") DO UPDATE SET
              "active_generation_id" = EXCLUDED."active_generation_id",
              "last_processed_at" = now(),
              "projection_version" = ${cpTable}."projection_version" + 1,
              "status" = 'HEALTHY',
              "updated_at" = now()`,
            [
              randomUUID(),
              tenantId,
              projectionName,
              newGenerationId,
              orderFacts.length + returnFacts.length,
            ],
          );

          await manager.query(
            `UPDATE ${genTable}
             SET "status" = 'SUPERSEDED'
             WHERE "tenant_id" = $1 AND "projection_name" = $2 AND "generation_id" = $3 AND "id" <> $4`,
            [tenantId, projectionName, previousGenerationId, rebuildId],
          );

          await manager.query(
            `UPDATE ${genTable}
             SET "status" = 'ACTIVE',
                 "orders_replayed" = $1,
                 "returns_replayed" = $2,
                 "completed_at" = now()
             WHERE "id" = $3`,
            [orderFacts.length, returnFacts.length, rebuildId],
          );

          const durationMs = Date.now() - startedMs;
          await this.outbox.enqueue(manager, INSIGHT_PROJECTION_REBUILT, {
            tenantId,
            aggregateId: rebuildId,
            payload: {
              rebuildId,
              projectionName,
              previousGenerationId,
              newGenerationId,
              fromDate: input.fromDate ?? null,
              toDate: input.toDate ?? null,
              ordersProcessed: orderFacts.length,
              returnsProcessed: returnFacts.length,
              durationMs,
              triggeredBy,
              occurredAt: new Date().toISOString(),
            },
          });

          return {
            rebuildId,
            projectionName,
            previousGenerationId,
            newGenerationId,
            status: 'ACTIVE' as const,
            ordersReplayed: orderFacts.length,
            returnsReplayed: returnFacts.length,
            durationMs,
          };
        },
      );

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.dataSource.query(
        `UPDATE ${genTable}
         SET "status" = 'FAILED', "error_message" = $1, "completed_at" = now()
         WHERE "id" = $2`,
        [errorMessage, rebuildId],
      );
      throw err;
    }
  }
}
