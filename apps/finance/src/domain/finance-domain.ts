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

export const DEFAULT_CUSTOMER_CREDIT_LIMIT_VND = 2_000_000;
/** Largest money value accepted (JS safe integer, fits a bigint column). */
export const MAX_MONETARY_VND = Number.MAX_SAFE_INTEGER;

export interface ParseMoneyOptions {
  allowZero?: boolean;
  allowNegative?: boolean;
  field?: string;
}

/**
 * Validates money: a whole number of VND that is a safe integer. A fractional
 * value or a string is rejected with a 422 validation error.
 */
export function parseVnd(
  raw: number | null | undefined,
  options: ParseMoneyOptions = {},
): number {
  const {
    allowZero = false,
    allowNegative = false,
    field = 'amount',
  } = options;
  if (raw === null || raw === undefined) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.VALIDATION_ERROR,
      `${field} is required`,
      422,
    );
  }
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.VALIDATION_ERROR,
      `${field} must be a whole number of VND (received "${String(raw)}")`,
      422,
    );
  }
  if (raw < 0 && !allowNegative) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.VALIDATION_ERROR,
      `${field} cannot be negative`,
      422,
    );
  }
  if (raw === 0 && !allowZero) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.VALIDATION_ERROR,
      `${field} must be greater than zero`,
      422,
    );
  }
  return raw;
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
  debitAmount?: number;
  creditAmount?: number;
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
  debitAmount: number;
  creditAmount: number;
  debitVnd: number;
  creditVnd: number;
  branchId: string | null;
  partyType: 'CUSTOMER' | 'SUPPLIER' | 'CARRIER' | null;
  partyId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  memo: string | null;
}

export interface ValidatedJournalResult {
  totalDebit: number;
  totalCredit: number;
  totalDebitVnd: number;
  totalCreditVnd: number;
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

  let totalDebitVnd = 0;
  let totalCreditVnd = 0;
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

    const debitVnd = parseVnd(line.debitAmount ?? 0, {
      allowZero: true,
      allowNegative: false,
      field: `lines[${i}].debitAmount`,
    });
    const creditVnd = parseVnd(line.creditAmount ?? 0, {
      allowZero: true,
      allowNegative: false,
      field: `lines[${i}].creditAmount`,
    });

    if (
      (debitVnd === 0 && creditVnd === 0) ||
      (debitVnd > 0 && creditVnd > 0)
    ) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.JOURNAL_NOT_BALANCED,
        `Journal line ${i + 1} (${accountCode}) must have either a positive debit or a positive credit, not both or zero`,
        422,
      );
    }

    totalDebitVnd += debitVnd;
    totalCreditVnd += creditVnd;

    validatedLines.push({
      lineNo: i + 1,
      accountCode,
      debitAmount: debitVnd,
      creditAmount: creditVnd,
      debitVnd,
      creditVnd,
      branchId: line.branchId ?? null,
      partyType: line.partyType ?? null,
      partyId: line.partyId ?? null,
      referenceType: line.referenceType ?? null,
      referenceId: line.referenceId ?? null,
      memo: line.memo ?? null,
    });
  }

  if (totalDebitVnd <= 0 || totalDebitVnd !== totalCreditVnd) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.JOURNAL_NOT_BALANCED,
      `Journal is not balanced: totalDebit (${totalDebitVnd}) != totalCredit (${totalCreditVnd})`,
      422,
      {
        totalDebit: totalDebitVnd,
        totalCredit: totalCreditVnd,
      },
    );
  }

  return {
    totalDebit: totalDebitVnd,
    totalCredit: totalCreditVnd,
    totalDebitVnd,
    totalCreditVnd,
    lines: validatedLines,
  };
}

// ---- Customer Credit Authorization

export interface CreditAuthorizationEvaluationInput {
  creditLimit: number;
  postedDebt: number;
  heldCredit: number;
  requestedAmount: number;
  overrideApprovedBy?: string | null;
  overrideReason?: string | null;
}

export interface CreditAuthorizationEvaluationResult {
  creditLimit: number;
  postedDebt: number;
  heldCreditBefore: number;
  availableCreditBefore: number;
  requestedAmount: number;
  heldCreditAfter: number;
  availableCreditAfter: number;
  isOverride: boolean;
}

export function evaluateCreditAuthorization(
  input: CreditAuthorizationEvaluationInput,
): CreditAuthorizationEvaluationResult {
  const limitVnd = parseVnd(input.creditLimit, {
    allowZero: true,
    field: 'creditLimit',
  });
  const postedVnd = parseVnd(input.postedDebt, {
    allowZero: true,
    field: 'postedDebt',
  });
  const heldVnd = parseVnd(input.heldCredit, {
    allowZero: true,
    field: 'heldCredit',
  });
  const reqVnd = parseVnd(input.requestedAmount, {
    allowZero: false,
    field: 'requestedAmount',
  });

  const availableBefore =
    limitVnd > postedVnd + heldVnd ? limitVnd - postedVnd - heldVnd : 0;

  const isOverride = Boolean(
    input.overrideApprovedBy && input.overrideApprovedBy.trim().length > 0,
  );

  if (reqVnd > availableBefore && !isOverride) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.CUSTOMER_CREDIT_LIMIT_EXCEEDED,
      `Requested credit (${reqVnd} VND) exceeds available credit (${availableBefore} VND; limit=${limitVnd}, postedDebt=${postedVnd}, heldCredit=${heldVnd})`,
      409,
      {
        creditLimit: limitVnd,
        postedDebt: postedVnd,
        heldCredit: heldVnd,
        availableCredit: availableBefore,
        requestedAmount: reqVnd,
      },
    );
  }

  const heldAfter = heldVnd + reqVnd;
  const availableAfter =
    limitVnd > postedVnd + heldAfter ? limitVnd - postedVnd - heldAfter : 0;

  return {
    creditLimit: limitVnd,
    postedDebt: postedVnd,
    heldCreditBefore: heldVnd,
    availableCreditBefore: availableBefore,
    requestedAmount: reqVnd,
    heldCreditAfter: heldAfter,
    availableCreditAfter: availableAfter,
    isOverride,
  };
}

// ---- Receivable & Payable Payment Allocation

export interface OpenObligationSnapshot {
  id: string;
  code: string;
  originalAmount: number;
  paidAmount: number;
  adjustedAmount: number;
  outstandingAmount: number;
}

export interface RequestedAllocationLine {
  documentId: string;
  amount: number;
}

export interface CalculatedAllocationLine {
  documentId: string;
  code: string;
  allocatedAmount: number;
  paidAmountAfter: number;
  outstandingBefore: number;
  outstandingAfter: number;
  statusAfter: 'PARTIALLY_PAID' | 'PAID';
}

export interface CalculatedPaymentAllocationResult {
  paymentAmount: number;
  totalAllocated: number;
  overpaymentAmount: number;
  allocations: CalculatedAllocationLine[];
}

export function calculateDocumentAllocations(
  paymentAmountRaw: number,
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

  const paymentVnd = parseVnd(paymentAmountRaw, {
    allowZero: false,
    field: 'paymentAmount',
  });

  const docMap = new Map(openDocuments.map((d) => [d.id, d]));
  const allocations: CalculatedAllocationLine[] = [];
  let totalAllocatedVnd = 0;

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

      const allocVnd = parseVnd(req.amount, {
        allowZero: false,
        field: `allocation[${req.documentId}]`,
      });
      const outBeforeVnd = parseVnd(doc.outstandingAmount, {
        allowZero: true,
        field: 'outstandingAmount',
      });
      const paidBeforeVnd = parseVnd(doc.paidAmount, {
        allowZero: true,
        field: 'paidAmount',
      });

      if (allocVnd > outBeforeVnd) {
        throw new FinanceDomainError(
          errorCode,
          `Allocation (${allocVnd}) exceeds outstanding balance (${outBeforeVnd}) on ${doc.code}`,
          409,
          {
            documentId: doc.id,
            code: doc.code,
            requestedAllocation: allocVnd,
            outstandingAmount: outBeforeVnd,
          },
        );
      }

      const outAfterVnd = outBeforeVnd - allocVnd;
      const paidAfterVnd = paidBeforeVnd + allocVnd;
      totalAllocatedVnd += allocVnd;

      allocations.push({
        documentId: doc.id,
        code: doc.code,
        allocatedAmount: allocVnd,
        paidAmountAfter: paidAfterVnd,
        outstandingBefore: outBeforeVnd,
        outstandingAfter: outAfterVnd,
        statusAfter: outAfterVnd === 0 ? 'PAID' : 'PARTIALLY_PAID',
      });
    }
  } else {
    // FIFO allocation across open documents provided
    let remainingToAllocate = paymentVnd;
    for (const doc of openDocuments) {
      if (remainingToAllocate <= 0) {
        break;
      }
      const outBeforeVnd = parseVnd(doc.outstandingAmount, {
        allowZero: true,
        field: 'outstandingAmount',
      });
      if (outBeforeVnd <= 0) {
        continue;
      }
      const paidBeforeVnd = parseVnd(doc.paidAmount, {
        allowZero: true,
        field: 'paidAmount',
      });

      const allocVnd =
        remainingToAllocate <= outBeforeVnd
          ? remainingToAllocate
          : outBeforeVnd;
      const outAfterVnd = outBeforeVnd - allocVnd;
      const paidAfterVnd = paidBeforeVnd + allocVnd;

      remainingToAllocate -= allocVnd;
      totalAllocatedVnd += allocVnd;

      allocations.push({
        documentId: doc.id,
        code: doc.code,
        allocatedAmount: allocVnd,
        paidAmountAfter: paidAfterVnd,
        outstandingBefore: outBeforeVnd,
        outstandingAfter: outAfterVnd,
        statusAfter: outAfterVnd === 0 ? 'PAID' : 'PARTIALLY_PAID',
      });
    }
  }

  if (totalAllocatedVnd > paymentVnd) {
    throw new FinanceDomainError(
      errorCode,
      `Total allocations (${totalAllocatedVnd}) exceed confirmed payment amount (${paymentVnd})`,
      409,
    );
  }

  const overpaymentVnd = paymentVnd - totalAllocatedVnd;
  if (overpaymentVnd > 0 && overpaymentPolicy === 'REJECT') {
    throw new FinanceDomainError(
      errorCode,
      `Payment amount (${paymentVnd}) exceeds total allocated outstanding balance (${totalAllocatedVnd}) by ${overpaymentVnd}`,
      409,
      {
        paymentAmount: paymentVnd,
        totalAllocated: totalAllocatedVnd,
        overpaymentAmount: overpaymentVnd,
      },
    );
  }

  return {
    paymentAmount: paymentVnd,
    totalAllocated: totalAllocatedVnd,
    overpaymentAmount: overpaymentVnd,
    allocations,
  };
}

// ---- Refund Eligibility

export interface RefundEligibilityInput {
  originalPaidAmount: number;
  alreadyRefundedAmount: number;
  requestedRefundAmount: number;
}

export interface RefundEligibilityResult {
  originalPaidAmount: number;
  alreadyRefundedAmount: number;
  remainingRefundableBefore: number;
  requestedRefundAmount: number;
  remainingRefundableAfter: number;
}

export function validateRefundAllocation(
  input: RefundEligibilityInput,
): RefundEligibilityResult {
  const paidVnd = parseVnd(input.originalPaidAmount, {
    allowZero: false,
    field: 'originalPaidAmount',
  });
  const refundedVnd = parseVnd(input.alreadyRefundedAmount, {
    allowZero: true,
    field: 'alreadyRefundedAmount',
  });
  const reqVnd = parseVnd(input.requestedRefundAmount, {
    allowZero: false,
    field: 'requestedRefundAmount',
  });

  const remainingBefore = paidVnd > refundedVnd ? paidVnd - refundedVnd : 0;
  if (reqVnd > remainingBefore) {
    throw new FinanceDomainError(
      FinanceDomainErrorCode.REFUND_AMOUNT_EXCEEDED,
      `Requested refund (${reqVnd}) exceeds remaining refundable amount (${remainingBefore})`,
      409,
      {
        originalPaidAmount: paidVnd,
        alreadyRefundedAmount: refundedVnd,
        remainingRefundable: remainingBefore,
        requestedRefundAmount: reqVnd,
      },
    );
  }

  return {
    originalPaidAmount: paidVnd,
    alreadyRefundedAmount: refundedVnd,
    remainingRefundableBefore: remainingBefore,
    requestedRefundAmount: reqVnd,
    remainingRefundableAfter: remainingBefore - reqVnd,
  };
}

// ---- COD Settlement Line Evaluation

export interface CodSettlementLineEvaluationInput {
  expectedGrossCod: number;
  reportedGrossCod: number;
  carrierFee: number;
  reportedNetPayout: number;
}

export interface CodSettlementLineEvaluationResult {
  expectedGrossCod: number;
  reportedGrossCod: number;
  carrierFee: number;
  expectedNetPayout: number;
  reportedNetPayout: number;
  discrepancyAmount: number;
  status: 'MATCHED' | 'DISCREPANCY';
  discrepancyReason: string | null;
}

export function evaluateCodSettlementLine(
  input: CodSettlementLineEvaluationInput,
): CodSettlementLineEvaluationResult {
  const expectedGrossVnd = parseVnd(input.expectedGrossCod, {
    allowZero: false,
    field: 'expectedGrossCod',
  });
  const reportedGrossVnd = parseVnd(input.reportedGrossCod, {
    allowZero: true,
    field: 'reportedGrossCod',
  });
  const feeVnd = parseVnd(input.carrierFee, {
    allowZero: true,
    field: 'carrierFee',
  });
  const reportedNetVnd = parseVnd(input.reportedNetPayout, {
    allowZero: true,
    allowNegative: true,
    field: 'reportedNetPayout',
  });

  const expectedNetVnd = expectedGrossVnd - feeVnd;
  const discrepancyVnd = reportedNetVnd - expectedNetVnd;
  const reasons: string[] = [];

  if (reportedGrossVnd !== expectedGrossVnd) {
    reasons.push(
      `Reported COD (${reportedGrossVnd}) != expected COD (${expectedGrossVnd})`,
    );
  }
  if (reportedGrossVnd - feeVnd !== reportedNetVnd) {
    reasons.push(
      `Carrier statement math mismatch: reportedGross (${reportedGrossVnd}) - fee (${feeVnd}) != netPayout (${reportedNetVnd})`,
    );
  }
  if (discrepancyVnd !== 0 && reasons.length === 0) {
    reasons.push(`Net payout discrepancy of ${discrepancyVnd} VND`);
  }

  return {
    expectedGrossCod: expectedGrossVnd,
    reportedGrossCod: reportedGrossVnd,
    carrierFee: feeVnd,
    expectedNetPayout: expectedNetVnd,
    reportedNetPayout: reportedNetVnd,
    discrepancyAmount: discrepancyVnd,
    status: reasons.length === 0 ? 'MATCHED' : 'DISCREPANCY',
    discrepancyReason: reasons.length > 0 ? reasons.join('; ') : null,
  };
}

// ---- Shift Cash Reconciliation

export interface ShiftCashEvaluationInput {
  openingCash: number;
  confirmedCashSales: number;
  confirmedCashRefunds: number;
  otherCashReceipts?: number;
  otherCashExpenses?: number;
  actualCountedCash: number;
}

export interface ShiftCashEvaluationResult {
  openingCash: number;
  confirmedCashSales: number;
  confirmedCashRefunds: number;
  otherCashReceipts: number;
  otherCashExpenses: number;
  expectedClosingCash: number;
  actualCountedCash: number;
  varianceAmount: number;
  status: 'RECONCILED' | 'VARIANCE_DETECTED';
}

export function evaluateShiftCashReconciliation(
  input: ShiftCashEvaluationInput,
): ShiftCashEvaluationResult {
  const opening = parseVnd(input.openingCash, {
    allowZero: true,
    field: 'openingCash',
  });
  const sales = parseVnd(input.confirmedCashSales, {
    allowZero: true,
    field: 'confirmedCashSales',
  });
  const refunds = parseVnd(input.confirmedCashRefunds, {
    allowZero: true,
    field: 'confirmedCashRefunds',
  });
  const otherIn = parseVnd(input.otherCashReceipts ?? 0, {
    allowZero: true,
    field: 'otherCashReceipts',
  });
  const otherOut = parseVnd(input.otherCashExpenses ?? 0, {
    allowZero: true,
    field: 'otherCashExpenses',
  });
  const actual = parseVnd(input.actualCountedCash, {
    allowZero: true,
    field: 'actualCountedCash',
  });

  const expected = opening + sales - refunds + otherIn - otherOut;
  const variance = actual - expected;

  return {
    openingCash: opening,
    confirmedCashSales: sales,
    confirmedCashRefunds: refunds,
    otherCashReceipts: otherIn,
    otherCashExpenses: otherOut,
    expectedClosingCash: expected,
    actualCountedCash: actual,
    varianceAmount: variance,
    status: variance === 0 ? 'RECONCILED' : 'VARIANCE_DETECTED',
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
