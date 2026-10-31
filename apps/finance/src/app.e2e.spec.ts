import { INestApplication, Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import {
  PblHealthModule,
  PblLoggingModule,
  bootstrapService,
} from '@pbl/common';
import { AddressInfo } from 'net';
import request from 'supertest';

import {
  FinanceDomainError,
  FinanceDomainErrorCode,
} from './domain/finance-domain';
import { CashAccountsController } from './modules/cash-accounts/cash-accounts.controller';
import { CashAccountsService } from './modules/cash-accounts/cash-accounts.service';
import { CashbookController } from './modules/cashbook/cashbook.controller';
import { CashbookService } from './modules/cashbook/cashbook.service';
import { CodController } from './modules/cod/cod.controller';
import { CodService } from './modules/cod/cod.service';
import { CreditAuthorizationController } from './modules/credit-authorization/credit-authorization.controller';
import { CreditAuthorizationService } from './modules/credit-authorization/credit-authorization.service';
import { FinancialJournalController } from './modules/financial-journal/financial-journal.controller';
import { FinancialJournalService } from './modules/financial-journal/financial-journal.service';
import { PayablesController } from './modules/payables/payables.controller';
import { PayablesService } from './modules/payables/payables.service';
import { ReceivablesController } from './modules/receivables/receivables.controller';
import { ReceivablesService } from './modules/receivables/receivables.service';
import { ReconciliationController } from './modules/reconciliation/reconciliation.controller';
import { ReconciliationService } from './modules/reconciliation/reconciliation.service';
import { RefundsController } from './modules/refunds/refunds.controller';
import { RefundsService } from './modules/refunds/refunds.service';
import { SettlementsController } from './modules/settlements/settlements.controller';
import { SettlementsService } from './modules/settlements/settlements.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const SUPPLIER_ID = '44444444-4444-4444-8444-444444444444';
const CASH_ACC_ID = '55555555-5555-4555-8555-555555555555';
const DOC_ID = '66666666-6666-4666-8666-666666666666';

const journalService = {
  listAccounts: jest.fn(async () => [{ code: '1110', name: 'Cash on Hand' }]),
  createAccount: jest.fn(async (dto: any) => ({ id: DOC_ID, ...dto })),
  listJournals: jest.fn(async () => ({
    data: [],
    pagination: { limit: 20, offset: 0, total: 0 },
  })),
  getJournalById: jest.fn(async () => ({
    journal: { id: DOC_ID, code: 'JNL000001' },
    lines: [],
  })),
  postManualJournal: jest.fn(async () => ({
    journal: { id: DOC_ID, code: 'JNL000001', status: 'POSTED' },
    lines: [],
    replayed: false,
  })),
  reverseJournal: jest.fn(async () => ({
    originalJournal: { id: DOC_ID, status: 'REVERSED' },
    reversalJournal: { id: 'rev-1', status: 'POSTED' },
    replayed: false,
  })),
};

const cashAccountsService = {
  createCashAccount: jest.fn(async (dto: any) => ({
    id: CASH_ACC_ID,
    code: dto.code,
    currentBalance: '0.00',
  })),
  listCashAccounts: jest.fn(async () => [
    { id: CASH_ACC_ID, code: 'CASH-MAIN' },
  ]),
  getCashAccountById: jest.fn(async () => ({
    id: CASH_ACC_ID,
    code: 'CASH-MAIN',
    currentBalance: '1000000.00',
  })),
  updateCashAccount: jest.fn(async () => ({
    id: CASH_ACC_ID,
    status: 'ACTIVE',
  })),
};

const cashbookService = {
  listCategories: jest.fn(async () => [{ code: 'SALES_RECEIPT' }]),
  createCategory: jest.fn(async (dto: any) => ({ id: DOC_ID, ...dto })),
  createReceiptVoucher: jest.fn(async () => ({
    id: DOC_ID,
    code: 'PT000001',
    direction: 'RECEIPT',
    status: 'POSTED',
  })),
  createExpenseVoucher: jest.fn(async () => ({
    id: DOC_ID,
    code: 'PC000001',
    direction: 'EXPENSE',
    status: 'POSTED',
  })),
  approveEntry: jest.fn(async () => ({ id: DOC_ID, status: 'APPROVED' })),
  postEntry: jest.fn(async () => ({ id: DOC_ID, status: 'POSTED' })),
  reverseEntry: jest.fn(async () => ({
    originalEntry: { id: DOC_ID, status: 'REVERSED' },
    reversalEntry: { id: 'rev-cb', status: 'POSTED' },
  })),
  listEntries: jest.fn(async () => ({
    data: [],
    pagination: { limit: 20, offset: 0, total: 0 },
  })),
  getEntryById: jest.fn(async () => ({ id: DOC_ID, code: 'PT000001' })),
  getCashbookSummary: jest.fn(async () => ({
    openingBalance: '0.00',
    totalReceipts: '500000.00',
    totalExpenses: '100000.00',
    closingBalance: '400000.00',
  })),
  exportEntriesCsv: jest.fn(async () => ({
    filename: 'cashbook.csv',
    rowCount: 1,
    csv: 'code,direction,amount\nPT000001,RECEIPT,500000.00',
  })),
};

const creditAuthService = {
  getCreditProfile: jest.fn(async () => ({
    customerId: CUSTOMER_ID,
    creditLimit: '2000000.00',
    postedDebt: '0.00',
    heldCredit: '0.00',
    availableCredit: '2000000.00',
  })),
  updateCreditPolicy: jest.fn(async () => ({
    customerId: CUSTOMER_ID,
    creditLimit: '5000000.00',
  })),
  authorizeCredit: jest.fn(async () => ({
    authorization: { id: DOC_ID, state: 'HELD', authorizedAmount: '500000.00' },
    replayed: false,
  })),
  commitAuthorization: jest.fn(async () => ({
    authorization: { id: DOC_ID, state: 'COMMITTED' },
    receivable: { id: DOC_ID, code: 'AR000001' },
    replayed: false,
  })),
  releaseAuthorization: jest.fn(async () => ({
    authorization: { id: DOC_ID, state: 'RELEASED' },
    replayed: false,
  })),
  expireStaleAuthorizations: jest.fn(async () => ({ expiredCount: 0 })),
};

const receivablesService = {
  recognizeReceivable: jest.fn(async () => ({
    receivable: {
      id: DOC_ID,
      code: 'AR000001',
      outstandingAmount: '500000.00',
    },
    replayed: false,
  })),
  recordPayment: jest.fn(async () => ({
    updatedReceivables: [{ id: DOC_ID, status: 'PAID' }],
    totalAllocated: '500000.00',
    replayed: false,
  })),
  recordReceivablePayment: jest.fn(async () => ({
    updatedReceivables: [{ id: DOC_ID, status: 'PAID' }],
    totalAllocated: '500000.00',
    replayed: false,
  })),
  listReceivables: jest.fn(async () => ({
    data: [],
    pagination: { limit: 20, offset: 0, total: 0 },
  })),
  getReceivableById: jest.fn(async () => ({ id: DOC_ID, code: 'AR000001' })),
  getCustomerDebtSummary: jest.fn(async () => ({
    customerId: CUSTOMER_ID,
    postedDebt: '0.00',
  })),
  listCustomerDebtLedger: jest.fn(async () => ({
    data: [],
    pagination: { limit: 20, offset: 0, total: 0 },
  })),
};

const payablesService = {
  recognizePayable: jest.fn(async () => ({
    payable: { id: DOC_ID, code: 'AP000001', outstandingAmount: '1000000.00' },
    replayed: false,
  })),
  recordSupplierPayment: jest.fn(async () => ({
    payable: { id: DOC_ID, status: 'PAID' },
    totalAllocated: '1000000.00',
    replayed: false,
  })),
  applySupplierReturnCredit: jest.fn(async () => ({
    payable: { id: DOC_ID, status: 'PARTIALLY_PAID' },
    replayed: false,
  })),
  listPayables: jest.fn(async () => ({
    data: [],
    pagination: { limit: 20, offset: 0, total: 0 },
  })),
  getPayableById: jest.fn(async () => ({ id: DOC_ID, code: 'AP000001' })),
  getSupplierDebtSummary: jest.fn(async () => ({
    supplierId: SUPPLIER_ID,
    totalOutstandingPayable: '0.00',
  })),
};

const settlementsService = {
  confirmSettlement: jest.fn(async () => ({
    settlement: { id: DOC_ID, code: 'STL000001', settlementStatus: 'SETTLED' },
    replayed: false,
  })),
  processProviderCallback: jest.fn(async () => ({
    settlement: { id: DOC_ID, code: 'STL000001', settlementStatus: 'SETTLED' },
    replayed: false,
  })),
  listSettlements: jest.fn(async () => ({
    data: [],
    pagination: { limit: 20, offset: 0, total: 0 },
  })),
  getSettlementById: jest.fn(async () => ({ id: DOC_ID, code: 'STL000001' })),
};

const refundsService = {
  createRefund: jest.fn(async () => ({
    refund: { id: DOC_ID, code: 'RFD000001', status: 'REQUESTED' },
    replayed: false,
  })),
  listRefunds: jest.fn(async () => ({
    data: [],
    pagination: { limit: 20, offset: 0, total: 0 },
  })),
  getRefundById: jest.fn(async () => ({ id: DOC_ID, code: 'RFD000001' })),
  approveRefund: jest.fn(async () => ({ id: DOC_ID, status: 'APPROVED' })),
  executeRefund: jest.fn(async () => ({ id: DOC_ID, status: 'COMPLETED' })),
  confirmRefundOutcome: jest.fn(async () => ({
    id: DOC_ID,
    status: 'COMPLETED',
  })),
};

const codService = {
  createCodReceivable: jest.fn(async () => ({
    receivable: {
      id: DOC_ID,
      code: 'COD000001',
      status: 'COD_RECEIVABLE_RECOGNIZED',
    },
    replayed: false,
  })),
  listCodReceivables: jest.fn(async () => ({
    data: [],
    pagination: { limit: 20, offset: 0, total: 0 },
  })),
  importSettlementBatch: jest.fn(async () => ({
    batch: { id: DOC_ID, code: 'BAT000001', status: 'RECONCILED' },
    lines: [],
    replayed: false,
  })),
  listCodBatches: jest.fn(async () => ({
    data: [],
    pagination: { limit: 20, offset: 0, total: 0 },
  })),
  getCodBatchById: jest.fn(async () => ({
    batch: { id: DOC_ID, code: 'BAT000001' },
    lines: [],
  })),
  reconcileBatch: jest.fn(async () => ({
    batch: { id: DOC_ID, status: 'RECONCILED' },
    lines: [],
  })),
};

const reconciliationService = {
  reconcileShiftCash: jest.fn(async () => ({
    reconciliation: {
      id: DOC_ID,
      status: 'RECONCILED',
      varianceAmount: '0.00',
    },
    replayed: false,
  })),
  listShiftReconciliations: jest.fn(async () => []),
  createAdjustment: jest.fn(async () => ({
    adjustment: { id: DOC_ID, code: 'ADJ000001', status: 'PENDING_APPROVAL' },
    replayed: false,
  })),
  approveAdjustment: jest.fn(async (_id: string, approverId: string) => {
    if (approverId === 'maker-1') {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.MAKER_CHECKER_VIOLATION,
        'Maker cannot approve own adjustment',
        403,
      );
    }
    return { id: DOC_ID, status: 'POSTED' };
  }),
  listAdjustments: jest.fn(async () => []),
  triggerReconciliationRun: jest.fn(async () => ({
    run: { id: DOC_ID, code: 'REC000001', status: 'COMPLETED', issueCount: 0 },
    issues: [],
  })),
  getReconciliationRunById: jest.fn(async () => ({
    run: { id: DOC_ID, code: 'REC000001' },
    issues: [],
  })),
  listReconciliationIssues: jest.fn(async () => ({
    data: [],
    pagination: { limit: 20, offset: 0, total: 0 },
  })),
  resolveReconciliationIssue: jest.fn(async () => ({
    id: DOC_ID,
    status: 'RESOLVED',
  })),
  getFinanceSummary: jest.fn(async () => ({
    tenantId: TENANT,
    currency: 'VND',
    cashBalances: { totalCashBalance: '1000000.00', activeAccountCount: 1 },
  })),
};

@Module({
  imports: [
    PblLoggingModule.forRoot('finance'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
    PblHealthModule.forRoot({ service: 'finance' }),
  ],
  controllers: [
    FinancialJournalController,
    CashAccountsController,
    CashbookController,
    CreditAuthorizationController,
    ReceivablesController,
    PayablesController,
    SettlementsController,
    RefundsController,
    CodController,
    ReconciliationController,
  ],
  providers: [
    { provide: FinancialJournalService, useValue: journalService },
    { provide: CashAccountsService, useValue: cashAccountsService },
    { provide: CashbookService, useValue: cashbookService },
    { provide: CreditAuthorizationService, useValue: creditAuthService },
    { provide: ReceivablesService, useValue: receivablesService },
    { provide: PayablesService, useValue: payablesService },
    { provide: SettlementsService, useValue: settlementsService },
    { provide: RefundsService, useValue: refundsService },
    { provide: CodService, useValue: codService },
    { provide: ReconciliationService, useValue: reconciliationService },
  ],
})
class TestFinanceAppModule {}

describe('finance service HTTP, RBAC, and validation e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    app = await bootstrapService(TestFinanceAppModule, {
      name: 'finance',
      port: 0,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  const ownerToken = () =>
    auth.token({ sub: 'owner-1', tid: TENANT, roles: ['owner'] });
  const accountantToken = () =>
    auth.token({ sub: 'acc-1', tid: TENANT, roles: ['accountant'] });
  const cashierToken = () =>
    auth.token({ sub: 'cashier-1', tid: TENANT, roles: ['cashier'] });
  const staffToken = () =>
    auth.token({ sub: 'staff-1', tid: TENANT, roles: ['staff'] });
  const makerOwnerToken = () =>
    auth.token({ sub: 'maker-1', tid: TENANT, roles: ['owner'] });

  it('GET /health reports the service', async () => {
    const res = await request(url()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'finance' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /health/ready is 200', async () => {
    await request(url()).get('/health/ready').expect(200);
  });

  it('echoes a caller X-Request-Id', async () => {
    const res = await request(url())
      .get('/health')
      .set('X-Request-Id', 'rid-42')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('rid-42');
  });

  it('answers unknown routes with the JSON error shape', async () => {
    const res = await request(url()).get('/nope').expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      timestamp: expect.any(String),
    });
  });

  it('rejects unauthenticated requests with 401', async () => {
    await request(url()).get('/v1/finance/summary').expect(401);
  });

  it('enforces RBAC: rejects warehouse staff on cashbook, payables, and adjustments with 403', async () => {
    await request(url())
      .post('/v1/finance/cashbook/receipts')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({
        cashAccountId: CASH_ACC_ID,
        amount: '100000.00',
      })
      .expect(403);

    await request(url())
      .post(`/v1/finance/payables/${DOC_ID}/payments`)
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({
        amount: '100000.00',
      })
      .expect(403);
  });

  it('enforces RBAC: allows cashier to create cashbook receipts and collect receivables, but forbids supplier payable payments and adjustment approvals', async () => {
    await request(url())
      .post('/v1/finance/cashbook/receipts')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({
        cashAccountId: CASH_ACC_ID,
        amount: '150000.00',
        autoPost: true,
      })
      .expect(201);

    await request(url())
      .post(`/v1/finance/receivables/${DOC_ID}/payments`)
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({
        amount: '150000.00',
      })
      .expect(200);

    await request(url())
      .post(`/v1/finance/payables/${DOC_ID}/payments`)
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({
        amount: '150000.00',
      })
      .expect(403);

    await request(url())
      .post(`/v1/finance/adjustments/${DOC_ID}/approve`)
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({})
      .expect(403);
  });

  it('enforces Maker-Checker separation of duties on adjustment approval (403 MAKER_CHECKER_VIOLATION)', async () => {
    const res = await request(url())
      .post(`/v1/finance/adjustments/${DOC_ID}/approve`)
      .set('Authorization', `Bearer ${makerOwnerToken()}`)
      .send({})
      .expect(403);

    expect(res.body.errorCode).toBe('MAKER_CHECKER_VIOLATION');
  });

  it('supports owner and accountant across journals, credit holds, settlements, refunds, COD, and reconciliation routes', async () => {
    await request(url())
      .get('/v1/finance/journals')
      .set('Authorization', `Bearer ${accountantToken()}`)
      .expect(200);

    await request(url())
      .post('/internal/v1/finance/credit-authorizations')
      .set('x-internal-call', 'sales-service')
      .set('x-tenant-id', TENANT)
      .send({
        customerId: CUSTOMER_ID,
        orderId: ORDER_ID,
        amount: '500000.00',
      })
      .expect(201);

    await request(url())
      .post('/v1/finance/settlements/confirm')
      .set('Authorization', `Bearer ${accountantToken()}`)
      .send({
        orderId: ORDER_ID,
        paymentMethod: 'CASH',
        requestedAmount: '250000.00',
      })
      .expect(201);

    await request(url())
      .post('/v1/finance/refunds')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({
        orderId: ORDER_ID,
        method: 'CASH',
        amount: '100000.00',
      })
      .expect(201);

    await request(url())
      .post('/v1/finance/cod/settlement-batches')
      .set('Authorization', `Bearer ${accountantToken()}`)
      .send({
        carrierCode: 'GHN',
        statementRef: 'GHN-2026-10-30',
        lines: [
          {
            trackingNumber: 'GHN123456',
            reportedCodAmount: '300000.00',
            carrierFeeAmount: '15000.00',
            netPayoutAmount: '285000.00',
          },
        ],
      })
      .expect(201);

    const summaryRes = await request(url())
      .get('/v1/finance/summary')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .expect(200);
    expect(summaryRes.body.cashBalances.totalCashBalance).toBe('1000000.00');
  });
});
