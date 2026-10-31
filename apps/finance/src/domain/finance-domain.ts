import { createHash } from 'node:crypto';

export enum FinanceDomainErrorCode {
  FINANCIAL_ACCOUNT_NOT_FOUND = 'FINANCIAL_ACCOUNT_NOT_FOUND',
  FINANCIAL_ACCOUNT_INACTIVE = 'FINANCIAL_ACCOUNT_INACTIVE',
  CASH_ACCOUNT_NOT_FOUND = 'CASH_ACCOUNT_NOT_FOUND',
  CASH_ACCOUNT_INACTIVE = 'CASH_ACCOUNT_INACTIVE',
  CASH_ACCOUNT_CODE_CONFLICT = 'CASH_ACCOUNT_CODE_CONFLICT',
  CASHBOOK_CATEGORY_NOT_FOUND = 'CASHBOOK_CATEGORY_NOT_FOUND',
  CASHBOOK_ENTRY_NOT_FOUND = 'CASHBOOK_ENTRY_NOT_FOUND',
  CASHBOOK_ENTRY_ALREADY_POSTED = 'CASHBOOK_ENTRY_ALREADY_POSTED',
  CASHBOOK_ENTRY_INVALID_STATE = 'CASHBOOK_ENTRY_INVALID_STATE',
  JOURNAL_NOT_BALANCED = 'JOURNAL_NOT_BALANCED',
  JOURNAL_NOT_FOUND = 'JOURNAL_NOT_FOUND',
  JOURNAL_ALREADY_POSTED = 'JOURNAL_ALREADY_POSTED',
  POSTING_ALREADY_REVERSED = 'POSTING_ALREADY_REVERSED',
  RECEIVABLE_NOT_FOUND = 'RECEIVABLE_NOT_FOUND',
  RECEIVABLE_INVALID_STATE = 'RECEIVABLE_INVALID_STATE',
  PAYMENT_ALLOCATION_EXCEEDED = 'PAYMENT_ALLOCATION_EXCEEDED',
  CUSTOMER_CREDIT_LIMIT_EXCEEDED = 'CUSTOMER_CREDIT_LIMIT_EXCEEDED',
  CREDIT_AUTHORIZATION_NOT_FOUND = 'CREDIT_AUTHORIZATION_NOT_FOUND',
  CREDIT_AUTHORIZATION_INVALID_STATE = 'CREDIT_AUTHORIZATION_INVALID_STATE',
  PAYABLE_NOT_FOUND = 'PAYABLE_NOT_FOUND',
  PAYABLE_INVALID_STATE = 'PAYABLE_INVALID_STATE',
  SUPPLIER_PAYMENT_EXCEEDED = 'SUPPLIER_PAYMENT_EXCEEDED',
  SETTLEMENT_NOT_FOUND = 'SETTLEMENT_NOT_FOUND',
  SETTLEMENT_AMOUNT_MISMATCH = 'SETTLEMENT_AMOUNT_MISMATCH',
  SETTLEMENT_RECONCILIATION_REQUIRED = 'SETTLEMENT_RECONCILIATION_REQUIRED',
  REFUND_NOT_FOUND = 'REFUND_NOT_FOUND',
  REFUND_NOT_ELIGIBLE = 'REFUND_NOT_ELIGIBLE',
  REFUND_AMOUNT_EXCEEDED = 'REFUND_AMOUNT_EXCEEDED',
  REFUND_OUTCOME_UNKNOWN = 'REFUND_OUTCOME_UNKNOWN',
  REFUND_INVALID_STATE = 'REFUND_INVALID_STATE',
  COD_RECEIVABLE_NOT_FOUND = 'COD_RECEIVABLE_NOT_FOUND',
  COD_SETTLEMENT_NOT_FOUND = 'COD_SETTLEMENT_NOT_FOUND',
  COD_SETTLEMENT_DUPLICATE = 'COD_SETTLEMENT_DUPLICATE',
  COD_SETTLEMENT_MISMATCH = 'COD_SETTLEMENT_MISMATCH',
  SHIFT_RECONCILIATION_NOT_FOUND = 'SHIFT_RECONCILIATION_NOT_FOUND',
  ADJUSTMENT_NOT_FOUND = 'ADJUSTMENT_NOT_FOUND',
  ADJUSTMENT_INVALID_STATE = 'ADJUSTMENT_INVALID_STATE',
  MAKER_CHECKER_VIOLATION = 'MAKER_CHECKER_VIOLATION',
  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  RESOURCE_VERSION_CONFLICT = 'RESOURCE_VERSION_CONFLICT',
  TENANT_ACCESS_DENIED = 'TENANT_ACCESS_DENIED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

export class FinanceDomainError extends Error {
  constructor(
    public readonly code: FinanceDomainErrorCode,
    message: string,
    public readonly httpStatus = 422,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FinanceDomainError';
  }
}

export const DEFAULT_CUSTOMER_CREDIT_LIMIT_VND = '2000000.00';
export const MAX_MONETARY_CENTS = 99_999_999_999_999_99n; // NUMERIC(18,2) safe bound

export interface ParseMoneyOptions {
  allowZero?: boolean;
  allowNegative?: boolean;
  field?: string;
}

/**
 * Parses a decimal string or number into exact integer cents (1 VND = 100 cents)
 * using string-based parsing (zero floating-point precision loss).
 */
export function parseMoneyCents(
  raw: string | number | bigint | null | undefined,
  options: ParseMoneyOptions = {},
): bigint {
  const {
    allowZero = false,
    allowNegative = false,
    field = 'amount',
  } = options;
  if (raw === null || raw === undefined || raw === '') {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.VALIDATION_ERROR,
      `${field} is required`,
      422,
    );
  }
  const str = String(raw).trim();
  const match = /^([+-])?(\d+)(?:\.(\d{1,2}))?$/.exec(str);
  if (!match) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.VALIDATION_ERROR,
      `${field} must be a valid monetary value with at most 2 decimal places (received "${str}")`,
      422,
    );
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fracRaw = match[3] ?? '';
  const fracPadded = fracRaw.padEnd(2, '0');
  const frac = BigInt(fracPadded);

  const cents = sign * (whole * 100n + frac);

  if (cents < 0n && !allowNegative) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.VALIDATION_ERROR,
      `${field} cannot be negative`,
      422,
    );
  }
  if (cents === 0n && !allowZero) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.VALIDATION_ERROR,
      `${field} must be greater than zero`,
      422,
    );
  }
  const absCents = cents < 0n ? -cents : cents;
  if (absCents > MAX_MONETARY_CENTS) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.VALIDATION_ERROR,
      `${field} exceeds maximum supported precision NUMERIC(18,2)`,
      422,
    );
  }
  return cents;
}

export function formatMoneyCents(cents: bigint): string {
  const isNeg = cents < 0n;
  const abs = isNeg ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${isNeg ? '-' : ''}${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

export function normalizeFinanceCode(raw: string, field = 'code'): string {
  const cleaned = (raw ?? '').trim().toUpperCase();
  if (!cleaned || !/^[A-Z0-9_-]{2,64}$/.test(cleaned)) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.VALIDATION_ERROR,
      `Invalid ${field}: must be 2-64 uppercase alphanumeric, underscore, or hyphen characters`,
      422,
    );
  }
  return cleaned;
}

export function computePayloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function maskBankAccountNumber(raw?: string | null): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim().replace(/\s+/g, '');
  if (trimmed.length <= 4) {
    return '****';
  }
  return `${'*'.repeat(Math.min(8, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

// ---- Standard Internal Chart of Accounts (ADR-0017)

export interface StandardFinancialAccountSpec {
  code: string;
  name: string;
  accountType:
    | 'ASSET'
    | 'LIABILITY'
    | 'EQUITY'
    | 'REVENUE'
    | 'CONTRA_REVENUE'
    | 'EXPENSE';
  normalSide: 'DEBIT' | 'CREDIT';
}

export const GL_ACCOUNT_CODES = {
  CASH_ON_HAND: '1110',
  CASH_AT_BANK: '1120',
  ACCOUNTS_RECEIVABLE: '1310',
  COD_CARRIER_RECEIVABLE: '1315',
  PAYMENT_CLEARING: '1388',
  INVENTORY_PURCHASE_CLEARING: '1560',
  CUSTOMER_PREPAYMENT: '3315',
  ACCOUNTS_PAYABLE: '3310',
  SALES_REVENUE_CLEARING: '5110',
  SALES_RETURN_REFUND: '5210',
  CARRIER_FEE_EXPENSE: '6410',
  OPERATING_EXPENSE: '6420',
  OTHER_INCOME: '7110',
  CASH_VARIANCE: '8110',
} as const;

export const DEFAULT_FINANCE_ACCOUNTS: readonly StandardFinancialAccountSpec[] =
  [
    {
      code: GL_ACCOUNT_CODES.CASH_ON_HAND,
      name: 'Cash on Hand (Drawer / Safe)',
      accountType: 'ASSET',
      normalSide: 'DEBIT',
    },
    {
      code: GL_ACCOUNT_CODES.CASH_AT_BANK,
      name: 'Cash at Bank / E-Wallet',
      accountType: 'ASSET',
      normalSide: 'DEBIT',
    },
    {
      code: GL_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
      name: 'Customer Accounts Receivable',
      accountType: 'ASSET',
      normalSide: 'DEBIT',
    },
    {
      code: GL_ACCOUNT_CODES.COD_CARRIER_RECEIVABLE,
      name: 'COD Carrier Receivable',
      accountType: 'ASSET',
      normalSide: 'DEBIT',
    },
    {
      code: GL_ACCOUNT_CODES.PAYMENT_CLEARING,
      name: 'Electronic Payment Clearing',
      accountType: 'ASSET',
      normalSide: 'DEBIT',
    },
    {
      code: GL_ACCOUNT_CODES.INVENTORY_PURCHASE_CLEARING,
      name: 'Inventory & Goods Receipt Clearing',
      accountType: 'ASSET',
      normalSide: 'DEBIT',
    },
    {
      code: GL_ACCOUNT_CODES.CUSTOMER_PREPAYMENT,
      name: 'Customer Prepayments & Overpayments',
      accountType: 'LIABILITY',
      normalSide: 'CREDIT',
    },
    {
      code: GL_ACCOUNT_CODES.ACCOUNTS_PAYABLE,
      name: 'Supplier Accounts Payable',
      accountType: 'LIABILITY',
      normalSide: 'CREDIT',
    },
    {
      code: GL_ACCOUNT_CODES.SALES_REVENUE_CLEARING,
      name: 'Sales Revenue Clearing',
      accountType: 'REVENUE',
      normalSide: 'CREDIT',
    },
    {
      code: GL_ACCOUNT_CODES.SALES_RETURN_REFUND,
      name: 'Sales Returns & Refunds',
      accountType: 'CONTRA_REVENUE',
      normalSide: 'DEBIT',
    },
    {
      code: GL_ACCOUNT_CODES.CARRIER_FEE_EXPENSE,
      name: 'Carrier Shipping & COD Fees',
      accountType: 'EXPENSE',
      normalSide: 'DEBIT',
    },
    {
      code: GL_ACCOUNT_CODES.OPERATING_EXPENSE,
      name: 'Store Operating Expenses',
      accountType: 'EXPENSE',
      normalSide: 'DEBIT',
    },
    {
      code: GL_ACCOUNT_CODES.OTHER_INCOME,
      name: 'Miscellaneous Income',
      accountType: 'REVENUE',
      normalSide: 'CREDIT',
    },
    {
      code: GL_ACCOUNT_CODES.CASH_VARIANCE,
      name: 'Cashier Shift Shortage / Overage',
      accountType: 'EXPENSE',
      normalSide: 'DEBIT',
    },
  ];

export interface StandardCashbookCategorySpec {
  code: string;
  name: string;
  direction: 'RECEIPT' | 'EXPENSE';
  glAccountCode: string;
}

export const DEFAULT_CASHBOOK_CATEGORIES: readonly StandardCashbookCategorySpec[] =
  [
    {
      code: 'SALES_RECEIPT',
      name: 'POS / Order Cash Sale Receipt',
      direction: 'RECEIPT',
      glAccountCode: GL_ACCOUNT_CODES.SALES_REVENUE_CLEARING,
    },
    {
      code: 'DEBT_COLLECTION',
      name: 'Customer Debt Collection',
      direction: 'RECEIPT',
      glAccountCode: GL_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
    },
    {
      code: 'COD_SETTLEMENT_RECEIPT',
      name: 'Carrier COD Remittance Receipt',
      direction: 'RECEIPT',
      glAccountCode: GL_ACCOUNT_CODES.COD_CARRIER_RECEIVABLE,
    },
    {
      code: 'OTHER_RECEIPT',
      name: 'Miscellaneous Cash Receipt',
      direction: 'RECEIPT',
      glAccountCode: GL_ACCOUNT_CODES.OTHER_INCOME,
    },
    {
      code: 'SUPPLIER_PAYMENT',
      name: 'Supplier Payable Payment',
      direction: 'EXPENSE',
      glAccountCode: GL_ACCOUNT_CODES.ACCOUNTS_PAYABLE,
    },
    {
      code: 'CUSTOMER_REFUND',
      name: 'Customer Sales Return Refund',
      direction: 'EXPENSE',
      glAccountCode: GL_ACCOUNT_CODES.SALES_RETURN_REFUND,
    },
    {
      code: 'OPERATING_EXPENSE',
      name: 'General Store Operating Expense',
      direction: 'EXPENSE',
      glAccountCode: GL_ACCOUNT_CODES.OPERATING_EXPENSE,
    },
  ];

// ---- Balanced Journal Invariants

export interface JournalLineInput {
  accountCode: string;
  debitAmount?: string | number;
  creditAmount?: string | number;
  branchId?: string | null;
  partyType?: 'CUSTOMER' | 'SUPPLIER' | 'CARRIER' | null;
  partyId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  memo?: string | null;
}

export interface ValidatedJournalLine {
  lineNo: number;
  accountCode: string;
  debitAmount: string;
  creditAmount: string;
  debitCents: bigint;
  creditCents: bigint;
  branchId: string | null;
  partyType: 'CUSTOMER' | 'SUPPLIER' | 'CARRIER' | null;
  partyId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  memo: string | null;
}

export interface ValidatedJournalResult {
  totalDebit: string;
  totalCredit: string;
  totalDebitCents: bigint;
  totalCreditCents: bigint;
  lines: ValidatedJournalLine[];
}

export function validateBalancedJournalLines(
  lines: JournalLineInput[],
): ValidatedJournalResult {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.JOURNAL_NOT_BALANCED,
      'A financial journal must contain at least 2 posting lines',
      422,
    );
  }

  let totalDebitCents = 0n;
  let totalCreditCents = 0n;
  const validatedLines: ValidatedJournalLine[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const accountCode = (line.accountCode ?? '').trim().toUpperCase();
    if (!accountCode) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.VALIDATION_ERROR,
        `Journal line ${i + 1} is missing accountCode`,
        422,
      );
    }

    const debitCents = parseMoneyCents(line.debitAmount ?? '0.00', {
      allowZero: true,
      allowNegative: false,
      field: `lines[${i}].debitAmount`,
    });
    const creditCents = parseMoneyCents(line.creditAmount ?? '0.00', {
      allowZero: true,
      allowNegative: false,
      field: `lines[${i}].creditAmount`,
    });

    if (
      (debitCents === 0n && creditCents === 0n) ||
      (debitCents > 0n && creditCents > 0n)
    ) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.JOURNAL_NOT_BALANCED,
        `Journal line ${i + 1} (${accountCode}) must have either a positive debit or a positive credit, not both or zero`,
        422,
      );
    }

    totalDebitCents += debitCents;
    totalCreditCents += creditCents;

    validatedLines.push({
      lineNo: i + 1,
      accountCode,
      debitAmount: formatMoneyCents(debitCents),
      creditAmount: formatMoneyCents(creditCents),
      debitCents,
      creditCents,
      branchId: line.branchId ?? null,
      partyType: line.partyType ?? null,
      partyId: line.partyId ?? null,
      referenceType: line.referenceType ?? null,
      referenceId: line.referenceId ?? null,
      memo: line.memo ?? null,
    });
  }

  if (totalDebitCents <= 0n || totalDebitCents !== totalCreditCents) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.JOURNAL_NOT_BALANCED,
      `Journal is not balanced: totalDebit (${formatMoneyCents(totalDebitCents)}) != totalCredit (${formatMoneyCents(totalCreditCents)})`,
      422,
      {
        totalDebit: formatMoneyCents(totalDebitCents),
        totalCredit: formatMoneyCents(totalCreditCents),
      },
    );
  }

  return {
    totalDebit: formatMoneyCents(totalDebitCents),
    totalCredit: formatMoneyCents(totalCreditCents),
    totalDebitCents,
    totalCreditCents,
    lines: validatedLines,
  };
}

// ---- Customer Credit Authorization

export interface CreditAuthorizationEvaluationInput {
  creditLimit: string | number;
  postedDebt: string | number;
  heldCredit: string | number;
  requestedAmount: string | number;
  overrideApprovedBy?: string | null;
  overrideReason?: string | null;
}

export interface CreditAuthorizationEvaluationResult {
  creditLimit: string;
  postedDebt: string;
  heldCreditBefore: string;
  availableCreditBefore: string;
  requestedAmount: string;
  heldCreditAfter: string;
  availableCreditAfter: string;
  isOverride: boolean;
}

export function evaluateCreditAuthorization(
  input: CreditAuthorizationEvaluationInput,
): CreditAuthorizationEvaluationResult {
  const limitCents = parseMoneyCents(input.creditLimit, {
    allowZero: true,
    field: 'creditLimit',
  });
  const postedCents = parseMoneyCents(input.postedDebt, {
    allowZero: true,
    field: 'postedDebt',
  });
  const heldCents = parseMoneyCents(input.heldCredit, {
    allowZero: true,
    field: 'heldCredit',
  });
  const reqCents = parseMoneyCents(input.requestedAmount, {
    allowZero: false,
    field: 'requestedAmount',
  });

  const availableBefore =
    limitCents > postedCents + heldCents
      ? limitCents - postedCents - heldCents
      : 0n;

  const isOverride = Boolean(
    input.overrideApprovedBy && input.overrideApprovedBy.trim().length > 0,
  );

  if (reqCents > availableBefore && !isOverride) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.CUSTOMER_CREDIT_LIMIT_EXCEEDED,
      `Requested credit (${formatMoneyCents(reqCents)} VND) exceeds available credit (${formatMoneyCents(availableBefore)} VND; limit=${formatMoneyCents(limitCents)}, postedDebt=${formatMoneyCents(postedCents)}, heldCredit=${formatMoneyCents(heldCents)})`,
      409,
      {
        creditLimit: formatMoneyCents(limitCents),
        postedDebt: formatMoneyCents(postedCents),
        heldCredit: formatMoneyCents(heldCents),
        availableCredit: formatMoneyCents(availableBefore),
        requestedAmount: formatMoneyCents(reqCents),
      },
    );
  }

  const heldAfter = heldCents + reqCents;
  const availableAfter =
    limitCents > postedCents + heldAfter
      ? limitCents - postedCents - heldAfter
      : 0n;

  return {
    creditLimit: formatMoneyCents(limitCents),
    postedDebt: formatMoneyCents(postedCents),
    heldCreditBefore: formatMoneyCents(heldCents),
    availableCreditBefore: formatMoneyCents(availableBefore),
    requestedAmount: formatMoneyCents(reqCents),
    heldCreditAfter: formatMoneyCents(heldAfter),
    availableCreditAfter: formatMoneyCents(availableAfter),
    isOverride,
  };
}

// ---- Receivable & Payable Payment Allocation

export interface OpenObligationSnapshot {
  id: string;
  code: string;
  originalAmount: string;
  paidAmount: string;
  adjustedAmount: string;
  outstandingAmount: string;
}

export interface RequestedAllocationLine {
  documentId: string;
  amount: string | number;
}

export interface CalculatedAllocationLine {
  documentId: string;
  code: string;
  allocatedAmount: string;
  paidAmountAfter: string;
  outstandingBefore: string;
  outstandingAfter: string;
  statusAfter: 'PARTIALLY_PAID' | 'PAID';
}

export interface CalculatedPaymentAllocationResult {
  paymentAmount: string;
  totalAllocated: string;
  overpaymentAmount: string;
  allocations: CalculatedAllocationLine[];
}

export function calculateDocumentAllocations(
  paymentAmountRaw: string | number,
  openDocuments: OpenObligationSnapshot[],
  explicitAllocations?: RequestedAllocationLine[],
  options: {
    overpaymentPolicy?: 'REJECT' | 'PREPAYMENT';
    kind?: 'RECEIVABLE' | 'PAYABLE';
  } = {},
): CalculatedPaymentAllocationResult {
  const { overpaymentPolicy = 'REJECT', kind = 'RECEIVABLE' } = options;
  const errorCode =
    kind === 'RECEIVABLE'
      ? FinanceDomainErrorCode.PAYMENT_ALLOCATION_EXCEEDED
      : FinanceDomainErrorCode.SUPPLIER_PAYMENT_EXCEEDED;

  const paymentCents = parseMoneyCents(paymentAmountRaw, {
    allowZero: false,
    field: 'paymentAmount',
  });

  const docMap = new Map(openDocuments.map((d) => [d.id, d]));
  const allocations: CalculatedAllocationLine[] = [];
  let totalAllocatedCents = 0n;

  if (explicitAllocations && explicitAllocations.length > 0) {
    const seen = new Set<string>();
    for (const req of explicitAllocations) {
      if (seen.has(req.documentId)) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.VALIDATION_ERROR,
          `Duplicate allocation target document ${req.documentId}`,
          422,
        );
      }
      seen.add(req.documentId);

      const doc = docMap.get(req.documentId);
      if (!doc) {
        throw new FinanceDomainError(
          kind === 'RECEIVABLE'
            ? FinanceDomainErrorCode.RECEIVABLE_NOT_FOUND
            : FinanceDomainErrorCode.PAYABLE_NOT_FOUND,
          `Open ${kind.toLowerCase()} ${req.documentId} not found`,
          404,
        );
      }

      const allocCents = parseMoneyCents(req.amount, {
        allowZero: false,
        field: `allocation[${req.documentId}]`,
      });
      const outBeforeCents = parseMoneyCents(doc.outstandingAmount, {
        allowZero: true,
        field: 'outstandingAmount',
      });
      const paidBeforeCents = parseMoneyCents(doc.paidAmount, {
        allowZero: true,
        field: 'paidAmount',
      });

      if (allocCents > outBeforeCents) {
        throw new FinanceDomainError(
          errorCode,
          `Allocation (${formatMoneyCents(allocCents)}) exceeds outstanding balance (${formatMoneyCents(outBeforeCents)}) on ${doc.code}`,
          409,
          {
            documentId: doc.id,
            code: doc.code,
            requestedAllocation: formatMoneyCents(allocCents),
            outstandingAmount: formatMoneyCents(outBeforeCents),
          },
        );
      }

      const outAfterCents = outBeforeCents - allocCents;
      const paidAfterCents = paidBeforeCents + allocCents;
      totalAllocatedCents += allocCents;

      allocations.push({
        documentId: doc.id,
        code: doc.code,
        allocatedAmount: formatMoneyCents(allocCents),
        paidAmountAfter: formatMoneyCents(paidAfterCents),
        outstandingBefore: formatMoneyCents(outBeforeCents),
        outstandingAfter: formatMoneyCents(outAfterCents),
        statusAfter: outAfterCents === 0n ? 'PAID' : 'PARTIALLY_PAID',
      });
    }
  } else {
    // FIFO allocation across open documents provided
    let remainingToAllocate = paymentCents;
    for (const doc of openDocuments) {
      if (remainingToAllocate <= 0n) {
        break;
      }
      const outBeforeCents = parseMoneyCents(doc.outstandingAmount, {
        allowZero: true,
        field: 'outstandingAmount',
      });
      if (outBeforeCents <= 0n) {
        continue;
      }
      const paidBeforeCents = parseMoneyCents(doc.paidAmount, {
        allowZero: true,
        field: 'paidAmount',
      });

      const allocCents =
        remainingToAllocate <= outBeforeCents
          ? remainingToAllocate
          : outBeforeCents;
      const outAfterCents = outBeforeCents - allocCents;
      const paidAfterCents = paidBeforeCents + allocCents;

      remainingToAllocate -= allocCents;
      totalAllocatedCents += allocCents;

      allocations.push({
        documentId: doc.id,
        code: doc.code,
        allocatedAmount: formatMoneyCents(allocCents),
        paidAmountAfter: formatMoneyCents(paidAfterCents),
        outstandingBefore: formatMoneyCents(outBeforeCents),
        outstandingAfter: formatMoneyCents(outAfterCents),
        statusAfter: outAfterCents === 0n ? 'PAID' : 'PARTIALLY_PAID',
      });
    }
  }

  if (totalAllocatedCents > paymentCents) {
    throw new FinanceDomainError(
      errorCode,
      `Total allocations (${formatMoneyCents(totalAllocatedCents)}) exceed confirmed payment amount (${formatMoneyCents(paymentCents)})`,
      409,
    );
  }

  const overpaymentCents = paymentCents - totalAllocatedCents;
  if (overpaymentCents > 0n && overpaymentPolicy === 'REJECT') {
    throw new FinanceDomainError(
      errorCode,
      `Payment amount (${formatMoneyCents(paymentCents)}) exceeds total allocated outstanding balance (${formatMoneyCents(totalAllocatedCents)}) by ${formatMoneyCents(overpaymentCents)}`,
      409,
      {
        paymentAmount: formatMoneyCents(paymentCents),
        totalAllocated: formatMoneyCents(totalAllocatedCents),
        overpaymentAmount: formatMoneyCents(overpaymentCents),
      },
    );
  }

  return {
    paymentAmount: formatMoneyCents(paymentCents),
    totalAllocated: formatMoneyCents(totalAllocatedCents),
    overpaymentAmount: formatMoneyCents(overpaymentCents),
    allocations,
  };
}

// ---- Refund Eligibility

export interface RefundEligibilityInput {
  originalPaidAmount: string | number;
  alreadyRefundedAmount: string | number;
  requestedRefundAmount: string | number;
}

export interface RefundEligibilityResult {
  originalPaidAmount: string;
  alreadyRefundedAmount: string;
  remainingRefundableBefore: string;
  requestedRefundAmount: string;
  remainingRefundableAfter: string;
}

export function validateRefundAllocation(
  input: RefundEligibilityInput,
): RefundEligibilityResult {
  const paidCents = parseMoneyCents(input.originalPaidAmount, {
    allowZero: false,
    field: 'originalPaidAmount',
  });
  const refundedCents = parseMoneyCents(input.alreadyRefundedAmount, {
    allowZero: true,
    field: 'alreadyRefundedAmount',
  });
  const reqCents = parseMoneyCents(input.requestedRefundAmount, {
    allowZero: false,
    field: 'requestedRefundAmount',
  });

  const remainingBefore =
    paidCents > refundedCents ? paidCents - refundedCents : 0n;
  if (reqCents > remainingBefore) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.REFUND_AMOUNT_EXCEEDED,
      `Requested refund (${formatMoneyCents(reqCents)}) exceeds remaining refundable amount (${formatMoneyCents(remainingBefore)})`,
      409,
      {
        originalPaidAmount: formatMoneyCents(paidCents),
        alreadyRefundedAmount: formatMoneyCents(refundedCents),
        remainingRefundable: formatMoneyCents(remainingBefore),
        requestedRefundAmount: formatMoneyCents(reqCents),
      },
    );
  }

  return {
    originalPaidAmount: formatMoneyCents(paidCents),
    alreadyRefundedAmount: formatMoneyCents(refundedCents),
    remainingRefundableBefore: formatMoneyCents(remainingBefore),
    requestedRefundAmount: formatMoneyCents(reqCents),
    remainingRefundableAfter: formatMoneyCents(remainingBefore - reqCents),
  };
}

// ---- COD Settlement Line Evaluation

export interface CodSettlementLineEvaluationInput {
  expectedGrossCod: string | number;
  reportedGrossCod: string | number;
  carrierFee: string | number;
  reportedNetPayout: string | number;
}

export interface CodSettlementLineEvaluationResult {
  expectedGrossCod: string;
  reportedGrossCod: string;
  carrierFee: string;
  expectedNetPayout: string;
  reportedNetPayout: string;
  discrepancyAmount: string;
  status: 'MATCHED' | 'DISCREPANCY';
  discrepancyReason: string | null;
}

export function evaluateCodSettlementLine(
  input: CodSettlementLineEvaluationInput,
): CodSettlementLineEvaluationResult {
  const expectedGrossCents = parseMoneyCents(input.expectedGrossCod, {
    allowZero: false,
    field: 'expectedGrossCod',
  });
  const reportedGrossCents = parseMoneyCents(input.reportedGrossCod, {
    allowZero: true,
    field: 'reportedGrossCod',
  });
  const feeCents = parseMoneyCents(input.carrierFee, {
    allowZero: true,
    field: 'carrierFee',
  });
  const reportedNetCents = parseMoneyCents(input.reportedNetPayout, {
    allowZero: true,
    allowNegative: true,
    field: 'reportedNetPayout',
  });

  const expectedNetCents = expectedGrossCents - feeCents;
  const discrepancyCents = reportedNetCents - expectedNetCents;
  const reasons: string[] = [];

  if (reportedGrossCents !== expectedGrossCents) {
    reasons.push(
      `Reported COD (${formatMoneyCents(reportedGrossCents)}) != expected COD (${formatMoneyCents(expectedGrossCents)})`,
    );
  }
  if (reportedGrossCents - feeCents !== reportedNetCents) {
    reasons.push(
      `Carrier statement math mismatch: reportedGross (${formatMoneyCents(reportedGrossCents)}) - fee (${formatMoneyCents(feeCents)}) != netPayout (${formatMoneyCents(reportedNetCents)})`,
    );
  }
  if (discrepancyCents !== 0n && reasons.length === 0) {
    reasons.push(
      `Net payout discrepancy of ${formatMoneyCents(discrepancyCents)} VND`,
    );
  }

  return {
    expectedGrossCod: formatMoneyCents(expectedGrossCents),
    reportedGrossCod: formatMoneyCents(reportedGrossCents),
    carrierFee: formatMoneyCents(feeCents),
    expectedNetPayout: formatMoneyCents(expectedNetCents),
    reportedNetPayout: formatMoneyCents(reportedNetCents),
    discrepancyAmount: formatMoneyCents(discrepancyCents),
    status: reasons.length === 0 ? 'MATCHED' : 'DISCREPANCY',
    discrepancyReason: reasons.length > 0 ? reasons.join('; ') : null,
  };
}

// ---- Shift Cash Reconciliation

export interface ShiftCashEvaluationInput {
  openingCash: string | number;
  confirmedCashSales: string | number;
  confirmedCashRefunds: string | number;
  otherCashReceipts?: string | number;
  otherCashExpenses?: string | number;
  actualCountedCash: string | number;
}

export interface ShiftCashEvaluationResult {
  openingCash: string;
  confirmedCashSales: string;
  confirmedCashRefunds: string;
  otherCashReceipts: string;
  otherCashExpenses: string;
  expectedClosingCash: string;
  actualCountedCash: string;
  varianceAmount: string;
  status: 'RECONCILED' | 'VARIANCE_DETECTED';
}

export function evaluateShiftCashReconciliation(
  input: ShiftCashEvaluationInput,
): ShiftCashEvaluationResult {
  const opening = parseMoneyCents(input.openingCash, {
    allowZero: true,
    field: 'openingCash',
  });
  const sales = parseMoneyCents(input.confirmedCashSales, {
    allowZero: true,
    field: 'confirmedCashSales',
  });
  const refunds = parseMoneyCents(input.confirmedCashRefunds, {
    allowZero: true,
    field: 'confirmedCashRefunds',
  });
  const otherIn = parseMoneyCents(input.otherCashReceipts ?? '0.00', {
    allowZero: true,
    field: 'otherCashReceipts',
  });
  const otherOut = parseMoneyCents(input.otherCashExpenses ?? '0.00', {
    allowZero: true,
    field: 'otherCashExpenses',
  });
  const actual = parseMoneyCents(input.actualCountedCash, {
    allowZero: true,
    field: 'actualCountedCash',
  });

  const expected = opening + sales - refunds + otherIn - otherOut;
  const variance = actual - expected;

  return {
    openingCash: formatMoneyCents(opening),
    confirmedCashSales: formatMoneyCents(sales),
    confirmedCashRefunds: formatMoneyCents(refunds),
    otherCashReceipts: formatMoneyCents(otherIn),
    otherCashExpenses: formatMoneyCents(otherOut),
    expectedClosingCash: formatMoneyCents(expected),
    actualCountedCash: formatMoneyCents(actual),
    varianceAmount: formatMoneyCents(variance),
    status: variance === 0n ? 'RECONCILED' : 'VARIANCE_DETECTED',
  };
}

// ---- Maker-Checker Separation of Duties

export function assertMakerCheckerSeparation(
  requestedBy: string,
  approvedBy: string,
  operationLabel = 'financial adjustment',
): void {
  if (!requestedBy || !approvedBy) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.VALIDATION_ERROR,
      `Both requestedBy and approvedBy are required for ${operationLabel}`,
      422,
    );
  }
  if (requestedBy.trim() === approvedBy.trim()) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.MAKER_CHECKER_VIOLATION,
      `Separation of duties violation: actor "${approvedBy}" cannot approve their own ${operationLabel}`,
      403,
      { requestedBy, approvedBy },
    );
  }
}
