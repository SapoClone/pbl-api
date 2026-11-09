import { CreateCatalogBranchPriceProjection1793500000000 } from '../src/migrations/1793500000000-create-catalog-branch-price-projection';
/**
 * What stops a branch from being deactivated or deleted, and a member from being removed, as sales sees it
 * (D4, D5), against a real Postgres: open shifts, unfinished orders, checkouts in flight, active POS drafts.
 */
import { RequestContext } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { BranchProjectionEntity } from '../src/branches/branch-projection.entity';
import { M3_SALES_ENTITIES } from '../src/infrastructure/persistence/sales.entities';
import { BranchBlockersService } from '../src/internal/branch-blockers.service';
import { CreateSalesTables1791800000000 } from '../src/migrations/1791800000000-create-sales-tables';
import { AddOrderIdempotency1791800000200 } from '../src/migrations/1791800000200-add-order-idempotency';
import { CreateCheckoutWorkflow1791800000300 } from '../src/migrations/1791800000300-create-checkout-workflow';
import { CreateM3SalesCore1791900000200 } from '../src/migrations/1791900000200-create-m3-sales-core';
import { OrderItemEntity } from '../src/orders/entities/order-item.entity';
import {
  CheckoutWorkflowEntity,
  OrderEntity,
} from '../src/orders/entities/order.entity';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const QUIET = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const WAREHOUSE = '77777777-7777-4777-8777-777777777777';
const CASHIER = '99999999-9999-4999-8999-999999999999';
const OTHER_CASHIER = '98989898-9898-4898-8898-989898989898';

describe('sales branch blockers (Postgres)', () => {
  const schema = uniqueSchema('sales_blockers_it');
  let dataSource: DataSource;
  let service: BranchBlockersService;
  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  const t = (name: string) => `"${schema}"."${name}"`;
  const forBranch = (branchId: string, tenantId = TENANT) =>
    as(tenantId, () => service.forBranch(branchId));

  const shift = (
    branchId: string,
    staffId: string,
    status: string,
    code: string,
    tenantId = TENANT,
  ) =>
    dataSource.query(
      `INSERT INTO ${t('pos_shifts')} (id, tenant_id, code, branch_id, staff_id, status, opened_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [randomUUID(), tenantId, code, branchId, staffId, status],
    );
  const order = (branchId: string, orderStatus: string, code: string) =>
    dataSource.query(
      `INSERT INTO ${t('orders')} (id, tenant_id, code, branch_id, status, payment_method, total_amount, item_count, created_by, order_status)
       VALUES ($1, $2, $3, $4, 'completed', 'CASH', 1000, 1, $5, $6)`,
      [randomUUID(), TENANT, code, branchId, CASHIER, orderStatus],
    );
  const checkout = (branchId: string, state: string) =>
    dataSource.query(
      `INSERT INTO ${t('checkout_workflow')}
         (id, tenant_id, idempotency_key, request_sha256, branch_id, warehouse_id, payment_method, lines_json, total_amount, state, reservation_idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'CASH', '[]', 1000, $7, $3, $8)`,
      [
        randomUUID(),
        TENANT,
        randomUUID(),
        'a'.repeat(64),
        branchId,
        WAREHOUSE,
        state,
        CASHIER,
      ],
    );
  const draft = (branchId: string, status: string, expiresInHours: number) =>
    dataSource.query(
      `INSERT INTO ${t('pos_drafts')} (id, tenant_id, branch_id, staff_id, lines_json, status, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '[]', $5, now() + ($6 || ' hours')::interval, now(), now())`,
      [randomUUID(), TENANT, branchId, CASHIER, status, String(expiresInHours)],
    );

  beforeAll(async () => {
    useDatabase(schema);
    dataSource = await initializeDatabase({
      ...databaseOptions({
        entities: [
          OrderEntity,
          OrderItemEntity,
          CheckoutWorkflowEntity,
          BranchProjectionEntity,
          ...M3_SALES_ENTITIES,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateSalesTables1791800000000,
          AddOrderIdempotency1791800000200,
          CreateCheckoutWorkflow1791800000300,
          CreateM3SalesCore1791900000200,
          CreateCatalogBranchPriceProjection1793500000000,
        ],
      }),
    });
    service = new BranchBlockersService(dataSource);
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  it('reports nothing for a branch that settled everything', async () => {
    await shift(QUIET, CASHIER, 'CLOSED', 'CA-QUIET');
    await order(QUIET, 'COMPLETED', 'DH-Q1');
    await order(QUIET, 'CANCELLED', 'DH-Q2');
    await order(QUIET, 'DRAFT', 'DH-Q3');
    await checkout(QUIET, 'COMPLETED');
    await draft(QUIET, 'CONVERTED', 4);

    expect(await forBranch(QUIET)).toEqual({ reasons: [] });
  });

  it('reports an OPEN shift (and the unsettled states) but not a closed one', async () => {
    await shift(BRANCH, CASHIER, 'OPEN', 'CA-1');
    await shift(BRANCH, OTHER_CASHIER, 'CLOSED', 'CA-2');

    const { reasons } = await forBranch(BRANCH);

    expect(reasons).toEqual([
      {
        code: 'SALES_OPEN_SHIFTS',
        message: 'Chi nhánh còn 1 ca bán hàng chưa đóng',
        count: 1,
        samples: ['CA-1'],
      },
    ]);
  });

  it('reports unfinished orders (pending, confirmed) and ignores completed, cancelled and draft ones', async () => {
    await order(BRANCH, 'PENDING', 'DH-1');
    await order(BRANCH, 'CONFIRMED', 'DH-2');
    await order(BRANCH, 'COMPLETED', 'DH-3');
    await order(BRANCH, 'CANCELLED', 'DH-4');
    await order(BRANCH, 'DRAFT', 'DH-5');

    const { reasons } = await forBranch(BRANCH);

    expect(reasons.find((r) => r.code === 'SALES_UNFINISHED_ORDERS')).toEqual({
      code: 'SALES_UNFINISHED_ORDERS',
      message: 'Chi nhánh còn 2 đơn hàng chưa hoàn tất',
      count: 2,
      samples: expect.arrayContaining(['DH-1', 'DH-2']),
    });
  });

  it('reports checkouts in flight and active POS drafts, not finished checkouts or expired or converted drafts', async () => {
    await checkout(BRANCH, 'AWAITING_PAYMENT');
    await checkout(BRANCH, 'RECOVERY_PENDING');
    await checkout(BRANCH, 'COMPLETED');
    await checkout(BRANCH, 'REJECTED');
    await draft(BRANCH, 'ACTIVE', 4);
    await draft(BRANCH, 'ACTIVE', -4); // expired
    await draft(BRANCH, 'CONVERTED', 4);

    const by = Object.fromEntries(
      (await forBranch(BRANCH)).reasons.map((r) => [r.code, r.count]),
    );

    expect(by).toMatchObject({
      SALES_CHECKOUTS_IN_FLIGHT: 2,
      SALES_ACTIVE_POS_DRAFTS: 1,
    });
  });

  it('returns every reason at once, in a fixed order', async () => {
    expect((await forBranch(BRANCH)).reasons.map((r) => r.code)).toEqual([
      'SALES_OPEN_SHIFTS',
      'SALES_UNFINISHED_ORDERS',
      'SALES_CHECKOUTS_IN_FLIGHT',
      'SALES_ACTIVE_POS_DRAFTS',
    ]);
  });

  it("does not see another store's rows", async () => {
    await shift(BRANCH, CASHIER, 'OPEN', 'CA-X', OTHER_TENANT);

    expect(await forBranch(BRANCH, OTHER_TENANT)).toMatchObject({
      reasons: [{ code: 'SALES_OPEN_SHIFTS', count: 1 }],
    });
    expect(await forBranch(QUIET, OTHER_TENANT)).toEqual({ reasons: [] });
  });

  describe('member (D5)', () => {
    it('reports the open shifts of the account in any branch, and nothing for one without', async () => {
      await shift(QUIET, CASHIER, 'OPEN', 'CA-9');

      const mine = await as(TENANT, () => service.forMember(CASHIER));
      expect(mine.reasons).toEqual([
        {
          code: 'SALES_MEMBER_OPEN_SHIFT',
          message: 'Nhân viên còn 2 ca bán hàng chưa đóng',
          count: 2,
          samples: expect.arrayContaining(['CA-1', 'CA-9']),
        },
      ]);
      expect(await as(TENANT, () => service.forMember(OTHER_CASHIER))).toEqual({
        reasons: [],
      });
    });

    it('stops reporting once the shift is closed', async () => {
      await dataSource.query(
        `UPDATE ${t('pos_shifts')} SET status = 'CLOSED' WHERE code IN ('CA-1', 'CA-9')`,
      );

      expect(await as(TENANT, () => service.forMember(CASHIER))).toEqual({
        reasons: [],
      });
    });
  });
});
