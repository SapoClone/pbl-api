import { Injectable } from '@nestjs/common';
import { BranchScope } from '../common/branch-scope';
import { InsightQueryService } from '../insight-query.service';
import { ExportReqDto } from '../insight.dto';
import { addDays, ReportsService } from './reports.service';

export const EXPORT_ROW_LIMIT = 10_000;

/** One CSV cell; a text starting with = + - @ is prefixed so a spreadsheet never runs it as a formula */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return (
    [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') +
    '\r\n'
  );
}

/** Synchronous CSV of a report, at most 10,000 rows */
@Injectable()
export class ReportExportService {
  constructor(
    private readonly queries: InsightQueryService,
    private readonly reports: ReportsService,
  ) {}

  async export(
    query: ExportReqDto,
    scope: BranchScope = null,
  ): Promise<{ filename: string; csv: string }> {
    const to = query.to ?? this.reports.clock().toISOString().slice(0, 10);
    const from = query.from ?? addDays(to, -6);
    const range = { from, to, branchId: query.branchId };
    const filename = `${query.report}-${from}-${to}.csv`;

    if (query.report === 'daily') {
      const { data } = await this.queries.dailySales(range, scope);
      return {
        filename,
        csv: toCsv(
          [
            'date',
            'branchId',
            'orderCount',
            'revenue',
            'costAmount',
            'grossProfit',
          ],
          data
            .slice(0, EXPORT_ROW_LIMIT)
            .map((r) => [
              r.date,
              r.branchId,
              r.orderCount,
              r.revenue,
              r.costAmount,
              r.grossProfit,
            ]),
        ),
      };
    }
    if (query.report === 'by_channel') {
      const { data } = await this.reports.byChannel(range, scope);
      return {
        filename,
        csv: toCsv(
          ['channel', 'name', 'orderCount', 'revenue', 'share'],
          data
            .slice(0, EXPORT_ROW_LIMIT)
            .map((r) => [r.type, r.name, r.orderCount, r.revenue, r.share]),
        ),
      };
    }
    const { data } = await this.reports.topProducts(
      { ...range, limit: EXPORT_ROW_LIMIT },
      scope,
    );
    return {
      filename,
      csv: toCsv(
        ['sku', 'productName', 'quantity', 'revenue'],
        data.map((r) => [r.sku, r.productName, r.quantity, r.revenue]),
      ),
    };
  }
}
