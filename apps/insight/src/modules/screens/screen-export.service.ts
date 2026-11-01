import { Injectable } from '@nestjs/common';
import { BranchScope } from '../../common/branch-scope';
import { addDays } from '../../common/store-time';
import { buildCsvBuffer } from '../../domain/insight-domain';
import { ExportReqDto } from '../../insight.dto';
import { ScreenReportsService } from './screen-reports.service';

export const EXPORT_ROW_LIMIT = 10_000;

/** Synchronous CSV of a screen report, at most 10,000 rows (UTF-8, CRLF, formula-safe cells) */
@Injectable()
export class ScreenExportService {
  constructor(private readonly reports: ScreenReportsService) {}

  async export(
    query: ExportReqDto,
    scope: BranchScope = null,
  ): Promise<{ filename: string; csv: string }> {
    const to = query.to ?? this.reports.clock().toISOString().slice(0, 10);
    const from = query.from ?? addDays(to, -6);
    const range = { from, to, branchId: query.branchId };
    const filename = `${query.report}-${from}-${to}.csv`;
    const csv = (headers: string[], rows: unknown[][]) => ({
      filename,
      csv: buildCsvBuffer(headers, rows.slice(0, EXPORT_ROW_LIMIT)).toString(
        'utf8',
      ),
    });

    if (query.report === 'daily') {
      const { data } = await this.reports.dailySales(range, scope);
      return csv(
        [
          'date',
          'branchId',
          'orderCount',
          'revenue',
          'costAmount',
          'grossProfit',
        ],
        data.map((r) => [
          r.date,
          r.branchId,
          r.orderCount,
          r.revenue,
          r.costAmount,
          r.grossProfit,
        ]),
      );
    }
    if (query.report === 'by_channel') {
      const { data } = await this.reports.byChannel(range, scope);
      return csv(
        ['channel', 'name', 'orderCount', 'revenue', 'share'],
        data.map((r) => [r.type, r.name, r.orderCount, r.revenue, r.share]),
      );
    }
    const { data } = await this.reports.topProducts(
      { ...range, limit: EXPORT_ROW_LIMIT },
      scope,
    );
    return csv(
      ['sku', 'productName', 'quantity', 'revenue'],
      data.map((r) => [r.sku, r.productName, r.quantity, r.revenue]),
    );
  }
}
