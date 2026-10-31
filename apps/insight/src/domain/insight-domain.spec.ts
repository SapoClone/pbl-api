import {
  addDecimals,
  buildCsvBuffer,
  buildPdfReportBuffer,
  buildXlsxXmlBuffer,
  computeAov,
  computeAvailableQty,
  computeGrossProfit,
  computeGrowthMetric,
  computeInventoryValuation,
  computeNetSalesRevenue,
  computeOrderContributionDelta,
  computePreviousDateRange,
  computeProjectionFreshness,
  computeTargetOrderContribution,
  computeWeightedAverageCost,
  divDecimals,
  enumerateDateRange,
  formatScaledDecimal,
  isZeroContributionDelta,
  mulDecimals,
  parseScaledDecimal,
  sanitizeSpreadsheetCell,
  subDecimals,
  toReportingDateBucket,
} from './insight-domain';

describe('M7 Insight Pure Analytical Domain Engine', () => {
  describe('Scaled Decimal Math', () => {
    it('performs exact fixed-point addition, subtraction, multiplication, and division', () => {
      expect(addDecimals('199000.50', '500.25')).toBe('199500.75');
      expect(subDecimals('500000', '45000.50')).toBe('454999.50');
      expect(mulDecimals('125000.50', '3')).toBe('375001.50');
      expect(divDecimals('100000', '3', 2)).toBe('33333.33');
      expect(divDecimals('100000', '0', 2)).toBe('0.00');
      expect(formatScaledDecimal(parseScaledDecimal('-150.126'), 2)).toBe(
        '-150.13',
      );
    });
  });

  describe('Reporting Timezone & Date Range Rules', () => {
    it('buckets timestamps into Asia/Ho_Chi_Minh (UTC+07:00) accurately', () => {
      // 16:59 UTC is 23:59 in Vietnam (same day)
      expect(toReportingDateBucket('2026-10-18T16:59:59.000Z')).toBe(
        '2026-10-18',
      );
      // 17:00 UTC is 00:00 next day in Vietnam
      expect(toReportingDateBucket('2026-10-18T17:00:00.000Z')).toBe(
        '2026-10-19',
      );
    });

    it('computes previous comparison date range and enumerates date buckets', () => {
      const prev = computePreviousDateRange('2026-10-10', '2026-10-16');
      expect(prev).toEqual({
        prevFrom: '2026-10-03',
        prevTo: '2026-10-09',
        daysCount: 7,
      });
      expect(enumerateDateRange('2026-10-18', '2026-10-20')).toEqual([
        '2026-10-18',
        '2026-10-19',
        '2026-10-20',
      ]);
    });
  });

  describe('Order Contribution-Delta State Machine', () => {
    it('computes exact deltas across CREATED -> CONFIRMED -> COMPLETED -> CANCELLED', () => {
      const created = computeTargetOrderContribution({
        status: 'CREATED',
        subtotal: '500000',
        discountTotal: '50000',
        cogsTotal: '200000',
        unitsTotal: '2',
      });
      expect(created.orderCount).toBe(1);
      expect(created.gmv).toBe('0');
      expect(created.grossRevenue).toBe('0');

      const confirmed = computeTargetOrderContribution({
        status: 'CONFIRMED',
        subtotal: '500000',
        discountTotal: '50000',
        cogsTotal: '200000',
        unitsTotal: '2',
      });
      const deltaToConfirmed = computeOrderContributionDelta(
        confirmed,
        created,
      );
      expect(deltaToConfirmed.gmv).toBe('500000');
      expect(deltaToConfirmed.grossRevenue).toBe('0');
      expect(deltaToConfirmed.orderCount).toBe(0);

      const completed = computeTargetOrderContribution({
        status: 'COMPLETED',
        subtotal: '500000',
        discountTotal: '50000',
        cogsTotal: '200000',
        unitsTotal: '2',
      });
      const deltaToCompleted = computeOrderContributionDelta(
        completed,
        confirmed,
      );
      expect(deltaToCompleted.gmv).toBe('0');
      expect(deltaToCompleted.grossRevenue).toBe('500000');
      expect(deltaToCompleted.discount).toBe('50000');
      expect(deltaToCompleted.netRevenue).toBe('450000');
      expect(deltaToCompleted.cogs).toBe('200000');
      expect(deltaToCompleted.completedCount).toBe(1);

      // Duplicate event produces zero delta
      const duplicateDelta = computeOrderContributionDelta(
        completed,
        completed,
      );
      expect(isZeroContributionDelta(duplicateDelta)).toBe(true);

      // Cancellation after completion reverses GMV, gross revenue, discount, net revenue, COGS, and completed count
      const cancelled = computeTargetOrderContribution({
        status: 'CANCELLED',
        subtotal: '500000',
        discountTotal: '50000',
        cogsTotal: '200000',
        unitsTotal: '2',
      });
      const deltaToCancelled = computeOrderContributionDelta(
        cancelled,
        completed,
      );
      expect(deltaToCancelled.gmv).toBe('-500000');
      expect(deltaToCancelled.grossRevenue).toBe('-500000');
      expect(deltaToCancelled.netRevenue).toBe('-450000');
      expect(deltaToCancelled.cogs).toBe('-200000');
      expect(deltaToCancelled.completedCount).toBe(-1);
      expect(deltaToCancelled.cancelledCount).toBe(1);
    });
  });

  describe('Sales, Profitability, AOV, and Growth Metrics', () => {
    it('calculates net sales revenue, gross profit, margin %, AOV, and zero-safe growth', () => {
      const netRev = computeNetSalesRevenue('1000000', '100000', '50000');
      expect(netRev).toBe('850000.00');

      const profit = computeGrossProfit(netRev, '400000', '25000');
      expect(profit).toEqual({
        netCogs: '375000.00',
        grossProfit: '475000.00',
        grossMarginPct: '55.88',
      });

      expect(computeAov('850000', 4)).toBe(212500);
      expect(computeAov('850000', 0)).toBe(0);

      // Growth when previous period is 0 returns growthPct: null without division-by-zero
      const zeroPrevGrowth = computeGrowthMetric('500000', '0');
      expect(zeroPrevGrowth).toEqual({
        current: 500000,
        previous: 0,
        delta: 500000,
        growthPct: null,
        direction: 'UP',
      });

      const normalGrowth = computeGrowthMetric('600000', '400000');
      expect(normalGrowth).toEqual({
        current: 600000,
        previous: 400000,
        delta: 200000,
        growthPct: 50,
        direction: 'UP',
      });
    });
  });

  describe('Inventory Valuation, Weighted-Average Cost, and Freshness', () => {
    it('computes available stock, valuation, and weighted-average cost accurately', () => {
      expect(computeAvailableQty('10', '3', 2)).toBe('7.00');
      expect(computeAvailableQty('2', '5', 2)).toBe('0.00');
      expect(computeInventoryValuation('10', '45000')).toBe('450000');
      expect(computeInventoryValuation('1.5', '10001')).toBe('15002');
      expect(computeWeightedAverageCost('10', '40000', '10', '60000', 2)).toBe(
        '50000.00',
      );
    });

    it('detects stale projections when lag exceeds threshold', () => {
      const now = new Date('2026-10-30T12:10:00.000Z');
      const fresh = computeProjectionFreshness({
        lastProcessedAt: '2026-10-30T12:08:00.000Z',
        projectionVersion: 42,
        now,
        staleThresholdSeconds: 300,
      });
      expect(fresh.isStale).toBe(false);
      expect(fresh.lagSeconds).toBe(120);

      const stale = computeProjectionFreshness({
        lastProcessedAt: '2026-10-30T12:00:00.000Z',
        projectionVersion: 42,
        now,
        staleThresholdSeconds: 300,
      });
      expect(stale.isStale).toBe(true);
      expect(stale.lagSeconds).toBe(600);
    });
  });

  describe('Spreadsheet Formula-Injection Guard & Export Builders (Test S)', () => {
    it('neutralizes malicious formula prefixes while preserving signed numbers', () => {
      expect(sanitizeSpreadsheetCell("=cmd|' /C calc'!A0")).toBe(
        "'=cmd|' /C calc'!A0",
      );
      expect(sanitizeSpreadsheetCell('+SUM(A1:A10)')).toBe("'+SUM(A1:A10)");
      expect(sanitizeSpreadsheetCell('-1+1')).toBe("'-1+1");
      expect(sanitizeSpreadsheetCell('@HYPERLINK("http://evil")')).toBe(
        '\'@HYPERLINK("http://evil")',
      );
      // Legitimate negative currency/quantity values remain unquoted numbers
      expect(sanitizeSpreadsheetCell('-150000.00')).toBe('-150000.00');
      expect(sanitizeSpreadsheetCell('250000.00')).toBe('250000.00');
    });

    it('builds valid CSV, XLSX, and PDF buffers with sanitized cells', () => {
      const headers = ['SkuCode', 'ProductName', 'NetSalesRevenue'];
      const rows = [['SKU-001', '=1+1', '250000.00']];

      const csv = buildCsvBuffer(headers, rows).toString('utf8');
      expect(csv).toContain("SKU-001,'=1+1,250000.00");

      const xlsx = buildXlsxXmlBuffer('Sales', headers, rows).toString('utf8');
      expect(xlsx).toContain('<Workbook');
      expect(xlsx).toContain('&apos;=1+1');

      const pdf = buildPdfReportBuffer(
        'Sales Report',
        { Period: '2026-10-18' },
        headers,
        rows,
      ).toString('utf8');
      expect(pdf.startsWith('%PDF-1.4')).toBe(true);
      expect(pdf).toContain("'=1+1");
    });
  });
});
