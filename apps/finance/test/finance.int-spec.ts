import { EventEnvelope, RequestContext } from '@pbl/common';
import {
  INVENTORY_PURCHASE_ORDER_APPROVED,
  INVENTORY_STOCK_RECEIVED,
} from '@pbl/contracts';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import {
  FinanceDomainError,
  FinanceDomainErrorCode,
} from '../src/domain/finance-domain';
import {
  CashbookEntryEntity,
  M5_FINANCE_ENTITIES,
  RefundOperationEntity,
} from '../src/infrastructure/persistence/finance.entities';
import { CreateM5FinanceCore1791900000200 } from '../src/migrations/1791900000200-create-m5-finance-core';
import { CashAccountsService } from '../src/modules/cash-accounts/cash-accounts.service';
import { CashbookService } from '../src/modules/cashbook/cashbook.service';
import { CodService } from '../src/modules/cod/cod.service';
import { CreditAuthorizationService } from '../src/modules/credit-authorization/credit-authorization.service';
import { FinancialJournalService } from '../src/modules/financial-journal/financial-journal.service';
import { PayablesService } from '../src/modules/payables/payables.service';
import { ReceivablesService } from '../src/modules/receivables/receivables.service';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation.service';
import { RefundsService } from '../src/modules/refunds/refunds.service';
import { SettlementsService } from '../src/modules/settlements/settlements.service';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const ACTOR_MAKER = '11111111-1111-4111-8111-111111111111';
const ACTOR_CHECKER = '22222222-2222-4222-8222-222222222222';

function runAsTenant<T>(
  tenantId: string,
  fn: () => Promise<T>,
  actorId = ACTOR_MAKER,
): Promise<T> {
  return RequestContext.run(
    {
      requestId: randomUUID(),
      tenantId,
      actor: { id: actorId, type: 'account' },
    },
    fn,
  );
}

describe('Finance M5 Core (Real PostgreSQL Integration, Concurrency & Fault-Injection Suite)', () => {
  const schema = uniqueSchema('finance_m5_it');
  let dataSource: DataSource;
  let outbox: EventOutbox;
  let journalService: FinancialJournalService;
  let cashAccountsService: CashAccountsService;
  let cashbookService: CashbookService;
  let creditAuthService: CreditAuthorizationService;
  let receivablesService: ReceivablesService;
  let payablesService: PayablesService;
  let settlementsService: SettlementsService;
  let refundsService: RefundsService;
  let codService: CodService;
  let reconciliationService: ReconciliationService;

  beforeAll(async () => {
    useDatabase(schema);
    dataSource = await initializeDatabase({
      ...databaseOptions({
        entities: [
          ...M5_FINANCE_ENTITIES,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateM5FinanceCore1791900000200,
        ],
      }),
    });

    outbox = new EventOutbox();
    journalService = new FinancialJournalService(dataSource);
    cashAccountsService = new CashAccountsService(dataSource);
    cashbookService = new CashbookService(dataSource, journalService, outbox);
    creditAuthService = new CreditAuthorizationService(
      dataSource,
      journalService,
      outbox,
    );
    receivablesService = new ReceivablesService(
      dataSource,
      journalService,
      cashAccountsService,
      cashbookService,
      creditAuthService,
      outbox,
    );
    payablesService = new PayablesService(
      dataSource,
      journalService,
      cashAccountsService,
      cashbookService,
      outbox,
    );
    settlementsService = new SettlementsService(
      dataSource,
      journalService,
      cashAccountsService,
      cashbookService,
      outbox,
    );
    refundsService = new RefundsService(
      dataSource,
      journalService,
      cashAccountsService,
      cashbookService,
      outbox,
    );
    codService = new CodService(
      dataSource,
      journalService,
      cashAccountsService,
      cashbookService,
      outbox,
    );
    reconciliationService = new ReconciliationService(
      dataSource,
      journalService,
      cashAccountsService,
      cashbookService,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('Test A: Concurrent customer debt payments prevent negative debt and over-collection', async () => {
    const customerId = randomUUID();
    const orderId = randomUUID();

    const recognized = await runAsTenant(TENANT_A, () =>
      receivablesService.recognizeReceivable(
        ACTOR_MAKER,
        `ar-test-a:${orderId}`,
        {
          customerId,
          orderId,
          branchId: BRANCH_A,
          amount: 1000000,
        },
        TENANT_A,
      ),
    );
    expect(recognized.outstandingAmount).toBe(1000000);

    const results = await Promise.allSettled([
      runAsTenant(TENANT_A, () =>
        receivablesService.recordReceivablePayment(
          recognized.id,
          null,
          ACTOR_MAKER,
          `pay-a-1:${randomUUID()}`,
          {
            amount: 700000,
            paymentMethod: 'CASH',
            overpaymentPolicy: 'REJECT',
          },
          TENANT_A,
        ),
      ),
      runAsTenant(TENANT_A, () =>
        receivablesService.recordReceivablePayment(
          recognized.id,
          null,
          ACTOR_CHECKER,
          `pay-a-2:${randomUUID()}`,
          {
            amount: 700000,
            paymentMethod: 'CASH',
            overpaymentPolicy: 'REJECT',
          },
          TENANT_A,
        ),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as FinanceDomainError).code).toBe(
      FinanceDomainErrorCode.PAYMENT_ALLOCATION_EXCEEDED,
    );

    const updated = await runAsTenant(TENANT_A, () =>
      receivablesService.getReceivableById(recognized.id, TENANT_A),
    );
    expect(updated.paidAmount).toBe(700000);
    expect(updated.outstandingAmount).toBe(300000);
    expect(updated.status).toBe('PARTIALLY_PAID');

    const summary = await runAsTenant(TENANT_A, () =>
      receivablesService.getCustomerDebtSummary(customerId, TENANT_A),
    );
    expect(summary.postedDebt).toBe(300000);
  });

  it('Test B: Concurrent credit-limit orders serialize under row lock and prevent credit limit breach', async () => {
    const customerId = randomUUID();

    // Default credit limit is 2,000,000 VND. Recognize 1,500,000 VND existing debt -> 500,000 VND available.
    await runAsTenant(TENANT_A, () =>
      receivablesService.recognizeReceivable(
        ACTOR_MAKER,
        `ar-test-b:${customerId}`,
        {
          customerId,
          orderId: randomUUID(),
          amount: 1500000,
        },
        TENANT_A,
      ),
    );

    const results = await Promise.allSettled([
      runAsTenant(TENANT_A, () =>
        creditAuthService.authorizeCredit(
          ACTOR_MAKER,
          `crd-b-1:${customerId}`,
          {
            customerId,
            orderId: randomUUID(),
            amount: 400000,
          },
          TENANT_A,
        ),
      ),
      runAsTenant(TENANT_A, () =>
        creditAuthService.authorizeCredit(
          ACTOR_CHECKER,
          `crd-b-2:${customerId}`,
          {
            customerId,
            orderId: randomUUID(),
            amount: 400000,
          },
          TENANT_A,
        ),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as FinanceDomainError).code).toBe(
      FinanceDomainErrorCode.CUSTOMER_CREDIT_LIMIT_EXCEEDED,
    );

    const profile = await runAsTenant(TENANT_A, () =>
      creditAuthService.getCreditProfile(customerId, TENANT_A),
    );
    expect(profile.creditLimit).toBe(2000000);
    expect(profile.postedDebt).toBe(1500000);
    expect(profile.heldCredit).toBe(400000);
    expect(profile.availableCredit).toBe(100000);
  });

  it('Test C & Test D: Duplicate cashbook voucher submission is idempotent and concurrent reversal executes once', async () => {
    const cashAcc = await runAsTenant(TENANT_A, () =>
      cashAccountsService.createCashAccount(
        {
          code: `DRAWER-CD-${randomUUID().slice(0, 6)}`,
          name: 'Test C/D Drawer',
          accountType: 'CASH_DRAWER',
          branchId: BRANCH_A,
        },
        TENANT_A,
      ),
    );

    const idemKey = `cb-dup-c:${randomUUID()}`;
    const concurrentPosts = await Promise.all(
      Array.from({ length: 10 }, () =>
        runAsTenant(TENANT_A, () =>
          cashbookService.createReceiptVoucher(
            ACTOR_MAKER,
            idemKey,
            {
              cashAccountId: cashAcc.id,
              branchId: BRANCH_A,
              categoryCode: 'OTHER_RECEIPT',
              amount: 250000,
              description: 'Idempotent cash receipt test',
              autoPost: true,
            },
            TENANT_A,
          ),
        ),
      ),
    );

    const uniqueIds = new Set(concurrentPosts.map((e) => e.id));
    expect(uniqueIds.size).toBe(1);
    const entryId = concurrentPosts[0].id;

    // Different payload with same idempotencyKey must fail with IDEMPOTENCY_CONFLICT
    await expect(
      runAsTenant(TENANT_A, () =>
        cashbookService.createReceiptVoucher(
          ACTOR_MAKER,
          idemKey,
          {
            cashAccountId: cashAcc.id,
            branchId: BRANCH_A,
            categoryCode: 'OTHER_RECEIPT',
            amount: 999999,
            autoPost: true,
          },
          TENANT_A,
        ),
      ),
    ).rejects.toMatchObject({
      code: FinanceDomainErrorCode.IDEMPOTENCY_CONFLICT,
    });

    const accAfterReceipt = await runAsTenant(TENANT_A, () =>
      cashAccountsService.getCashAccountById(cashAcc.id, TENANT_A),
    );
    expect(accAfterReceipt.currentBalance).toBe(250000);

    // Test D: Concurrent cashbook reversal
    const reversalResults = await Promise.allSettled([
      runAsTenant(TENANT_A, () =>
        cashbookService.reverseEntry(
          entryId,
          ACTOR_MAKER,
          `rev-d-1:${randomUUID()}`,
          { reason: 'Cashier entered wrong amount 1' },
          TENANT_A,
        ),
      ),
      runAsTenant(TENANT_A, () =>
        cashbookService.reverseEntry(
          entryId,
          ACTOR_CHECKER,
          `rev-d-2:${randomUUID()}`,
          { reason: 'Cashier entered wrong amount 2' },
          TENANT_A,
        ),
      ),
    ]);

    const fulfilledReversals = reversalResults.filter(
      (r): r is PromiseFulfilledResult<CashbookEntryEntity> =>
        r.status === 'fulfilled',
    );
    expect(fulfilledReversals.length).toBeGreaterThanOrEqual(1);
    const reversalIds = new Set(fulfilledReversals.map((r) => r.value.id));
    expect(reversalIds.size).toBe(1);

    const accAfterReversal = await runAsTenant(TENANT_A, () =>
      cashAccountsService.getCashAccountById(cashAcc.id, TENANT_A),
    );
    expect(accAfterReversal.currentBalance).toBe(0);
  });

  it('Test E: Duplicate receivable recognition for the same order creates only one receivable and one ledger row', async () => {
    const customerId = randomUUID();
    const orderId = randomUUID();

    const calls = await Promise.all(
      Array.from({ length: 5 }, () =>
        runAsTenant(TENANT_A, () =>
          receivablesService.recognizeReceivable(
            ACTOR_MAKER,
            `ar-dup-e:${orderId}`,
            {
              customerId,
              orderId,
              sourceType: 'SALES_ORDER',
              sourceId: orderId,
              amount: 450000,
            },
            TENANT_A,
          ),
        ),
      ),
    );

    const ids = new Set(calls.map((c) => c.id));
    expect(ids.size).toBe(1);

    const summary = await runAsTenant(TENANT_A, () =>
      receivablesService.getCustomerDebtSummary(customerId, TENANT_A),
    );
    expect(summary.postedDebt).toBe(450000);
    expect(summary.openReceivablesCount).toBe(1);
  });

  it('Test F & Test G: Duplicate supplier payable recognition across PO approved & stock received events deduplicates, and concurrent supplier payments prevent overpaying', async () => {
    const supplierId = randomUUID();
    const purchaseOrderId = randomUUID();
    const receiptId = randomUUID();
    const warehouseId = randomUUID();

    const poEnvelope: EventEnvelope<any> = {
      id: randomUUID(),
      type: INVENTORY_PURCHASE_ORDER_APPROVED.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT_A,
      actor: { id: ACTOR_MAKER, type: 'account' },
      traceId: randomUUID(),
      payload: {
        purchaseOrderId,
        code: 'PO000100',
        supplierId,
        warehouseId,
        totalAmount: 2000000,
        approvedAt: new Date().toISOString(),
      },
    };

    const stockEnvelope: EventEnvelope<any> = {
      id: randomUUID(),
      type: INVENTORY_STOCK_RECEIVED.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT_A,
      actor: { id: ACTOR_MAKER, type: 'account' },
      traceId: randomUUID(),
      payload: {
        receiptId,
        code: 'GR000100',
        warehouseId,
        sourceType: 'PURCHASE_ORDER',
        purchaseOrderId,
        supplierId,
        totalAmount: 2000000,
        postedAt: new Date().toISOString(),
      },
    };

    await Promise.all([
      runAsTenant(TENANT_A, () =>
        payablesService.onPurchaseOrderApproved(poEnvelope),
      ),
      runAsTenant(TENANT_A, () =>
        payablesService.onStockReceived(stockEnvelope),
      ),
      runAsTenant(TENANT_A, () =>
        payablesService.onPurchaseOrderApproved(poEnvelope),
      ),
    ]);

    const supplierSummaryBefore = await runAsTenant(TENANT_A, () =>
      payablesService.getSupplierDebtSummary(supplierId, TENANT_A),
    );
    expect(supplierSummaryBefore.totalOutstandingPayable).toBe(2000000);
    expect(supplierSummaryBefore.openPayablesCount).toBe(1);
    const payableId = supplierSummaryBefore.payables[0].id;

    // Test G: Two concurrent supplier payments of 1,500,000 VND each against 2,000,000 VND payable
    const payResults = await Promise.allSettled([
      runAsTenant(TENANT_A, () =>
        payablesService.recordSupplierPayment(
          payableId,
          ACTOR_MAKER,
          `ap-pay-g1:${randomUUID()}`,
          {
            amount: 1500000,
            paymentMethod: 'BANK_TRANSFER',
          },
          TENANT_A,
        ),
      ),
      runAsTenant(TENANT_A, () =>
        payablesService.recordSupplierPayment(
          payableId,
          ACTOR_CHECKER,
          `ap-pay-g2:${randomUUID()}`,
          {
            amount: 1500000,
            paymentMethod: 'BANK_TRANSFER',
          },
          TENANT_A,
        ),
      ),
    ]);

    const fulfilledPays = payResults.filter((r) => r.status === 'fulfilled');
    const rejectedPays = payResults.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(fulfilledPays).toHaveLength(1);
    expect(rejectedPays).toHaveLength(1);
    expect((rejectedPays[0].reason as FinanceDomainError).code).toBe(
      FinanceDomainErrorCode.SUPPLIER_PAYMENT_EXCEEDED,
    );

    // Apply supplier return credit of 200,000 VND on remaining 500,000 VND
    const afterCredit = await runAsTenant(TENANT_A, () =>
      payablesService.applySupplierReturnCredit(
        payableId,
        ACTOR_MAKER,
        `ap-ret:${purchaseOrderId}`,
        {
          returnRefId: `RET-${purchaseOrderId}`,
          amount: 200000,
          reason: 'Damaged cartons returned to supplier',
        },
        TENANT_A,
      ),
    );
    expect(afterCredit.payable.outstandingAmount).toBe(300000);
    expect(afterCredit.supplierTotalDebtAfter).toBe(300000);
  });

  it('Test H & Test I: Concurrent partial refunds enforce remaining refundable cap, and provider timeout recovers idempotently without double refunding', async () => {
    const orderId = randomUUID();

    // Settle order payment of 1,000,000 VND
    const settled = await runAsTenant(TENANT_A, () =>
      settlementsService.confirmSettlement(
        ACTOR_MAKER,
        `stl-h:${orderId}`,
        {
          orderId,
          branchId: BRANCH_A,
          tenderRef: `tender:${orderId}`,
          paymentMethod: 'EWALLET',
          provider: 'VNPAY',
          externalTxId: `VNP-${orderId}`,
          requestedAmount: 1000000,
          confirmedAmount: 1000000,
          settledAmount: 1000000,
        },
        TENANT_A,
      ),
    );
    expect(settled.settlement.settlementStatus).toBe('SETTLED');

    // Test H: Two concurrent refund requests of 600,000 VND each against 1,000,000 VND paid order
    const refundResults = await Promise.allSettled([
      runAsTenant(TENANT_A, () =>
        refundsService.createRefund(
          ACTOR_MAKER,
          `rf-h-1:${randomUUID()}`,
          {
            orderId,
            branchId: BRANCH_A,
            method: 'EWALLET',
            provider: 'VNPAY',
            amount: 600000,
            autoApprove: true,
          },
          TENANT_A,
        ),
      ),
      runAsTenant(TENANT_A, () =>
        refundsService.createRefund(
          ACTOR_CHECKER,
          `rf-h-2:${randomUUID()}`,
          {
            orderId,
            branchId: BRANCH_A,
            method: 'EWALLET',
            provider: 'VNPAY',
            amount: 600000,
            autoApprove: true,
          },
          TENANT_A,
        ),
      ),
    ]);

    const fulfilledRefunds = refundResults.filter(
      (
        r,
      ): r is PromiseFulfilledResult<{
        refund: RefundOperationEntity;
        replayed: boolean;
      }> => r.status === 'fulfilled',
    );
    const rejectedRefunds = refundResults.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilledRefunds).toHaveLength(1);
    expect(rejectedRefunds).toHaveLength(1);
    expect((rejectedRefunds[0].reason as FinanceDomainError).code).toBe(
      FinanceDomainErrorCode.REFUND_AMOUNT_EXCEEDED,
    );

    const winnerRefund = fulfilledRefunds[0].value.refund;
    const originalProviderKey = winnerRefund.providerIdempotencyKey;

    // Test I: Execute refund with simulated provider timeout -> enters PENDING_CONFIRMATION, never COMPLETED
    const timedOut = await runAsTenant(TENANT_A, () =>
      refundsService.executeRefund(
        winnerRefund.id,
        ACTOR_MAKER,
        {
          simulateProviderTimeout: true,
        },
        TENANT_A,
      ),
    );
    expect(timedOut.status).toBe('PENDING_CONFIRMATION');
    expect(timedOut.providerIdempotencyKey).toBe(originalProviderKey);
    expect(timedOut.journalId).toBeNull();

    // Later provider reconciliation confirms COMPLETED -> posts journal once and updates settlement.refundedAmount
    const confirmed = await runAsTenant(TENANT_A, () =>
      refundsService.confirmRefundOutcome(
        winnerRefund.id,
        ACTOR_CHECKER,
        {
          outcome: 'COMPLETED',
          externalRefundRef: `VNP-RF-${winnerRefund.code}`,
        },
        TENANT_A,
      ),
    );
    expect(confirmed.status).toBe('COMPLETED');
    expect(confirmed.providerIdempotencyKey).toBe(originalProviderKey);
    expect(confirmed.journalId).toBeTruthy();

    const updatedSettlement = await runAsTenant(TENANT_A, () =>
      settlementsService.getSettlementById(settled.settlement.id, TENANT_A),
    );
    expect(updatedSettlement.refundedAmount).toBe(600000);
  });

  it('Test J: Duplicate payment callback and duplicate settlement events are deduplicated', async () => {
    const orderId = randomUUID();
    const externalTxId = `MOMO-${randomUUID()}`;

    const callbacks = await Promise.all(
      Array.from({ length: 5 }, () =>
        runAsTenant(TENANT_A, () =>
          settlementsService.processProviderCallback(
            ACTOR_MAKER,
            undefined,
            {
              provider: 'MOMO',
              externalTxId,
              orderId,
              branchId: BRANCH_A,
              paymentMethod: 'EWALLET',
              confirmedAmount: 350000,
              requestedAmount: 350000,
              providerStatus: 'SETTLED',
            },
            TENANT_A,
          ),
        ),
      ),
    );

    const settlementIds = new Set(callbacks.map((c) => c.settlement.id));
    expect(settlementIds.size).toBe(1);
    expect(callbacks[0].settlement.settlementStatus).toBe('SETTLED');
    expect(callbacks[0].settlement.settledAmount).toBe(350000);
  });

  it('Test K & Test L: Duplicate COD settlement batch import deduplicates, and COD discrepancy creates reconciliation issue & emits event', async () => {
    const order1 = randomUUID();
    const order2 = randomUUID();
    const trackingMatched = `GHN-MATCH-${randomUUID().slice(0, 8)}`;
    const trackingShort = `GHN-SHORT-${randomUUID().slice(0, 8)}`;

    await runAsTenant(TENANT_A, () =>
      codService.createCodReceivable(
        ACTOR_MAKER,
        `cod-1:${trackingMatched}`,
        {
          orderId: order1,
          branchId: BRANCH_A,
          carrierCode: 'GHN',
          trackingNumber: trackingMatched,
          expectedCodAmount: 400000,
        },
        TENANT_A,
      ),
    );

    await runAsTenant(TENANT_A, () =>
      codService.createCodReceivable(
        ACTOR_MAKER,
        `cod-2:${trackingShort}`,
        {
          orderId: order2,
          branchId: BRANCH_A,
          carrierCode: 'GHN',
          trackingNumber: trackingShort,
          expectedCodAmount: 500000,
        },
        TENANT_A,
      ),
    );

    const statementRef = `GHN-STMT-${randomUUID().slice(0, 8)}`;
    const batchDto = {
      carrierCode: 'GHN',
      statementRef,
      autoReconcile: true,
      lines: [
        {
          trackingNumber: trackingMatched,
          reportedCodAmount: 400000,
          carrierFeeAmount: 15000,
          netPayoutAmount: 385000,
        },
        {
          trackingNumber: trackingShort,
          reportedCodAmount: 450000,
          carrierFeeAmount: 20000,
          netPayoutAmount: 430000,
        },
      ],
    };

    // Test K: Import same carrier batch 5 times concurrently
    const imports = await Promise.all(
      Array.from({ length: 5 }, () =>
        runAsTenant(TENANT_A, () =>
          codService.importSettlementBatch(
            ACTOR_MAKER,
            `codb:${statementRef}`,
            batchDto,
            TENANT_A,
          ),
        ),
      ),
    );

    const batchIds = new Set(imports.map((i) => i.batch.id));
    expect(batchIds.size).toBe(1);

    const batch = imports[0].batch;
    expect(batch.status).toBe('DISCREPANCY_DETECTED');
    expect(batch.matchedCount).toBe(1);
    expect(batch.discrepancyCount).toBe(1);
    expect(batch.journalId).toBeTruthy();

    const codList = await runAsTenant(TENANT_A, () =>
      codService.listCodReceivables({ carrierCode: 'GHN' }, TENANT_A),
    );
    const matchedCod = codList.data.find(
      (c) => c.trackingNumber === trackingMatched,
    )!;
    const discrepantCod = codList.data.find(
      (c) => c.trackingNumber === trackingShort,
    )!;
    expect(matchedCod.status).toBe('RECONCILED');
    expect(matchedCod.actualRemittedAmount).toBe(385000);
    expect(discrepantCod.status).toBe('DISCREPANCY');
    expect(discrepantCod.discrepancyAmount).toBe(-50000);
  });

  it('Test M: POS shift cash variance records shortage journal and reconciliation issue', async () => {
    const shiftId = randomUUID();

    const res = await runAsTenant(TENANT_A, () =>
      reconciliationService.reconcileShiftCash(
        ACTOR_MAKER,
        {
          shiftId,
          shiftCode: 'SH-2026-001',
          branchId: BRANCH_A,
          staffId: ACTOR_MAKER,
          openingCash: 1000000,
          confirmedCashSales: 4200000,
          confirmedCashRefunds: 200000,
          actualCountedCash: 4920000,
        },
        TENANT_A,
      ),
    );

    expect(res.reconciliation.expectedClosingCash).toBe(5000000);
    expect(res.reconciliation.actualCountedCash).toBe(4920000);
    expect(res.reconciliation.varianceAmount).toBe(-80000);
    expect(res.reconciliation.status).toBe('VARIANCE_DETECTED');
    expect(res.reconciliation.varianceJournalId).toBeTruthy();
    expect(res.reconciliation.reconciliationIssueId).toBeTruthy();
  });

  it('Test V: money is stored as bigint, round-trips as a number above 2^31, and rejects fractions', async () => {
    const supplierId = randomUUID();
    const big = 5_000_000_000;
    const ar = await runAsTenant(TENANT_A, () =>
      payablesService.recognizePayable(
        ACTOR_MAKER,
        `ap-big:${supplierId}`,
        { supplierId, amount: big },
        TENANT_A,
      ),
    );
    expect(ar.originalAmount).toBe(big);
    expect(ar.outstandingAmount).toBe(big);
    expect(ar.paidAmount + ar.adjustedAmount + ar.outstandingAmount).toBe(
      ar.originalAmount,
    );
    const reloaded = await runAsTenant(TENANT_A, () =>
      payablesService.getPayableById(ar.id, TENANT_A),
    );
    expect(typeof reloaded.originalAmount).toBe('number');
    expect(reloaded.originalAmount).toBe(big);

    const cols: Array<{ data_type: string }> = await dataSource.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'supplier_payables'
         AND column_name IN ('original_amount','paid_amount','outstanding_amount')`,
      [schema],
    );
    expect(cols).toHaveLength(3);
    expect(cols.every((c) => c.data_type === 'bigint')).toBe(true);

    await expect(
      runAsTenant(TENANT_A, () =>
        payablesService.recognizePayable(
          ACTOR_MAKER,
          `ap-frac:${supplierId}`,
          { supplierId, amount: 1000.5 },
          TENANT_A,
        ),
      ),
    ).rejects.toMatchObject({ httpStatus: 422 });
  });

  it('Test N: Tenant isolation & PostgreSQL RLS prevent cross-tenant reads and mutations', async () => {
    const tenantACustomerId = randomUUID();
    const arA = await runAsTenant(TENANT_A, () =>
      receivablesService.recognizeReceivable(
        ACTOR_MAKER,
        `ar-rls:${tenantACustomerId}`,
        {
          customerId: tenantACustomerId,
          orderId: randomUUID(),
          amount: 300000,
        },
        TENANT_A,
      ),
    );

    // Tenant B attempting to read or pay Tenant A's receivable must fail with 404
    await expect(
      runAsTenant(TENANT_B, () =>
        receivablesService.getReceivableById(arA.id, TENANT_B),
      ),
    ).rejects.toMatchObject({
      code: FinanceDomainErrorCode.RECEIVABLE_NOT_FOUND,
      httpStatus: 404,
    });

    await expect(
      runAsTenant(TENANT_B, () =>
        receivablesService.recordReceivablePayment(
          arA.id,
          null,
          ACTOR_MAKER,
          `pay-rls-b:${randomUUID()}`,
          {
            amount: 100000,
          },
          TENANT_B,
        ),
      ),
    ).rejects.toMatchObject({
      code: FinanceDomainErrorCode.RECEIVABLE_NOT_FOUND,
      httpStatus: 404,
    });

    const tenantBList = await runAsTenant(TENANT_B, () =>
      receivablesService.listReceivables({}, TENANT_B),
    );
    expect(tenantBList.data).toHaveLength(0);
  });

  it('Test O: Unbalanced journal rolls back cleanly and PostgreSQL immutability trigger blocks journal tampering', async () => {
    await expect(
      runAsTenant(TENANT_A, () =>
        journalService.postManualJournal(
          ACTOR_MAKER,
          `unbalanced:${randomUUID()}`,
          {
            journalType: 'MANUAL',
            sourceType: 'MANUAL_TEST',
            sourceId: randomUUID(),
            lines: [
              { accountCode: '1110', debitAmount: 500000 },
              { accountCode: '5110', creditAmount: 400000 },
            ],
          },
          TENANT_A,
        ),
      ),
    ).rejects.toMatchObject({
      code: FinanceDomainErrorCode.JOURNAL_NOT_BALANCED,
    });

    const validPosted = await runAsTenant(TENANT_A, () =>
      journalService.postManualJournal(
        ACTOR_MAKER,
        `valid-jnl:${randomUUID()}`,
        {
          journalType: 'MANUAL',
          sourceType: 'MANUAL_TEST',
          sourceId: randomUUID(),
          lines: [
            { accountCode: '1110', debitAmount: 500000 },
            { accountCode: '7110', creditAmount: 500000 },
          ],
        },
        TENANT_A,
      ),
    );

    // Direct SQL DELETE or monetary UPDATE on posted journal must be rejected by PostgreSQL trigger
    await expect(
      dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          TENANT_A,
        ]);
        await em.query(
          `DELETE FROM "${schema}"."financial_journals" WHERE "id" = $1`,
          [validPosted.journal.id],
        );
      }),
    ).rejects.toThrow(/Cannot delete posted financial journal/);

    await expect(
      dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          TENANT_A,
        ]);
        await em.query(
          `UPDATE "${schema}"."financial_journals" SET "total_debit" = 999999 WHERE "id" = $1`,
          [validPosted.journal.id],
        );
      }),
    ).rejects.toThrow(/Cannot mutate monetary or source fields/);
  });

  it('Test P: Multi-invoice FIFO debt collection with PREPAYMENT overpayment policy closes invoices and records prepayment without inflating sales revenue', async () => {
    const customerId = randomUUID();

    const inv1 = await runAsTenant(TENANT_A, () =>
      receivablesService.recognizeReceivable(
        ACTOR_MAKER,
        `ar-p-1:${customerId}`,
        {
          customerId,
          orderId: randomUUID(),
          amount: 300000,
        },
        TENANT_A,
      ),
    );
    const inv2 = await runAsTenant(TENANT_A, () =>
      receivablesService.recognizeReceivable(
        ACTOR_MAKER,
        `ar-p-2:${customerId}`,
        {
          customerId,
          orderId: randomUUID(),
          amount: 400000,
        },
        TENANT_A,
      ),
    );

    const paymentRes = await runAsTenant(TENANT_A, () =>
      receivablesService.recordReceivablePayment(
        null,
        customerId,
        ACTOR_MAKER,
        `pay-p-multi:${customerId}`,
        {
          amount: 800000,
          paymentMethod: 'BANK_TRANSFER',
          overpaymentPolicy: 'PREPAYMENT',
          allocations: [
            { receivableId: inv1.id, amount: 300000 },
            { receivableId: inv2.id, amount: 400000 },
          ],
        },
        TENANT_A,
      ),
    );

    expect(paymentRes.totalAllocated).toBe(700000);
    expect(paymentRes.overpaymentAmount).toBe(100000);
    expect(paymentRes.customerTotalDebtAfter).toBe(0);
    expect(paymentRes.prepaymentBalanceAfter).toBe(100000);

    // Verify journal lines do NOT credit 5110 Sales Revenue Clearing
    const jnl = await runAsTenant(TENANT_A, () =>
      journalService.getJournalById(paymentRes.journalId!, TENANT_A),
    );
    const accountCodes = jnl.lines.map((l) => l.accountCode);
    expect(accountCodes).toContain('1310'); // AR credited
    expect(accountCodes).toContain('3315'); // Prepayment credited
    expect(accountCodes).not.toContain('5110'); // Never double-counted as sales revenue
  });

  it('Test Q & Test R: Maker-Checker adjustments, Credit Hold commit/release/expiry, and Cross-Service Reconciliation Run', async () => {
    const customerId = randomUUID();
    const orderId = randomUUID();

    // Create and commit a credit hold -> atomically converts heldCredit to postedDebt
    const holdRes = await runAsTenant(TENANT_A, () =>
      creditAuthService.authorizeCredit(
        ACTOR_MAKER,
        `crd-q-1:${orderId}`,
        {
          customerId,
          orderId,
          amount: 500000,
        },
        TENANT_A,
      ),
    );
    expect(holdRes.state).toBe('HELD');

    const committed = await runAsTenant(TENANT_A, () =>
      creditAuthService.commitAuthorization(
        holdRes.authorizationId,
        ACTOR_MAKER,
        { orderId },
        TENANT_A,
      ),
    );
    expect(committed.state).toBe('COMMITTED');

    // Create a second hold with 1s TTL and expire it
    const expiringHold = await runAsTenant(TENANT_A, () =>
      creditAuthService.authorizeCredit(
        ACTOR_MAKER,
        `crd-q-exp:${randomUUID()}`,
        {
          customerId,
          orderId: randomUUID(),
          amount: 200000,
          ttlSeconds: 1,
        },
        TENANT_A,
      ),
    );
    await new Promise((r) => setTimeout(r, 1100));
    const expireRes = await runAsTenant(TENANT_A, () =>
      creditAuthService.expireStaleAuthorizations(TENANT_A),
    );
    expect(expireRes.expiredCount).toBeGreaterThanOrEqual(1);
    const profileAfterExpire = await runAsTenant(TENANT_A, () =>
      creditAuthService.getCreditProfile(customerId, TENANT_A),
    );
    expect(profileAfterExpire.heldCredit).toBe(0);
    expect(profileAfterExpire.postedDebt).toBe(500000);
    expect(expiringHold.authorizationId).toBeTruthy();

    // Maker-Checker financial adjustment
    const adjCreated = await runAsTenant(
      TENANT_A,
      () =>
        reconciliationService.createAdjustment(
          ACTOR_MAKER,
          `adj-q:${orderId}`,
          {
            adjustmentType: 'RECEIVABLE_WRITE_OFF',
            targetType: 'RECEIVABLE',
            targetId:
              committed.committedReceivableId ?? committed.authorizationId,
            amount: 50000,
            direction: 'DECREASE',
            reasonCode: 'ROUNDING_WRITE_OFF',
            explanation: 'Approved write-off adjustment',
          },
          TENANT_A,
        ),
      ACTOR_MAKER,
    );

    // Self-approval by maker must fail with MAKER_CHECKER_VIOLATION (403)
    await expect(
      runAsTenant(
        TENANT_A,
        () =>
          reconciliationService.approveAdjustment(
            adjCreated.adjustment.id,
            ACTOR_MAKER,
            TENANT_A,
          ),
        ACTOR_MAKER,
      ),
    ).rejects.toMatchObject({
      code: FinanceDomainErrorCode.MAKER_CHECKER_VIOLATION,
      httpStatus: 403,
    });

    // Approval by checker succeeds and posts journal
    const adjApproved = await runAsTenant(
      TENANT_A,
      () =>
        reconciliationService.approveAdjustment(
          adjCreated.adjustment.id,
          ACTOR_CHECKER,
          TENANT_A,
        ),
      ACTOR_CHECKER,
    );
    expect(adjApproved.status).toBe('POSTED');
    expect(adjApproved.journalId).toBeTruthy();

    // Test R: Ambiguous settlement detection & operational reconciliation run
    const ambiguousOrderId = randomUUID();
    const ambStl = await runAsTenant(TENANT_A, () =>
      settlementsService.confirmSettlement(
        ACTOR_MAKER,
        `stl-amb:${ambiguousOrderId}`,
        {
          orderId: ambiguousOrderId,
          branchId: BRANCH_A,
          tenderRef: `amb-tender:${ambiguousOrderId}`,
          paymentMethod: 'CARD',
          provider: 'NAPAS',
          requestedAmount: 600000,
          confirmedAmount: 550000,
          ambiguousOutcome: true,
        },
        TENANT_A,
      ),
    );
    expect(ambStl.settlement.settlementStatus).toBe('RECONCILIATION_REQUIRED');
    expect(ambStl.settlement.journalId).toBeNull();

    const reconRun = await runAsTenant(TENANT_A, () =>
      reconciliationService.triggerReconciliationRun(
        ACTOR_CHECKER,
        { reconciliationType: 'FULL_SYSTEM' },
        TENANT_A,
      ),
    );
    expect(reconRun.run.processedCount).toBeGreaterThan(0);
    expect(reconRun.issues.length).toBeGreaterThan(0);

    // Resolve an open issue and verify finance summary
    const issueToResolve = reconRun.issues[0];
    const resolvedIssue = await runAsTenant(TENANT_A, () =>
      reconciliationService.resolveReconciliationIssue(
        issueToResolve.id,
        ACTOR_CHECKER,
        {
          resolutionNote: 'Verified with gateway statement and resolved',
          status: 'RESOLVED',
        },
        TENANT_A,
      ),
    );
    expect(resolvedIssue.status).toBe('RESOLVED');

    const financeSummary = await runAsTenant(TENANT_A, () =>
      reconciliationService.getFinanceSummary(TENANT_A),
    );
    expect(financeSummary.tenantId).toBe(TENANT_A);
    expect(financeSummary.cashBalances.activeAccountCount).toBeGreaterThan(0);
  });
});
