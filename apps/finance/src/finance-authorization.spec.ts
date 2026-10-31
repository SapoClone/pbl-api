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
const ID = '66666666-6666-4666-8666-666666666666';
const BRANCH_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRANCH_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** The branch every stored row reports in these tests. */
let rowBranch: string | null = null;

/** A service whose every method resolves to a generic row (and is spy-able). */
function fakeService(): Record<string, jest.Mock> {
  const methods = new Map<string, jest.Mock>();
  return new Proxy({} as Record<string, jest.Mock>, {
    get(_target, name: string) {
      if (typeof name !== 'string' || name === 'then') {
        return undefined;
      }
      if (!methods.has(name)) {
        methods.set(
          name,
          jest.fn(async () => ({
            id: ID,
            branchId: rowBranch,
            data: [],
            lines: [],
            cashBalances: {},
          })),
        );
      }
      return methods.get(name);
    },
  });
}

const services = {
  journal: fakeService(),
  cashAccounts: fakeService(),
  cashbook: fakeService(),
  credit: fakeService(),
  receivables: fakeService(),
  payables: fakeService(),
  settlements: fakeService(),
  refunds: fakeService(),
  cod: fakeService(),
  reconciliation: fakeService(),
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
    { provide: FinancialJournalService, useValue: services.journal },
    { provide: CashAccountsService, useValue: services.cashAccounts },
    { provide: CashbookService, useValue: services.cashbook },
    { provide: CreditAuthorizationService, useValue: services.credit },
    { provide: ReceivablesService, useValue: services.receivables },
    { provide: PayablesService, useValue: services.payables },
    { provide: SettlementsService, useValue: services.settlements },
    { provide: RefundsService, useValue: services.refunds },
    { provide: CodService, useValue: services.cod },
    { provide: ReconciliationService, useValue: services.reconciliation },
  ],
})
class TestAppModule {}

type Method = 'get' | 'post' | 'put' | 'patch';
const V = 'finance.view';
const C = 'finance.create';
const U = 'finance.update';
const A = 'finance.approve';
const ALL = [V, C, U, A];

/** Every JWT-protected route of the service and the permission it needs. */
const ROUTES: Array<[Method, string, string]> = [
  // cashbook
  ['get', '/v1/finance/cashbook/categories', V],
  ['post', '/v1/finance/cashbook/categories', C],
  ['post', '/v1/finance/cashbook/receipts', C],
  ['post', '/v1/finance/cashbook/expenses', C],
  ['get', '/v1/finance/cashbook/entries', V],
  ['get', '/v1/finance/cashbook/export', V],
  ['get', `/v1/finance/cashbook/entries/${ID}`, V],
  ['post', `/v1/finance/cashbook/entries/${ID}/approve`, A],
  ['post', `/v1/finance/cashbook/entries/${ID}/post`, A],
  ['post', `/v1/finance/cashbook/entries/${ID}/reverse`, A],
  // cash accounts
  ['post', '/v1/finance/cash-accounts', C],
  ['get', '/v1/finance/cash-accounts', V],
  ['get', `/v1/finance/cash-accounts/${ID}`, V],
  ['patch', `/v1/finance/cash-accounts/${ID}`, U],
  // journal
  ['get', '/v1/finance/accounts', V],
  ['post', '/v1/finance/accounts', C],
  ['get', '/v1/finance/journals', V],
  ['get', `/v1/finance/journals/${ID}`, V],
  ['post', '/v1/finance/journals', A],
  ['post', `/v1/finance/journals/${ID}/reverse`, A],
  // payables
  ['post', '/v1/finance/payables', C],
  ['get', '/v1/finance/payables', V],
  ['get', `/v1/finance/payables/${ID}`, V],
  ['get', `/v1/finance/suppliers/${ID}/debt`, V],
  ['post', `/v1/finance/payables/${ID}/payments`, C],
  ['post', `/v1/finance/payables/${ID}/return-credits`, U],
  // receivables
  ['post', '/v1/finance/receivables', C],
  ['get', '/v1/finance/receivables', V],
  ['get', `/v1/finance/receivables/${ID}`, V],
  ['get', `/v1/finance/customers/${ID}/debt`, V],
  ['post', `/v1/finance/receivables/${ID}/payments`, C],
  ['post', `/v1/finance/customers/${ID}/debt/payments`, C],
  // credit (member-facing)
  ['get', `/v1/finance/customers/${ID}/credit-profile`, V],
  ['put', `/v1/finance/customers/${ID}/credit-limit`, A],
  // refunds
  ['post', '/v1/finance/refunds', C],
  ['get', '/v1/finance/refunds', V],
  ['get', `/v1/finance/refunds/${ID}`, V],
  ['post', `/v1/finance/refunds/${ID}/approve`, A],
  ['post', `/v1/finance/refunds/${ID}/execute`, A],
  ['post', `/v1/finance/refunds/${ID}/confirm-outcome`, A],
  // settlements
  ['post', '/v1/finance/settlements/confirm', U],
  ['post', '/v1/finance/settlements/webhooks/provider-callback', U],
  ['get', '/v1/finance/settlements', V],
  ['get', `/v1/finance/settlements/${ID}`, V],
  // cod
  ['post', '/v1/finance/cod/receivables', C],
  ['get', '/v1/finance/cod/receivables', V],
  ['post', '/v1/finance/cod/settlement-batches', C],
  ['get', '/v1/finance/cod/settlement-batches', V],
  ['get', `/v1/finance/cod/settlement-batches/${ID}`, V],
  ['post', `/v1/finance/cod/settlement-batches/${ID}/reconcile`, A],
  // reconciliation, adjustments, summary
  ['post', '/v1/finance/shifts/reconcile', A],
  ['get', '/v1/finance/shifts/reconciliations', V],
  ['post', '/v1/finance/adjustments', C],
  ['post', `/v1/finance/adjustments/${ID}/approve`, A],
  ['get', '/v1/finance/adjustments', V],
  ['post', '/v1/finance/settlements/reconciliation-runs', A],
  ['get', `/v1/finance/settlements/reconciliation-runs/${ID}`, V],
  ['get', '/v1/finance/reconciliation-issues', V],
  ['post', `/v1/finance/reconciliation-issues/${ID}/resolve`, A],
  ['get', '/v1/finance/summary', V],
];

describe('finance authorization: permissions, branch scope, internal routes', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    app = await bootstrapService(TestAppModule, { name: 'finance', port: 0 });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    rowBranch = null;
    jest.clearAllMocks();
  });

  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const bearer = (permissions: string[], branches?: string[]) =>
    auth.bearerWithPermissions('custom', permissions, TENANT, branches);
  const owner = () => auth.bearer(['owner'], TENANT);
  const call = (method: Method, path: string, authorization: string) =>
    request(url())
      [method](path)
      .set('Authorization', authorization)
      .send(method === 'get' ? undefined : {});

  it('covers the 60 token routes of the service', () => {
    expect(ROUTES).toHaveLength(60);
  });

  describe.each(ROUTES)('%s %s needs %s', (method, path, code) => {
    it('allows the exact permission', async () => {
      const res = await call(method, path, bearer([code]));
      expect([401, 403, 404]).not.toContain(res.status);
    });

    it('answers 403 to every other finance permission and to none', async () => {
      const others = ALL.filter((c) => c !== code);
      expect((await call(method, path, bearer(others))).status).toBe(403);
      expect((await call(method, path, bearer(['orders.view']))).status).toBe(
        403,
      );
    });

    it('lets the owner through', async () => {
      const res = await call(method, path, owner());
      expect([401, 403, 404]).not.toContain(res.status);
    });
  });

  describe('branch scope', () => {
    const restricted = () => bearer(ALL, [BRANCH_A]);

    it('a list without a branch filter is limited to the allowed branches', async () => {
      await call('get', '/v1/finance/cash-accounts', restricted()).expect(200);
      expect(services.cashAccounts.listCashAccounts.mock.calls[0][2]).toEqual([
        BRANCH_A,
      ]);
      await call('get', '/v1/finance/cashbook/entries', restricted());
      expect(services.cashbook.listEntries.mock.calls[0][2]).toEqual([
        BRANCH_A,
      ]);
      await call('get', '/v1/finance/journals', restricted());
      expect(services.journal.listJournals.mock.calls[0][2]).toEqual([
        BRANCH_A,
      ]);
      await call('get', '/v1/finance/receivables', restricted());
      expect(services.receivables.listReceivables.mock.calls[0][2]).toEqual([
        BRANCH_A,
      ]);
      await call('get', '/v1/finance/refunds', restricted());
      expect(services.refunds.listRefunds.mock.calls[0][2]).toEqual([BRANCH_A]);
      await call('get', '/v1/finance/settlements', restricted());
      expect(services.settlements.listSettlements.mock.calls[0][2]).toEqual([
        BRANCH_A,
      ]);
      await call('get', '/v1/finance/cod/receivables', restricted());
      expect(services.cod.listCodReceivables.mock.calls[0][2]).toEqual([
        BRANCH_A,
      ]);
      await call('get', '/v1/finance/shifts/reconciliations', restricted());
      expect(
        services.reconciliation.listShiftReconciliations.mock.calls[0][2],
      ).toEqual([BRANCH_A]);
      await call('get', '/v1/finance/summary', restricted());
      expect(
        services.reconciliation.getFinanceSummary.mock.calls[0][1],
      ).toEqual([BRANCH_A]);
    });

    it('the owner and an unrestricted member see every branch (scope null)', async () => {
      await call('get', '/v1/finance/cash-accounts', owner()).expect(200);
      await call('get', '/v1/finance/journals', bearer(ALL)).expect(200);
      expect(
        services.cashAccounts.listCashAccounts.mock.calls[0][2],
      ).toBeNull();
      expect(services.journal.listJournals.mock.calls[0][2]).toBeNull();
    });

    it('a list naming a foreign branch answers 404', async () => {
      for (const path of [
        '/v1/finance/cash-accounts',
        '/v1/finance/cashbook/entries',
        '/v1/finance/cashbook/export',
        '/v1/finance/journals',
        '/v1/finance/shifts/reconciliations',
      ]) {
        await call('get', `${path}?branchId=${BRANCH_B}`, restricted()).expect(
          404,
        );
      }
      await call(
        'get',
        `/v1/finance/cash-accounts?branchId=${BRANCH_A}`,
        restricted(),
      ).expect(200);
    });

    it('a row of a foreign branch answers 404, also for its mutations', async () => {
      rowBranch = BRANCH_B;
      for (const [method, path] of [
        ['get', `/v1/finance/cash-accounts/${ID}`],
        ['patch', `/v1/finance/cash-accounts/${ID}`],
        ['get', `/v1/finance/cashbook/entries/${ID}`],
        ['post', `/v1/finance/cashbook/entries/${ID}/approve`],
        ['post', `/v1/finance/cashbook/entries/${ID}/post`],
        ['post', `/v1/finance/cashbook/entries/${ID}/reverse`],
        ['get', `/v1/finance/journals/${ID}`],
        ['post', `/v1/finance/journals/${ID}/reverse`],
        ['get', `/v1/finance/receivables/${ID}`],
        ['get', `/v1/finance/refunds/${ID}`],
        ['post', `/v1/finance/refunds/${ID}/approve`],
        ['post', `/v1/finance/refunds/${ID}/execute`],
        ['post', `/v1/finance/refunds/${ID}/confirm-outcome`],
        ['get', `/v1/finance/settlements/${ID}`],
      ] as Array<[Method, string]>) {
        const res = await request(url())
          [method](path)
          .set('Authorization', restricted())
          .send(
            method === 'get'
              ? undefined
              : { reason: 'test', outcome: 'COMPLETED' },
          );
        expect([method, path, res.status]).toEqual([method, path, 404]);
      }
      expect(services.cashbook.approveEntry).not.toHaveBeenCalled();
      expect(services.refunds.approveRefund).not.toHaveBeenCalled();
      expect(services.journal.reverseJournal).not.toHaveBeenCalled();
      // the owner is never restricted
      await call('get', `/v1/finance/cash-accounts/${ID}`, owner()).expect(200);
    });

    it('a row of an allowed branch is served; a store-wide row (no branch) only to unrestricted members', async () => {
      rowBranch = BRANCH_A;
      await call('get', `/v1/finance/refunds/${ID}`, restricted()).expect(200);
      rowBranch = null;
      await call('get', `/v1/finance/refunds/${ID}`, restricted()).expect(404);
      await call('get', `/v1/finance/refunds/${ID}`, bearer(ALL)).expect(200);
    });

    it('a body naming a foreign branch answers 404 and writes nothing', async () => {
      const voucher = {
        cashAccountId: ID,
        amount: '1000.00',
        branchId: BRANCH_B,
      };
      await request(url())
        .post('/v1/finance/cashbook/receipts')
        .set('Authorization', restricted())
        .send(voucher)
        .expect(404);
      await request(url())
        .post('/v1/finance/cash-accounts')
        .set('Authorization', restricted())
        .send({ code: 'CASH-B', name: 'Drawer B', branchId: BRANCH_B })
        .expect(404);
      await request(url())
        .post('/v1/finance/shifts/reconcile')
        .set('Authorization', restricted())
        .send({
          shiftId: ID,
          branchId: BRANCH_B,
          openingCash: '0.00',
          confirmedCashSales: '0.00',
          actualCountedCash: '0.00',
        })
        .expect(404);
      expect(services.cashbook.createReceiptVoucher).not.toHaveBeenCalled();
      expect(services.cashAccounts.createCashAccount).not.toHaveBeenCalled();
      expect(services.reconciliation.reconcileShiftCash).not.toHaveBeenCalled();

      await request(url())
        .post('/v1/finance/cashbook/receipts')
        .set('Authorization', restricted())
        .send({ ...voucher, branchId: BRANCH_A })
        .expect(201);
      expect(services.cashbook.createReceiptVoucher.mock.calls[0][4]).toEqual([
        BRANCH_A,
      ]);
    });
  });

  describe('internal credit-authorization routes', () => {
    const route = '/internal/v1/finance/credit-authorizations';
    const body = {
      customerId: ID,
      orderId: ID,
      amount: '500000.00',
    };
    const savedToken = process.env.INTERNAL_S2S_TOKEN;
    const savedEnv = process.env.NODE_ENV;

    afterEach(() => {
      if (savedToken === undefined) delete process.env.INTERNAL_S2S_TOKEN;
      else process.env.INTERNAL_S2S_TOKEN = savedToken;
      process.env.NODE_ENV = savedEnv;
    });

    const internalRoutes = (): Array<[Method, string]> => [
      ['post', route],
      ['get', `${route}/by-key/some-key`],
      ['get', `${route}/${ID}`],
      ['post', `${route}/${ID}/commit`],
      ['post', `${route}/${ID}/release`],
    ];

    it('rejects a missing or wrong token on all five routes, tenant header or not', async () => {
      process.env.INTERNAL_S2S_TOKEN = 'right-token';
      for (const [method, path] of internalRoutes()) {
        const base = () =>
          request(url())
            [method](path)
            .set('x-internal-call', 'sales-service')
            .set('x-tenant-id', TENANT);
        expect((await base().send(body)).status).toBe(403);
        expect(
          (await base().set('x-internal-token', 'wrong-token').send(body))
            .status,
        ).toBe(403);
      }
      expect(services.credit.authorizeCredit).not.toHaveBeenCalled();
    });

    it('ignores a bearer token: the service token is the only way in', async () => {
      process.env.INTERNAL_S2S_TOKEN = 'right-token';
      await request(url())
        .post(route)
        .set('Authorization', owner())
        .send(body)
        .expect(403);
    });

    it('honours the tenant header only after the token is valid', async () => {
      process.env.INTERNAL_S2S_TOKEN = 'right-token';
      await request(url())
        .post(route)
        .set('x-internal-token', 'right-token')
        .set('x-internal-call', 'sales-service')
        .send(body)
        .expect(403); // token fine, tenant header missing
      await request(url())
        .post(route)
        .set('x-internal-token', 'right-token')
        .set('x-internal-call', 'sales-service')
        .set('x-tenant-id', TENANT)
        .send(body)
        .expect(201);
      expect(services.credit.authorizeCredit.mock.calls[0][0]).toBe(
        's2s:sales-service',
      );
      expect(services.credit.authorizeCredit.mock.calls[0][3]).toBe(TENANT);
    });

    it('fails closed when INTERNAL_S2S_TOKEN is unset outside NODE_ENV=test', async () => {
      delete process.env.INTERNAL_S2S_TOKEN;
      process.env.NODE_ENV = 'production';
      await request(url())
        .post(route)
        .set('x-internal-token', 'anything')
        .set('x-internal-call', 'sales-service')
        .set('x-tenant-id', TENANT)
        .send(body)
        .expect(403);
      expect(services.credit.authorizeCredit).not.toHaveBeenCalled();
    });
  });
});
