import {
  assertMakerCheckerSeparation,
  calculateDocumentAllocations,
  evaluateCodSettlementLine,
  evaluateCreditAuthorization,
  evaluateShiftCashReconciliation,
  FinanceDomainError,
  FinanceDomainErrorCode,
  formatMoneyCents,
  GL_ACCOUNT_CODES,
  maskBankAccountNumber,
  parseMoneyCents,
  validateBalancedJournalLines,
  validateRefundAllocation,
} from './finance-domain';

describe('FinanceDomain (M5 pure financial invariants)', () => {
  describe('parseMoneyCents & formatMoneyCents', () => {
    it('parses and formats VND amounts with exact 2-decimal precision without floating-point drift', () => {
      const a = parseMoneyCents('500000');
      const b = parseMoneyCents('300000.50');
      expect(formatMoneyCents(a)).toBe('500000.00');
      expect(formatMoneyCents(b)).toBe('300000.50');
      expect(formatMoneyCents(a - b)).toBe('199999.50');
    });

    it('rejects negative, zero (when disallowed), or >2 decimal places', () => {
      expect(() => parseMoneyCents('0.00')).toThrow(FinanceDomainError);
      expect(() => parseMoneyCents('-100.00')).toThrow(FinanceDomainError);
      expect(() => parseMoneyCents('100.123')).toThrow(FinanceDomainError);
    });
  });

  describe('validateBalancedJournalLines', () => {
    it('accepts a balanced 2-line cash sale journal', () => {
      const res = validateBalancedJournalLines([
        {
          accountCode: GL_ACCOUNT_CODES.CASH_ON_HAND,
          debitAmount: '500000.00',
        },
        {
          accountCode: GL_ACCOUNT_CODES.SALES_REVENUE_CLEARING,
          creditAmount: '500000.00',
        },
      ]);
      expect(res.totalDebit).toBe('500000.00');
      expect(res.totalCredit).toBe('500000.00');
      expect(res.lines).toHaveLength(2);
    });

    it('rejects unbalanced journal lines with JOURNAL_NOT_BALANCED', () => {
      expect(() =>
        validateBalancedJournalLines([
          {
            accountCode: GL_ACCOUNT_CODES.CASH_ON_HAND,
            debitAmount: '500000.00',
          },
          {
            accountCode: GL_ACCOUNT_CODES.SALES_REVENUE_CLEARING,
            creditAmount: '499999.00',
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
            debitAmount: '500000.00',
          },
        ]),
      ).toThrow(FinanceDomainError);

      expect(() =>
        validateBalancedJournalLines([
          {
            accountCode: GL_ACCOUNT_CODES.CASH_ON_HAND,
            debitAmount: '100.00',
            creditAmount: '100.00',
          },
          {
            accountCode: GL_ACCOUNT_CODES.SALES_REVENUE_CLEARING,
            creditAmount: '100.00',
          },
        ]),
      ).toThrow(FinanceDomainError);
    });
  });

  describe('evaluateCreditAuthorization', () => {
    it('calculates available credit as limit - postedDebt - heldCredit', () => {
      const res = evaluateCreditAuthorization({
        creditLimit: '2000000.00',
        postedDebt: '1000000.00',
        heldCredit: '200000.00',
        requestedAmount: '800000.00',
      });
      expect(res.availableCreditBefore).toBe('800000.00');
      expect(res.heldCreditAfter).toBe('1000000.00');
      expect(res.availableCreditAfter).toBe('0.00');
      expect(res.isOverride).toBe(false);
    });

    it('rejects credit request exceeding available credit when no override is provided', () => {
      expect(() =>
        evaluateCreditAuthorization({
          creditLimit: '2000000.00',
          postedDebt: '1000000.00',
          heldCredit: '300000.00',
          requestedAmount: '800000.00',
        }),
      ).toThrow(
        expect.objectContaining({
          code: FinanceDomainErrorCode.CUSTOMER_CREDIT_LIMIT_EXCEEDED,
        }),
      );
    });

    it('permits manager override when overrideApprovedBy is provided', () => {
      const res = evaluateCreditAuthorization({
        creditLimit: '2000000.00',
        postedDebt: '1500000.00',
        heldCredit: '0.00',
        requestedAmount: '800000.00',
        overrideApprovedBy: 'mgr-001',
        overrideReason: 'VIP wholesale customer',
      });
      expect(res.isOverride).toBe(true);
      expect(res.heldCreditAfter).toBe('800000.00');
    });
  });

  describe('calculateDocumentAllocations', () => {
    const openDocs = [
      {
        id: 'ar-1',
        code: 'AR000001',
        originalAmount: '300000.00',
        paidAmount: '0.00',
        adjustedAmount: '0.00',
        outstandingAmount: '300000.00',
      },
      {
        id: 'ar-2',
        code: 'AR000002',
        originalAmount: '400000.00',
        paidAmount: '0.00',
        adjustedAmount: '0.00',
        outstandingAmount: '400000.00',
      },
    ];

    it('allocates a single payment across multiple receivables (300k + 200k = 500k)', () => {
      const res = calculateDocumentAllocations('500000.00', openDocs);
      expect(res.totalAllocated).toBe('500000.00');
      expect(res.overpaymentAmount).toBe('0.00');
      expect(res.allocations).toEqual([
        {
          documentId: 'ar-1',
          code: 'AR000001',
          allocatedAmount: '300000.00',
          paidAmountAfter: '300000.00',
          outstandingBefore: '300000.00',
          outstandingAfter: '0.00',
          statusAfter: 'PAID',
        },
        {
          documentId: 'ar-2',
          code: 'AR000002',
          allocatedAmount: '200000.00',
          paidAmountAfter: '200000.00',
          outstandingBefore: '400000.00',
          outstandingAfter: '200000.00',
          statusAfter: 'PARTIALLY_PAID',
        },
      ]);
    });

    it('rejects allocation exceeding invoice outstanding amount', () => {
      expect(() =>
        calculateDocumentAllocations('400000.00', openDocs, [
          { documentId: 'ar-1', amount: '400000.00' },
        ]),
      ).toThrow(
        expect.objectContaining({
          code: FinanceDomainErrorCode.PAYMENT_ALLOCATION_EXCEEDED,
        }),
      );
    });

    it('records overpayment as prepayment when overpaymentPolicy is PREPAYMENT', () => {
      const res = calculateDocumentAllocations(
        '800000.00',
        openDocs,
        undefined,
        { overpaymentPolicy: 'PREPAYMENT' },
      );
      expect(res.totalAllocated).toBe('700000.00');
      expect(res.overpaymentAmount).toBe('100000.00');
    });
  });

  describe('validateRefundAllocation', () => {
    it('allows partial refunds up to original paid amount and rejects excess', () => {
      const ok = validateRefundAllocation({
        originalPaidAmount: '500000.00',
        alreadyRefundedAmount: '200000.00',
        requestedRefundAmount: '100000.00',
      });
      expect(ok.remainingRefundableAfter).toBe('200000.00');

      expect(() =>
        validateRefundAllocation({
          originalPaidAmount: '500000.00',
          alreadyRefundedAmount: '200000.00',
          requestedRefundAmount: '400000.00',
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
        expectedGrossCod: '750000.00',
        reportedGrossCod: '750000.00',
        carrierFee: '30000.00',
        reportedNetPayout: '720000.00',
      });
      expect(matched.status).toBe('MATCHED');
      expect(matched.discrepancyAmount).toBe('0.00');
    });

    it('detects discrepancy when carrier remits less than expected', () => {
      const mismatch = evaluateCodSettlementLine({
        expectedGrossCod: '750000.00',
        reportedGrossCod: '700000.00',
        carrierFee: '30000.00',
        reportedNetPayout: '670000.00',
      });
      expect(mismatch.status).toBe('DISCREPANCY');
      expect(mismatch.discrepancyAmount).toBe('-50000.00');
      expect(mismatch.discrepancyReason).toContain('700000.00');
    });
  });

  describe('evaluateShiftCashReconciliation & assertMakerCheckerSeparation', () => {
    it('calculates shift expected closing cash and variance accurately', () => {
      const shift = evaluateShiftCashReconciliation({
        openingCash: '1000000.00',
        confirmedCashSales: '3000000.00',
        confirmedCashRefunds: '200000.00',
        otherCashReceipts: '0.00',
        otherCashExpenses: '100000.00',
        actualCountedCash: '3650000.00',
      });
      expect(shift.expectedClosingCash).toBe('3700000.00');
      expect(shift.varianceAmount).toBe('-50000.00');
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
