import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { INSIGHT_EXPORT_COMPLETED } from '@pbl/contracts';
import { EventOutbox, qualifiedTable } from '@pbl/events';
import { createHash, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  buildCsvBuffer,
  buildPdfReportBuffer,
  buildXlsxXmlBuffer,
  toReportingDateBucket,
} from '../../domain/insight-domain';
import { ProjectionsService } from '../projections/projections.service';
import { InsightReportingService } from '../reporting/insight-reporting.service';

export interface CreateExportJobInput {
  reportType:
    | 'SALES_SUMMARY'
    | 'PRODUCT_SALES'
    | 'GROSS_PROFIT'
    | 'INVENTORY_VALUATION'
    | 'BRANCH_COMPARISON';
  format: 'CSV' | 'XLSX' | 'PDF';
  from?: string;
  to?: string;
  branchId?: string;
  categoryId?: string;
  warehouseId?: string;
  allowedBranchIds?: string[];
  requestedBy?: string;
}

@Injectable()
export class InsightExportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reporting: InsightReportingService,
    private readonly projections: ProjectionsService,
    private readonly outbox: EventOutbox,
  ) {}

  async createExportJob(input: CreateExportJobInput) {
    const tenantId = TenantContext.require();
    const format = (input.format || 'CSV').toUpperCase() as
      | 'CSV'
      | 'XLSX'
      | 'PDF';
    if (!['CSV', 'XLSX', 'PDF'].includes(format)) {
      throw new BadRequestException(`Unsupported export format: ${format}`);
    }
    const reportType = (input.reportType || 'SALES_SUMMARY').toUpperCase();
    const requestedBy = input.requestedBy ?? 'user';
    const today = toReportingDateBucket(new Date());
    const fromDate = input.from ?? today;
    const toDate = input.to ?? today;

    const freshness = await this.projections.getFreshness(
      tenantId,
      'sales_analytics',
    );
    const jobId = randomUUID();
    const exportTable = qualifiedTable(this.dataSource, 'report_export_jobs');

    const filters = {
      from: fromDate,
      to: toDate,
      branchId: input.branchId ?? null,
      categoryId: input.categoryId ?? null,
      warehouseId: input.warehouseId ?? null,
    };

    // Build report rows from consistent projection snapshot
    let headers: string[] = [];
    let rows: unknown[][] = [];

    if (reportType === 'SALES_SUMMARY') {
      const report = await this.reporting.getSalesReport({
        from: fromDate,
        to: toDate,
        branchId: input.branchId,
        allowedBranchIds: input.allowedBranchIds,
        page: 1,
        limit: 5000,
      });
      headers = [
        'Date',
        'BranchId',
        'GMV',
        'GrossSalesRevenue',
        'DiscountTotal',
        'ReturnsAmount',
        'NetSalesRevenue',
        'NetCOGS',
        'GrossProfit',
        'GrossMarginPct',
        'CompletedOrders',
        'CancelledOrders',
        'UnitsSold',
        'AOV',
      ];
      rows = report.data.map((r) => [
        r.date,
        r.branchId,
        r.gmv,
        r.grossSalesRevenue,
        r.discountTotal,
        r.returnsAmount,
        r.netSalesRevenue,
        r.netCogsAmount,
        r.grossProfit,
        r.grossMarginPct,
        r.completedOrderCount,
        r.cancelledOrderCount,
        r.unitsSold,
        r.aov,
      ]);
    } else if (
      reportType === 'PRODUCT_SALES' ||
      reportType === 'GROSS_PROFIT'
    ) {
      const report = await this.reporting.getSalesByProduct({
        from: fromDate,
        to: toDate,
        branchId: input.branchId,
        categoryId: input.categoryId,
        allowedBranchIds: input.allowedBranchIds,
        page: 1,
        limit: 5000,
      });
      headers = [
        'SkuCode',
        'ProductName',
        'CategoryId',
        'UnitsSold',
        'UnitsReturned',
        'GrossSalesRevenue',
        'DiscountTotal',
        'ReturnsAmount',
        'NetSalesRevenue',
        'NetCOGS',
        'GrossProfit',
        'GrossMarginPct',
        'OrderCount',
      ];
      rows = report.data.map((r) => [
        r.skuCode,
        r.productName,
        r.categoryId ?? '',
        r.unitsSold,
        r.unitsReturned,
        r.grossSalesRevenue,
        r.discountTotal,
        r.returnsAmount,
        r.netSalesRevenue,
        r.netCogsAmount,
        r.grossProfit,
        r.grossMarginPct,
        r.orderCount,
      ]);
    } else if (reportType === 'INVENTORY_VALUATION') {
      const report = await this.reporting.getInventorySummary({
        warehouseId: input.warehouseId,
        branchId: input.branchId,
        categoryId: input.categoryId,
        allowedBranchIds: input.allowedBranchIds,
        page: 1,
        limit: 5000,
      });
      headers = [
        'WarehouseId',
        'BranchId',
        'SkuCode',
        'ProductName',
        'OnHandQty',
        'ReservedQty',
        'AvailableQty',
        'InTransitQty',
        'AvgUnitCost',
        'InventoryValuation',
        'InTransitValuation',
        'IsLowStock',
      ];
      rows = report.data.map((r) => [
        r.warehouseId,
        r.branchId ?? '',
        r.skuCode,
        r.productName,
        r.onHandQty,
        r.reservedQty,
        r.availableQty,
        r.inTransitQty,
        r.avgUnitCost,
        r.inventoryValuation,
        r.inTransitValuation,
        r.isLowStock ? 'TRUE' : 'FALSE',
      ]);
    } else if (reportType === 'BRANCH_COMPARISON') {
      const report = await this.reporting.getBranchComparison({
        from: fromDate,
        to: toDate,
        branchId: input.branchId,
        allowedBranchIds: input.allowedBranchIds,
      });
      headers = [
        'Rank',
        'BranchId',
        'NetSalesRevenue',
        'GrossProfit',
        'GrossMarginPct',
        'CompletedOrderCount',
        'AOV',
        'RevenueSharePct',
      ];
      rows = report.branches.map((b) => [
        b.rank,
        b.branchId,
        b.netSalesRevenue,
        b.grossProfit,
        b.grossMarginPct,
        b.completedOrderCount,
        b.aov,
        b.revenueSharePct,
      ]);
    } else {
      throw new BadRequestException(`Unsupported reportType: ${reportType}`);
    }

    let buffer: Buffer;
    let contentType: string;
    let extension: string;

    if (format === 'CSV') {
      buffer = buildCsvBuffer(headers, rows);
      contentType = 'text/csv; charset=utf-8';
      extension = 'csv';
    } else if (format === 'XLSX') {
      buffer = buildXlsxXmlBuffer(reportType, headers, rows);
      contentType =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      extension = 'xlsx';
    } else {
      buffer = buildPdfReportBuffer(
        `SapoClone Analytics Report - ${reportType}`,
        {
          Period: `${fromDate} to ${toDate}`,
          SnapshotAsOf: freshness.asOf,
          Generation: freshness.activeGenerationId,
        },
        headers,
        rows,
      );
      contentType = 'application/pdf';
      extension = 'pdf';
    }

    const fileName = `${reportType.toLowerCase()}_${fromDate}_${toDate}.${extension}`;
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO ${exportTable} (
          "id", "tenant_id", "report_type", "format", "status", "filters",
          "allowed_branch_ids", "snapshot_generation_id", "snapshot_version", "snapshot_as_of",
          "row_count", "byte_size", "content_type", "file_name", "file_content_base64",
          "checksum_sha256", "requested_by", "created_at", "completed_at", "expires_at"
        ) VALUES (
          $1, $2, $3, $4, 'COMPLETED', $5::jsonb,
          $6::jsonb, $7, $8, $9,
          $10, $11, $12, $13, $14,
          $15, $16, now(), now(), $17
        )`,
        [
          jobId,
          tenantId,
          reportType,
          format,
          JSON.stringify(filters),
          input.allowedBranchIds
            ? JSON.stringify(input.allowedBranchIds)
            : null,
          freshness.activeGenerationId,
          freshness.projectionVersion,
          new Date(freshness.asOf),
          rows.length,
          buffer.byteLength,
          contentType,
          fileName,
          buffer.toString('base64'),
          checksum,
          requestedBy,
          expiresAt,
        ],
      );

      await this.outbox.enqueue(manager, INSIGHT_EXPORT_COMPLETED, {
        tenantId,
        aggregateId: jobId,
        payload: {
          jobId,
          reportType,
          format,
          status: 'COMPLETED',
          rowCount: rows.length,
          byteSize: buffer.byteLength,
          requestedBy,
          occurredAt: new Date().toISOString(),
        },
      });
    });

    return {
      id: jobId,
      reportType,
      format,
      status: 'COMPLETED',
      filters,
      snapshotGenerationId: freshness.activeGenerationId,
      snapshotVersion: freshness.projectionVersion,
      snapshotAsOf: freshness.asOf,
      rowCount: rows.length,
      byteSize: buffer.byteLength,
      contentType,
      fileName,
      checksumSha256: checksum,
      downloadUrl: `/api/v1/insight/export-jobs/${jobId}/download`,
    };
  }

  async listExportJobs(allowedBranchIds?: string[]) {
    const tenantId = TenantContext.require();
    const exportTable = qualifiedTable(this.dataSource, 'report_export_jobs');
    const rows = await this.dataSource.query(
      `SELECT
        "id", "report_type", "format", "status", "filters", "allowed_branch_ids",
        "snapshot_generation_id", "snapshot_version", "snapshot_as_of",
        "row_count", "byte_size", "content_type", "file_name", "checksum_sha256",
        "requested_by", "created_at", "completed_at", "expires_at"
       FROM ${exportTable}
       WHERE "tenant_id" = $1
       ORDER BY "created_at" DESC
       LIMIT 50`,
      [tenantId],
    );

    const filtered = rows.filter((r: Record<string, unknown>) =>
      this.canAccessExportJob(r, allowedBranchIds),
    );

    return {
      data: filtered.map((r: Record<string, unknown>) => this.mapJobRow(r)),
    };
  }

  async getExportJob(jobId: string, allowedBranchIds?: string[]) {
    const tenantId = TenantContext.require();
    const exportTable = qualifiedTable(this.dataSource, 'report_export_jobs');
    const rows = await this.dataSource.query(
      `SELECT
        "id", "report_type", "format", "status", "filters", "allowed_branch_ids",
        "snapshot_generation_id", "snapshot_version", "snapshot_as_of",
        "row_count", "byte_size", "content_type", "file_name", "checksum_sha256",
        "requested_by", "created_at", "completed_at", "expires_at"
       FROM ${exportTable}
       WHERE "tenant_id" = $1 AND "id" = $2
       LIMIT 1`,
      [tenantId, jobId],
    );
    const job = rows[0];
    if (!job) {
      throw new NotFoundException(`Export job ${jobId} not found`);
    }
    if (!this.canAccessExportJob(job, allowedBranchIds)) {
      throw new ForbiddenException(
        'Access denied to export job outside your branch scope',
      );
    }
    return this.mapJobRow(job);
  }

  async downloadExportJob(
    jobId: string,
    allowedBranchIds?: string[],
  ): Promise<{
    fileName: string;
    contentType: string;
    checksumSha256: string | null;
    buffer: Buffer;
  }> {
    const tenantId = TenantContext.require();
    const exportTable = qualifiedTable(this.dataSource, 'report_export_jobs');
    const rows = await this.dataSource.query(
      `SELECT * FROM ${exportTable}
       WHERE "tenant_id" = $1 AND "id" = $2
       LIMIT 1`,
      [tenantId, jobId],
    );
    const job = rows[0];
    if (!job) {
      throw new NotFoundException(`Export job ${jobId} not found`);
    }
    if (!this.canAccessExportJob(job, allowedBranchIds)) {
      throw new ForbiddenException(
        'Access denied to download export job outside your branch scope',
      );
    }
    const base64 = String(job.file_content_base64 ?? '');
    return {
      fileName: String(job.file_name),
      contentType: String(job.content_type),
      checksumSha256: (job.checksum_sha256 as string) ?? null,
      buffer: Buffer.from(base64, 'base64'),
    };
  }

  private canAccessExportJob(
    jobRow: Record<string, unknown>,
    allowedBranchIds?: string[],
  ): boolean {
    if (!allowedBranchIds || allowedBranchIds.length === 0) {
      return true;
    }
    const filters = (jobRow.filters ?? {}) as Record<string, unknown>;
    const jobBranchId = filters.branchId as string | null | undefined;
    if (jobBranchId && !allowedBranchIds.includes(jobBranchId)) {
      return false;
    }
    const jobAllowedBranches = jobRow.allowed_branch_ids as
      | string[]
      | null
      | undefined;
    if (!jobBranchId && !jobAllowedBranches) {
      // Unscoped tenant-wide export cannot be accessed by a branch-restricted user
      return false;
    }
    if (Array.isArray(jobAllowedBranches)) {
      return jobAllowedBranches.every((b) => allowedBranchIds.includes(b));
    }
    return true;
  }

  private mapJobRow(r: Record<string, unknown>) {
    return {
      id: r.id,
      reportType: r.report_type,
      format: r.format,
      status: r.status,
      filters: r.filters,
      snapshotGenerationId: r.snapshot_generation_id,
      snapshotVersion: Number(r.snapshot_version ?? 1),
      snapshotAsOf: r.snapshot_as_of,
      rowCount: Number(r.row_count ?? 0),
      byteSize: Number(r.byte_size ?? 0),
      contentType: r.content_type,
      fileName: r.file_name,
      checksumSha256: r.checksum_sha256,
      requestedBy: r.requested_by,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      expiresAt: r.expires_at,
      downloadUrl: `/api/v1/insight/export-jobs/${r.id}/download`,
    };
  }
}
