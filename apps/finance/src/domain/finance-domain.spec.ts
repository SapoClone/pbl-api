import {
  assertMakerCheckerSeparation,
  calculateDocumentAllocations,
  evaluateCodSettlementLine,
  evaluateCreditAuthorization,
  evaluateShiftCashReconciliation,
  FinanceDomainError,
  FinanceDomainErrorCode,
  GL_ACCOUNT_CODES,
  maskBankAccountNumber,
  parseVnd,
  validateBalancedJournalLines,
  validateRefundAllocation,
} from './finance-domain';

describe('FinanceDomain (M5 pure financial invariants)', () => {
  describe('parseVnd', () => {
    it('accepts whole VND and does arithmetic without drift', () => {
      const a = parseVnd(500000);
      const b = parseVnd(300000);
      expect(a - b).toBe(200000);
      expect(parseVnd(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('rejects negative, zero (when disallowed), fractional, string and unsafe values', () => {
      expect(() => parseVnd(0)).toThrow(FinanceDomainError);
      expect(() => parseVnd(-100)).toThrow(FinanceDomainError);
      expect(() => parseVnd(100.5)).toThrow(FinanceDomainError);
      expect(() => parseVnd('100' as unknown as number)).toThrow(
        FinanceDomainError,
      );
      expect(() => parseVnd(Number.MAX_SAFE_INTEGER + 1)).toThrow(
        FinanceDomainError,
      );
      expect(parseVnd(0, { allowZero: true })).toBe(0);
    });
  });

  describe('validateBalancedJournalLines', () => {
    it('accepts a balanced 2-line cash sale journal', () => {
      const res = validateBalancedJournalLines([
        {
          accountCode: GL_ACCOUNT_CODES.CASH_ON_HAND,
          debitAmount: 500000,
        },
        {
          accountCode: GL_ACCOUNT_CODES.SALES_REVENUE_CLEARING,
          creditAmount: 500000,
        },
      ]);
      expect(res.totalDebit).toBe(500000);
      expect(res.totalCredit).toBe(500000);
      expect(res.lines).toHaveLength(2);
    });

    it('rejects unbalanced journal lines with JOURNAL_NOT_BALANCED', () => {
      expect(() =>
        validateBalancedJournalLines([
          {
            accountCode: GL_ACCOUNT_CODES.CASH_ON_HAND,
            debitAmount: 500000,
          },
          {
            accountCode: GL_ACCOUNT_CODES.SALES_REVENUE_CLEARING,
            creditAmount: 499999,
          },
        ]),
      ).toThrow(
        expect.objectContaining({
          code: FinanceDomainErrorCode.JOURNAL_NOT_BALANCED,
        }),
      );
    });

    it('rejects a journal with fewer than 2 lines or a line having both debit and credit', () => {
      expect(() =>
        validateBalancedJournalLines([
          {
            accountCode: GL_ACCOUNT_CODES.CASH_ON_HAND,
            debitAmount: 500000,
          },
        ]),
      ).toThrow(FinanceDomainError);

      expect(() =>
        validateBalancedJournalLines([
          {
            accountCode: GL_ACCOUNT_CODES.CASH_ON_HAND,
            debitAmount: 100,
            creditAmount: 100,
          },
          {
            accountCode: GL_ACCOUNT_CODES.SALES_REVENUE_CLEARING,
            creditAmount: 100,
          },
        ]),
      ).toThrow(FinanceDomainError);
    });
  });

  describe('evaluateCreditAuthorization', () => {
    it('calculates available credit as limit - postedDebt - heldCredit', () => {
      const res = evaluateCreditAuthorization({
        creditLimit: 2000000,
        postedDebt: 1000000,
        heldCredit: 200000,
        requestedAmount: 800000,
      });
      expect(res.availableCreditBefore).toBe(800000);
      expect(res.heldCreditAfter).toBe(1000000);
      expect(res.availableCreditAfter).toBe(0);
      expect(res.isOverride).toBe(false);
    });

    it('rejects credit request exceeding available credit when no override is provided', () => {
      expect(() =>
        evaluateCreditAuthorization({
          creditLimit: 2000000,
          postedDebt: 1000000,
          heldCredit: 300000,
          requestedAmount: 800000,
        }),
      ).toThrow(
        expect.objectContaining({
          code: FinanceDomainErrorCode.CUSTOMER_CREDIT_LIMIT_EXCEEDED,
        }),
      );
    });

    it('permits manager override when overrideApprovedBy is provided', () => {
      const res = evaluateCreditAuthorization({
        creditLimit: 2000000,
        postedDebt: 1500000,
        heldCredit: 0,
        requestedAmount: 800000,
        overrideApprovedBy: 'mgr-001',
        overrideReason: 'VIP wholesale customer',
      });
      expect(res.isOverride).toBe(true);
      expect(res.heldCreditAfter).toBe(800000);
    });
  });

  describe('calculateDocumentAllocations', () => {
    const openDocs = [
      {
        id: 'ar-1',
        code: 'AR000001',
        originalAmount: 300000,
        paidAmount: 0,
        adjustedAmount: 0,
        outstandingAmount: 300000,
      },
      {
        id: 'ar-2',
        code: 'AR000002',
        originalAmount: 400000,
        paidAmount: 0,
        adjustedAmount: 0,
        outstandingAmount: 400000,
      },
    ];

    it('allocates a single payment across multiple receivables (300k + 200k = 500k)', () => {
      const res = calculateDocumentAllocations(500000, openDocs);
      expect(res.totalAllocated).toBe(500000);
      expect(res.overpaymentAmount).toBe(0);
      expect(res.allocations).toEqual([
        {
          documentId: 'ar-1',
          code: 'AR000001',
          allocatedAmount: 300000,
          paidAmountAfter: 300000,
          outstandingBefore: 300000,
          outstandingAfter: 0,
          statusAfter: 'PAID',
        },
        {
          documentId: 'ar-2',
          code: 'AR000002',
          allocatedAmount: 200000,
          paidAmountAfter: 200000,
          outstandingBefore: 400000,
          outstandingAfter: 200000,
          statusAfter: 'PARTIALLY_PAID',
        },
      ]);
    });

    it('rejects allocation exceeding invoice outstanding amount', () => {
      expect(() =>
        calculateDocumentAllocations(400000, openDocs, [
          { documentId: 'ar-1', amount: 400000 },
        ]),
      ).toThrow(
        expect.objectContaining({
          code: FinanceDomainErrorCode.PAYMENT_ALLOCATION_EXCEEDED,
        }),
      );
    });

    it('records overpayment as prepayment when overpaymentPolicy is PREPAYMENT', () => {
      const res = calculateDocumentAllocations(800000, openDocs, undefined, {
        overpaymentPolicy: 'PREPAYMENT',
      });
      expect(res.totalAllocated).toBe(700000);
      expect(res.overpaymentAmount).toBe(100000);
    });
  });

  describe('validateRefundAllocation', () => {
    it('allows partial refunds up to original paid amount and rejects excess', () => {
      const ok = validateRefundAllocation({
        originalPaidAmount: 500000,
        alreadyRefundedAmount: 200000,
        requestedRefundAmount: 100000,
      });
      expect(ok.remainingRefundableAfter).toBe(200000);

      expect(() =>
        validateRefundAllocation({
          originalPaidAmount: 500000,
          alreadyRefundedAmount: 200000,
          requestedRefundAmount: 400000,
        }),
      ).toThrow(
        expect.objectContaining({
          code: FinanceDomainErrorCode.REFUND_AMOUNT_EXCEEDED,
        }),
      );
    });
  });

  describe('evaluateCodSettlementLine', () => {
    it('matches when expectedGrossCod == reportedGrossCod and reportedGross - fee == netPayout', () => {
      const matched = evaluateCodSettlementLine({
        expectedGrossCod: 750000,
        reportedGrossCod: 750000,
        carrierFee: 30000,
        reportedNetPayout: 720000,
      });
      expect(matched.status).toBe('MATCHED');
      expect(matched.discrepancyAmount).toBe(0);
    });

    it('detects discrepancy when carrier remits less than expected', () => {
      const mismatch = evaluateCodSettlementLine({
        expectedGrossCod: 750000,
        reportedGrossCod: 700000,
        carrierFee: 30000,
        reportedNetPayout: 670000,
      });
      expect(mismatch.status).toBe('DISCREPANCY');
      expect(mismatch.discrepancyAmount).toBe(-50000);
      expect(mismatch.discrepancyReason).toContain('700000');
    });
  });

  describe('evaluateShiftCashReconciliation & assertMakerCheckerSeparation', () => {
    it('calculates shift expected closing cash and variance accurately', () => {
      const shift = evaluateShiftCashReconciliation({
        openingCash: 1000000,
        confirmedCashSales: 3000000,
        confirmedCashRefunds: 200000,
        otherCashReceipts: 0,
        otherCashExpenses: 100000,
        actualCountedCash: 3650000,
      });
      expect(shift.expectedClosingCash).toBe(3700000);
      expect(shift.varianceAmount).toBe(-50000);
      expect(shift.status).toBe('VARIANCE_DETECTED');
    });

    it('enforces maker-checker separation and masks bank account numbers', () => {
      expect(() => assertMakerCheckerSeparation('user-1', 'user-1')).toThrow(
        expect.objectContaining({
          code: FinanceDomainErrorCode.MAKER_CHECKER_VIOLATION,
        }),
      );
      expect(() =>
        assertMakerCheckerSeparation('user-1', 'manager-2'),
      ).not.toThrow();
      expect(maskBankAccountNumber('19036677889900')).toBe('********9900');
    });
  });
});
