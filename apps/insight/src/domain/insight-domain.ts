/**
 * Pure Analytical & Reporting Domain Engine (Milestone M7 — ADR-0021).
 * Zero framework/infrastructure dependencies. All currency and quantity
 * calculations use exact scaled integer arithmetic (SCALE = 10_000n, i.e. 4 decimal places).
 */

export const DECIMAL_SCALE = 10000n;
export const DEFAULT_REPORTING_TZ_OFFSET_MINUTES = 7 * 60; // Asia/Ho_Chi_Minh (UTC+07:00)
export const DEFAULT_STALE_THRESHOLD_SECONDS = 300; // 5 minutes

export interface OrderContributionVector {
  gmv: string;
  grossRevenue: string;
  discount: string;
  netRevenue: string;
  cogs: string;
  unitsSold: string;
  orderCount: number;
  completedCount: number;
  cancelledCount: number;
}

export interface GrowthMetricResult {
  current: string;
  previous: string;
  delta: string;
  growthPct: string | null;
  direction: 'UP' | 'DOWN' | 'FLAT';
}

export interface ProjectionFreshnessMetadata {
  asOf: string;
  lastProcessedAt: string | null;
  projectionVersion: number;
  lagSeconds: number;
  isStale: boolean;
}

export function parseScaledDecimal(
  value: string | number | bigint | null | undefined,
): bigint {
  if (value === null || value === undefined || value === '') {
    return 0n;
  }
  if (typeof value === 'bigint') {
    return value * DECIMAL_SCALE;
  }
  const raw = String(value).trim();
  if (!raw || raw === 'NaN') {
    return 0n;
  }
  const negative = raw.startsWith('-');
  const normalized =
    negative || raw.startsWith('+') ? raw.slice(1).trim() : raw;
  const [intPartRaw = '0', fracPartRaw = ''] = normalized.split('.');
  const cleanInt = intPartRaw.replace(/[^0-9]/g, '') || '0';
  const cleanFrac = fracPartRaw.replace(/[^0-9]/g, '');
  const paddedFrac = (cleanFrac + '00000').slice(0, 5);
  const mainDigits = paddedFrac.slice(0, 4);
  const fifthDigit = Number(paddedFrac[4] ?? '0');

  let scaled = BigInt(cleanInt) * DECIMAL_SCALE + BigInt(mainDigits || '0');
  if (fifthDigit >= 5) {
    scaled += 1n;
  }
  return negative ? -scaled : scaled;
}

export function formatScaledDecimal(scaled: bigint, decimals = 2): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;

  if (decimals === 0) {
    const rounded = (abs + DECIMAL_SCALE / 2n) / DECIMAL_SCALE;
    return `${negative && rounded > 0n ? '-' : ''}${rounded.toString()}`;
  }

  const factor = 10n ** BigInt(4 - decimals);
  const rounded = (abs + factor / 2n) / factor;
  const targetScale = 10n ** BigInt(decimals);
  const intPart = rounded / targetScale;
  const fracPart = rounded % targetScale;
  const sign = negative && (intPart > 0n || fracPart > 0n) ? '-' : '';
  return `${sign}${intPart.toString()}.${fracPart.toString().padStart(decimals, '0')}`;
}

export function addDecimals(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  decimals = 2,
): string {
  return formatScaledDecimal(
    parseScaledDecimal(a) + parseScaledDecimal(b),
    decimals,
  );
}

export function subDecimals(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  decimals = 2,
): string {
  return formatScaledDecimal(
    parseScaledDecimal(a) - parseScaledDecimal(b),
    decimals,
  );
}

export function mulDecimals(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  decimals = 2,
): string {
  const prod = parseScaledDecimal(a) * parseScaledDecimal(b);
  const half = DECIMAL_SCALE / 2n;
  const scaled =
    prod >= 0n
      ? (prod + half) / DECIMAL_SCALE
      : -((-prod + half) / DECIMAL_SCALE);
  return formatScaledDecimal(scaled, decimals);
}

export function divDecimals(
  numerator: string | number | null | undefined,
  denominator: string | number | null | undefined,
  decimals = 2,
): string {
  const num = parseScaledDecimal(numerator);
  const den = parseScaledDecimal(denominator);
  if (den === 0n) {
    return formatScaledDecimal(0n, decimals);
  }
  const scaledNum = num * DECIMAL_SCALE;
  const absDen = den < 0n ? -den : den;
  const half = absDen / 2n;
  const sameSign = (num >= 0n && den > 0n) || (num < 0n && den < 0n);
  const absNum = scaledNum < 0n ? -scaledNum : scaledNum;
  const quotient = (absNum + half) / absDen;
  return formatScaledDecimal(sameSign ? quotient : -quotient, decimals);
}

/**
 * Converts a UTC timestamp into YYYY-MM-DD in the store's reporting timezone
 * (defaults to Asia/Ho_Chi_Minh, UTC+07:00).
 */
export function toReportingDateBucket(
  instant: string | Date,
  utcOffsetMinutes: number = DEFAULT_REPORTING_TZ_OFFSET_MINUTES,
): string {
  const ms =
    typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  if (Number.isNaN(ms)) {
    throw new Error(
      `Invalid timestamp for reporting date bucket: ${String(instant)}`,
    );
  }
  const shifted = new Date(ms + utcOffsetMinutes * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Formats a PostgreSQL DATE column value (which node-postgres parses as a local Date at 00:00:00
 * or returns as a YYYY-MM-DD string) into an exact YYYY-MM-DD string without UTC-shift drift.
 */
export function formatDateColumn(val: unknown): string {
  if (!val) {
    return '';
  }
  if (typeof val === 'string') {
    return val.slice(0, 10);
  }
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

export function computePreviousDateRange(
  fromDate: string,
  toDate: string,
): { prevFrom: string; prevTo: string; daysCount: number } {
  const startMs = Date.parse(`${fromDate}T00:00:00.000Z`);
  const endMs = Date.parse(`${toDate}T00:00:00.000Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  const daysCount = Math.max(1, Math.round((endMs - startMs) / dayMs) + 1);
  const prevEndMs = startMs - dayMs;
  const prevStartMs = prevEndMs - (daysCount - 1) * dayMs;
  return {
    prevFrom: new Date(prevStartMs).toISOString().slice(0, 10),
    prevTo: new Date(prevEndMs).toISOString().slice(0, 10),
    daysCount,
  };
}

export function enumerateDateRange(fromDate: string, toDate: string): string[] {
  const startMs = Date.parse(`${fromDate}T00:00:00.000Z`);
  const endMs = Date.parse(`${toDate}T00:00:00.000Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  const dates: string[] = [];
  for (let cur = startMs; cur <= endMs; cur += dayMs) {
    dates.push(new Date(cur).toISOString().slice(0, 10));
  }
  return dates;
}

export function computeTargetOrderContribution(input: {
  status: string;
  subtotal: string | number;
  discountTotal?: string | number;
  cogsTotal?: string | number;
  unitsTotal?: string | number;
}): OrderContributionVector {
  const status = (input.status || '').toUpperCase();
  const subtotalScaled = parseScaledDecimal(input.subtotal);
  const discountScaled = parseScaledDecimal(input.discountTotal ?? 0);
  const netScaled = subtotalScaled - discountScaled;
  const cogsScaled = parseScaledDecimal(input.cogsTotal ?? 0);
  const unitsScaled = parseScaledDecimal(input.unitsTotal ?? 0);

  if (status === 'COMPLETED') {
    return {
      gmv: formatScaledDecimal(subtotalScaled, 4),
      grossRevenue: formatScaledDecimal(subtotalScaled, 4),
      discount: formatScaledDecimal(discountScaled, 4),
      netRevenue: formatScaledDecimal(netScaled, 4),
      cogs: formatScaledDecimal(cogsScaled, 4),
      unitsSold: formatScaledDecimal(unitsScaled, 4),
      orderCount: 1,
      completedCount: 1,
      cancelledCount: 0,
    };
  }

  if (status === 'CONFIRMED') {
    return {
      gmv: formatScaledDecimal(subtotalScaled, 4),
      grossRevenue: formatScaledDecimal(0n, 4),
      discount: formatScaledDecimal(0n, 4),
      netRevenue: formatScaledDecimal(0n, 4),
      cogs: formatScaledDecimal(0n, 4),
      unitsSold: formatScaledDecimal(0n, 4),
      orderCount: 1,
      completedCount: 0,
      cancelledCount: 0,
    };
  }

  if (status === 'CANCELLED') {
    return {
      gmv: formatScaledDecimal(0n, 4),
      grossRevenue: formatScaledDecimal(0n, 4),
      discount: formatScaledDecimal(0n, 4),
      netRevenue: formatScaledDecimal(0n, 4),
      cogs: formatScaledDecimal(0n, 4),
      unitsSold: formatScaledDecimal(0n, 4),
      orderCount: 1,
      completedCount: 0,
      cancelledCount: 1,
    };
  }

  // CREATED / DRAFT / PENDING
  return {
    gmv: formatScaledDecimal(0n, 4),
    grossRevenue: formatScaledDecimal(0n, 4),
    discount: formatScaledDecimal(0n, 4),
    netRevenue: formatScaledDecimal(0n, 4),
    cogs: formatScaledDecimal(0n, 4),
    unitsSold: formatScaledDecimal(0n, 4),
    orderCount: 1,
    completedCount: 0,
    cancelledCount: 0,
  };
}

export function computeOrderContributionDelta(
  target: OrderContributionVector,
  previous?: Partial<OrderContributionVector> | null,
): OrderContributionVector {
  const prevGmv = parseScaledDecimal(previous?.gmv ?? 0);
  const prevGross = parseScaledDecimal(previous?.grossRevenue ?? 0);
  const prevDiscount = parseScaledDecimal(previous?.discount ?? 0);
  const prevNet = parseScaledDecimal(previous?.netRevenue ?? 0);
  const prevCogs = parseScaledDecimal(previous?.cogs ?? 0);
  const prevUnits = parseScaledDecimal(previous?.unitsSold ?? 0);
  const prevOrderCount = previous?.orderCount ?? 0;
  const prevCompletedCount = previous?.completedCount ?? 0;
  const prevCancelledCount = previous?.cancelledCount ?? 0;

  return {
    gmv: formatScaledDecimal(parseScaledDecimal(target.gmv) - prevGmv, 4),
    grossRevenue: formatScaledDecimal(
      parseScaledDecimal(target.grossRevenue) - prevGross,
      4,
    ),
    discount: formatScaledDecimal(
      parseScaledDecimal(target.discount) - prevDiscount,
      4,
    ),
    netRevenue: formatScaledDecimal(
      parseScaledDecimal(target.netRevenue) - prevNet,
      4,
    ),
    cogs: formatScaledDecimal(parseScaledDecimal(target.cogs) - prevCogs, 4),
    unitsSold: formatScaledDecimal(
      parseScaledDecimal(target.unitsSold) - prevUnits,
      4,
    ),
    orderCount: target.orderCount - prevOrderCount,
    completedCount: target.completedCount - prevCompletedCount,
    cancelledCount: target.cancelledCount - prevCancelledCount,
  };
}

export function isZeroContributionDelta(
  delta: OrderContributionVector,
): boolean {
  return (
    parseScaledDecimal(delta.gmv) === 0n &&
    parseScaledDecimal(delta.grossRevenue) === 0n &&
    parseScaledDecimal(delta.discount) === 0n &&
    parseScaledDecimal(delta.netRevenue) === 0n &&
    parseScaledDecimal(delta.cogs) === 0n &&
    parseScaledDecimal(delta.unitsSold) === 0n &&
    delta.orderCount === 0 &&
    delta.completedCount === 0 &&
    delta.cancelledCount === 0
  );
}

export function computeNetSalesRevenue(
  grossSalesRevenue: string | number,
  discountTotal: string | number,
  returnsAmount: string | number,
  decimals = 2,
): string {
  const net =
    parseScaledDecimal(grossSalesRevenue) -
    parseScaledDecimal(discountTotal) -
    parseScaledDecimal(returnsAmount);
  return formatScaledDecimal(net, decimals);
}

export function computeGrossProfit(
  netSalesRevenue: string | number,
  cogsAmount: string | number,
  returnedCogsAmount: string | number = 0,
  decimals = 2,
): {
  netCogs: string;
  grossProfit: string;
  grossMarginPct: string;
} {
  const netRevScaled = parseScaledDecimal(netSalesRevenue);
  const netCogsScaled =
    parseScaledDecimal(cogsAmount) - parseScaledDecimal(returnedCogsAmount);
  const grossProfitScaled = netRevScaled - netCogsScaled;

  let grossMarginPct = '0.00';
  if (netRevScaled > 0n) {
    const pctScaled = (grossProfitScaled * 100n * DECIMAL_SCALE) / netRevScaled;
    grossMarginPct = formatScaledDecimal(pctScaled, 2);
  }

  return {
    netCogs: formatScaledDecimal(netCogsScaled, decimals),
    grossProfit: formatScaledDecimal(grossProfitScaled, decimals),
    grossMarginPct,
  };
}

export function computeAov(
  netSalesRevenue: string | number,
  completedOrderCount: number,
  decimals = 2,
): string {
  if (!completedOrderCount || completedOrderCount <= 0) {
    return formatScaledDecimal(0n, decimals);
  }
  return divDecimals(netSalesRevenue, completedOrderCount, decimals);
}

export function computeGrowthMetric(
  currentValue: string | number,
  previousValue: string | number,
  decimals = 2,
): GrowthMetricResult {
  const curr = parseScaledDecimal(currentValue);
  const prev = parseScaledDecimal(previousValue);
  const delta = curr - prev;
  const direction: 'UP' | 'DOWN' | 'FLAT' =
    delta > 0n ? 'UP' : delta < 0n ? 'DOWN' : 'FLAT';

  let growthPct: string | null = null;
  if (prev > 0n) {
    const pctScaled = (delta * 100n * DECIMAL_SCALE) / prev;
    growthPct = formatScaledDecimal(pctScaled, 2);
  } else if (prev < 0n) {
    const absPrev = -prev;
    const pctScaled = (delta * 100n * DECIMAL_SCALE) / absPrev;
    growthPct = formatScaledDecimal(pctScaled, 2);
  }

  return {
    current: formatScaledDecimal(curr, decimals),
    previous: formatScaledDecimal(prev, decimals),
    delta: formatScaledDecimal(delta, decimals),
    growthPct,
    direction,
  };
}

export function computeAvailableQty(
  onHandQty: string | number,
  reservedQty: string | number,
  decimals = 4,
): string {
  const diff = parseScaledDecimal(onHandQty) - parseScaledDecimal(reservedQty);
  return formatScaledDecimal(diff > 0n ? diff : 0n, decimals);
}

export function computeInventoryValuation(
  qty: string | number,
  avgUnitCost: string | number,
  decimals = 4,
): string {
  const q = parseScaledDecimal(qty);
  if (q <= 0n) {
    return formatScaledDecimal(0n, decimals);
  }
  return mulDecimals(qty, avgUnitCost, decimals);
}

export function computeWeightedAverageCost(
  currentOnHandQty: string | number,
  currentAvgCost: string | number,
  receivedQty: string | number,
  receivedUnitCost: string | number,
  decimals = 4,
): string {
  const curQty = parseScaledDecimal(currentOnHandQty);
  const curCost = parseScaledDecimal(currentAvgCost);
  const recQty = parseScaledDecimal(receivedQty);
  const recCost = parseScaledDecimal(receivedUnitCost);

  if (recQty <= 0n) {
    return formatScaledDecimal(curCost, decimals);
  }
  if (curQty <= 0n) {
    return formatScaledDecimal(recCost, decimals);
  }
  const totalQty = curQty + recQty;
  const totalVal = curQty * curCost + recQty * recCost;
  const newAvg = (totalVal + totalQty / 2n) / totalQty;
  return formatScaledDecimal(newAvg, decimals);
}

export function computeProjectionFreshness(input: {
  lastProcessedAt: Date | string | null;
  projectionVersion: string | number;
  now?: Date;
  staleThresholdSeconds?: number;
}): ProjectionFreshnessMetadata {
  const now = input.now ?? new Date();
  const threshold =
    input.staleThresholdSeconds ?? DEFAULT_STALE_THRESHOLD_SECONDS;
  const lastDate = input.lastProcessedAt
    ? typeof input.lastProcessedAt === 'string'
      ? new Date(input.lastProcessedAt)
      : input.lastProcessedAt
    : null;

  const lagSeconds = lastDate
    ? Math.max(0, Math.floor((now.getTime() - lastDate.getTime()) / 1000))
    : 0;

  return {
    asOf: now.toISOString(),
    lastProcessedAt: lastDate ? lastDate.toISOString() : null,
    projectionVersion: Number(input.projectionVersion || 1),
    lagSeconds,
    isStale: lastDate ? lagSeconds > threshold : false,
  };
}

/**
 * Protects CSV and XLSX exports from spreadsheet formula injection (CWE-1236).
 * Prefixes cells starting with '=', '+', '-', '@', '\t', or '\r' with a single quote
 * unless the cell is a valid signed numeric value (e.g. "-150.00").
 */
export function sanitizeSpreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.length === 0) {
    return '';
  }
  // Allow valid signed numbers like -123.45 or +100
  if (/^[+-]?\d+(\.\d+)?$/.test(str)) {
    return str;
  }
  const firstChar = str[0];
  if (
    firstChar === '=' ||
    firstChar === '+' ||
    firstChar === '-' ||
    firstChar === '@' ||
    firstChar === '\t' ||
    firstChar === '\r'
  ) {
    return `'${str}`;
  }
  return str;
}

export function buildCsvBuffer(headers: string[], rows: unknown[][]): Buffer {
  const escapeCsvField = (cell: unknown): string => {
    const safe = sanitizeSpreadsheetCell(cell);
    if (
      safe.includes(',') ||
      safe.includes('"') ||
      safe.includes('\n') ||
      safe.includes('\r')
    ) {
      return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
  };

  const lines = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((r) => r.map(escapeCsvField).join(',')),
  ];
  return Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
}

export function buildXlsxXmlBuffer(
  sheetName: string,
  headers: string[],
  rows: unknown[][],
): Buffer {
  const escapeXml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const renderRow = (cells: unknown[]) =>
    `<Row>${cells
      .map((c) => {
        const safe = sanitizeSpreadsheetCell(c);
        const isNum = /^-?\d+(\.\d+)?$/.test(safe);
        const type = isNum ? 'Number' : 'String';
        return `<Cell><Data ss:Type="${type}">${escapeXml(safe)}</Data></Cell>`;
      })
      .join('')}</Row>`;

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    `<Worksheet ss:Name="${escapeXml(sheetName.slice(0, 31))}">`,
    '<Table>',
    renderRow(headers),
    ...rows.map(renderRow),
    '</Table>',
    '</Worksheet>',
    '</Workbook>',
  ].join('\n');
  return Buffer.from(xml, 'utf8');
}

export function buildPdfReportBuffer(
  title: string,
  metadata: Record<string, string>,
  headers: string[],
  rows: unknown[][],
): Buffer {
  const escapePdfText = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const textLines: string[] = [
    title,
    ...Object.entries(metadata).map(([k, v]) => `${k}: ${v}`),
    '-'.repeat(72),
    headers.map((h) => sanitizeSpreadsheetCell(h)).join(' | '),
    ...rows
      .slice(0, 200)
      .map((r) => r.map((c) => sanitizeSpreadsheetCell(c)).join(' | ')),
  ];

  const contentStreamLines = ['BT', '/F1 10 Tf', '36 760 Td', '14 TL'];
  for (const line of textLines) {
    contentStreamLines.push(`(${escapePdfText(line.slice(0, 110))}) Tj T*`);
  }
  contentStreamLines.push('ET');
  const streamBody = contentStreamLines.join('\n');

  const pdf = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${Buffer.byteLength(streamBody, 'utf8')} >> stream\n${streamBody}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');

  return Buffer.from(pdf, 'utf8');
}
