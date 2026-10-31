import { EventEnvelope, RequestContext } from '@pbl/common';
import {
  OrderCompletedPayload,
  SALES_ORDER_COMPLETED,
  SALES_RETURN_COMPLETED,
  SalesReturnEventPayload,
} from '@pbl/contracts';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  OutboxEventEntity,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import {
  CustomerDomainError,
  CustomerDomainErrorCode,
} from '../src/domain/customer-domain';
import { M4_CUSTOMER_ENTITIES } from '../src/infrastructure/persistence/customer.entities';
import { CreateM4CustomerCore1791900000200 } from '../src/migrations/1791900000200-create-m4-customer-core';
import { AddressesService } from '../src/modules/addresses/addresses.service';
import { DataManagementService } from '../src/modules/data-management/data-management.service';
import { GroupsService } from '../src/modules/groups/groups.service';
import { LoyaltyService } from '../src/modules/loyalty/loyalty.service';
import { MembershipsService } from '../src/modules/memberships/memberships.service';
import { ProfilesService } from '../src/modules/profiles/profiles.service';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const ACTOR_MANAGER = '99999999-9999-4999-8999-999999999999';

function runAsTenant<T>(
  tenantId: string,
  fn: () => Promise<T>,
  actorId = ACTOR_MANAGER,
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

describe('Customer & Loyalty M4 Core (Real PostgreSQL Integration & Concurrency)', () => {
  const schema = uniqueSchema('customer_m4_it');
  let dataSource: DataSource;
  let outbox: EventOutbox;
  let groupsService: GroupsService;
  let membershipsService: MembershipsService;
  let addressesService: AddressesService;
  let loyaltyService: LoyaltyService;
  let profilesService: ProfilesService;
  let dataManagementService: DataManagementService;

  beforeAll(async () => {
    useDatabase(schema);
    dataSource = await initializeDatabase({
      ...databaseOptions({
        entities: [
          ...M4_CUSTOMER_ENTITIES,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateM4CustomerCore1791900000200,
        ],
      }),
    });

    outbox = new EventOutbox();
    groupsService = new GroupsService(dataSource, outbox);
    membershipsService = new MembershipsService(dataSource, outbox);
    addressesService = new AddressesService(dataSource);
    loyaltyService = new LoyaltyService(dataSource, membershipsService, outbox);
    profilesService = new ProfilesService(dataSource, outbox);
    dataManagementService = new DataManagementService(dataSource, outbox);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('Test A: Concurrent customer creation with equivalent Vietnamese phone formats allows only 1 winner', async () => {
    const results = await Promise.allSettled([
      profilesService.createCustomer(
        TENANT_A,
        ACTOR_MANAGER,
        {
          name: 'Nguyen Van A1',
          phone: '+84 912 345 678',
          email: 'a1@example.com',
          initialAddress: {
            addressLine: '123 Le Loi',
            district: 'Quan 1',
            province: 'TP.HCM',
          },
        },
        true,
      ),
      profilesService.createCustomer(
        TENANT_A,
        ACTOR_MANAGER,
        {
          name: 'Nguyen Van A2',
          phone: '0912-345-678',
          email: 'a2@example.com',
        },
        true,
      ),
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled',
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as CustomerDomainError).code).toBe(
      CustomerDomainErrorCode.CUSTOMER_ALREADY_EXISTS,
    );

    const winner = fulfilled[0].value;
    expect(winner.phoneNormalized).toBe('0912345678');
    expect(winner.loyalty).toMatchObject({
      postedPointsBalance: 0,
      heldPoints: 0,
      availablePoints: 0,
      qualifyingPoints: 0,
    });

    // Lookup by raw unnormalized phone finds the same customer
    const lookedUp = await profilesService.lookupCustomer(TENANT_A, {
      phone: '84912345678',
    });
    expect(lookedUp.id).toBe(winner.id);
  });

  it('Test B: Concurrent profile updates with optimistic version checking reject stale version with RESOURCE_VERSION_CONFLICT', async () => {
    const created = await profilesService.createCustomer(
      TENANT_A,
      ACTOR_MANAGER,
      {
        name: 'Tran Thi Optimistic',
        phone: '0988111222',
      },
    );
    expect(created.version).toBe(1);

    const updates = await Promise.allSettled([
      profilesService.updateCustomer(TENANT_A, created.id, ACTOR_MANAGER, {
        name: 'Tran Thi Update 1',
        version: 1,
      }),
      profilesService.updateCustomer(TENANT_A, created.id, ACTOR_MANAGER, {
        name: 'Tran Thi Update 2',
        version: 1,
      }),
    ]);

    const fulfilled = updates.filter((r) => r.status === 'fulfilled');
    const rejected = updates.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as CustomerDomainError).code).toBe(
      CustomerDomainErrorCode.RESOURCE_VERSION_CONFLICT,
    );

    const latest = await profilesService.getCustomerById(TENANT_A, created.id);
    expect(latest.version).toBe(2);
  });

  it('Test C: Address default invariant enforces at most one active default address under concurrent switching', async () => {
    const customer = await profilesService.createCustomer(
      TENANT_A,
      ACTOR_MANAGER,
      {
        name: 'Le Van Address',
        phone: '0977111222',
      },
    );

    const [addr1, addr2, addr3] = await runAsTenant(TENANT_A, async () => {
      const a1 = await addressesService.addAddress(customer.id, {
        recipientName: 'Home',
        addressLine: '10 Nguyen Hue',
        isDefault: true,
      });
      const a2 = await addressesService.addAddress(customer.id, {
        recipientName: 'Office',
        addressLine: '20 Pasteur',
        isDefault: false,
      });
      const a3 = await addressesService.addAddress(customer.id, {
        recipientName: 'Warehouse',
        addressLine: '30 Dien Bien Phu',
        isDefault: false,
      });
      return [a1, a2, a3];
    });

    await Promise.all([
      runAsTenant(TENANT_A, () =>
        addressesService.setDefaultAddress(customer.id, addr2.id),
      ),
      runAsTenant(TENANT_A, () =>
        addressesService.setDefaultAddress(customer.id, addr3.id),
      ),
      runAsTenant(TENANT_A, () =>
        addressesService.setDefaultAddress(customer.id, addr1.id),
      ),
    ]);

    const addresses = await runAsTenant(TENANT_A, () =>
      addressesService.listAddresses(customer.id),
    );
    const defaults = addresses.filter((a) => a.isDefault);
    expect(defaults).toHaveLength(1);
  });

  it('Test D: Customer group assignment emits event and blocks deactivating non-empty group until unassigned', async () => {
    const customer = await profilesService.createCustomer(
      TENANT_A,
      ACTOR_MANAGER,
      {
        name: 'Pham Thi Group',
        phone: '0966111222',
      },
    );

    const vipGroup = await runAsTenant(TENANT_A, () =>
      groupsService.createGroup({
        code: 'VIP_RETAIL',
        name: 'VIP Retail Group',
        defaultDiscountRate: 5,
      }),
    );

    await runAsTenant(TENANT_A, () =>
      groupsService.assignCustomerToGroup(customer.id, ACTOR_MANAGER, {
        customerGroupId: vipGroup.id,
      }),
    );

    // Attempting to deactivate non-empty group must fail with 409 CUSTOMER_GROUP_NOT_EMPTY
    await expect(
      runAsTenant(TENANT_A, () =>
        groupsService.updateGroup(vipGroup.id, { status: 'INACTIVE' }),
      ),
    ).rejects.toMatchObject({
      code: CustomerDomainErrorCode.CUSTOMER_GROUP_NOT_EMPTY,
      httpStatus: 409,
    });

    // Unassign customer then deactivate group
    await runAsTenant(TENANT_A, () =>
      groupsService.assignCustomerToGroup(customer.id, ACTOR_MANAGER, {
        customerGroupId: null,
      }),
    );

    const deactivatedGroup = await runAsTenant(TENANT_A, () =>
      groupsService.updateGroup(vipGroup.id, { status: 'INACTIVE' }),
    );
    expect(deactivatedGroup.status).toBe('INACTIVE');
  });

  it('Test E & L: Loyalty earning from completed order, idempotent duplicate event replay, automatic tier upgrade, and non-downgrade on redemption', async () => {
    await runAsTenant(TENANT_A, async () => {
      await loyaltyService.updateSettings(ACTOR_MANAGER, {
        isEnabled: true,
        earnAmountPerPoint: 10000,
        redeemValuePerPoint: 1000,
        minRedeemPoints: 10,
        maxRedeemPointsPerOrder: 1000,
        holdTtlSeconds: 900,
      });

      await membershipsService.createTier({
        code: 'MEMBER',
        name: 'Member',
        minPoints: 0,
        discountRate: 0,
      });
      await membershipsService.createTier({
        code: 'SILVER',
        name: 'Silver',
        minPoints: 100,
        discountRate: 2,
      });
      await membershipsService.createTier({
        code: 'GOLD',
        name: 'Gold',
        minPoints: 500,
        discountRate: 5,
      });
      await membershipsService.createTier({
        code: 'PLATINUM',
        name: 'Platinum',
        minPoints: 2000,
        discountRate: 10,
      });
    });

    const customer = await profilesService.createCustomer(
      TENANT_A,
      ACTOR_MANAGER,
      {
        name: 'Hoang Van Loyalty',
        phone: '0955111222',
      },
    );

    const orderId = randomUUID();
    const orderEvent: EventEnvelope<OrderCompletedPayload> = {
      id: randomUUID(),
      type: SALES_ORDER_COMPLETED.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT_A,
      actor: null,
      traceId: randomUUID(),
      payload: {
        orderId,
        code: 'DH000501',
        branchId: BRANCH_A,
        customerId: customer.id,
        totalAmount: 5500000,
        itemCount: 1,
        subtotal: 5500000,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: 5500000,
        paymentMethod: 'CASH',
        createdBy: ACTOR_MANAGER,
        completedAt: new Date().toISOString(),
        items: [],
      },
    };

    // Process order completion event (5,500,000 VND / 10,000 = 550 points -> upgrades to GOLD)
    await loyaltyService.onSalesOrderCompleted(orderEvent);

    // Replay the exact same event -> idempotent no-op
    await loyaltyService.onSalesOrderCompleted(orderEvent);

    const accountAfterEarn = await runAsTenant(TENANT_A, () =>
      loyaltyService.getLoyaltyAccount(customer.id),
    );
    expect(accountAfterEarn.postedPointsBalance).toBe(550);
    expect(accountAfterEarn.qualifyingPoints).toBe(550);
    expect(accountAfterEarn.availablePoints).toBe(550);

    const membershipAfterEarn = await runAsTenant(TENANT_A, () =>
      membershipsService.getCustomerMembership(customer.id),
    );
    expect(membershipAfterEarn.tier?.code).toBe('GOLD');
    expect(membershipAfterEarn.nextTier?.code).toBe('PLATINUM');
    expect(membershipAfterEarn.nextTier?.pointsNeeded).toBe(1450);

    // Redeem 480 points via hold + commit -> postedPointsBalance drops to 70, but qualifyingPoints stays 550 and tier remains GOLD!
    const hold = await runAsTenant(TENANT_A, () =>
      loyaltyService.createHold('hold-gold-redeem-1', {
        customerId: customer.id,
        points: 480,
        sourceRefType: 'CHECKOUT',
        sourceRefId: 'chk-gold-1',
      }),
    );
    expect(hold.replayed).toBe(false);
    expect(hold.points).toBe(480);

    const committed = await runAsTenant(TENANT_A, () =>
      loyaltyService.commitHold(hold.holdId, {
        orderId: randomUUID(),
      }),
    );
    expect(committed.state).toBe('COMMITTED');

    const accountAfterRedeem = await runAsTenant(TENANT_A, () =>
      loyaltyService.getLoyaltyAccount(customer.id),
    );
    expect(accountAfterRedeem.postedPointsBalance).toBe(70);
    expect(accountAfterRedeem.heldPoints).toBe(0);
    expect(accountAfterRedeem.availablePoints).toBe(70);
    expect(accountAfterRedeem.qualifyingPoints).toBe(550);

    const membershipAfterRedeem = await runAsTenant(TENANT_A, () =>
      membershipsService.getCustomerMembership(customer.id),
    );
    expect(membershipAfterRedeem.tier?.code).toBe('GOLD');
  });

  it('Test F & G: 10 concurrent point holds on a single customer prevent overspending and enforce idempotency hash check', async () => {
    const customer = await profilesService.createCustomer(
      TENANT_A,
      ACTOR_MANAGER,
      {
        name: 'Concurrent Hold Tester',
        phone: '0944111222',
      },
    );

    // Seed 150 points via manual adjustment
    await runAsTenant(TENANT_A, () =>
      loyaltyService.adjustPoints(customer.id, ACTOR_MANAGER, 'seed-150', {
        pointsDelta: 150,
        reason: 'Initial points for concurrency test',
      }),
    );

    // Fire 10 concurrent holds of 50 points each (only 3 can succeed since 3 * 50 = 150)
    const holdResults = await Promise.allSettled(
      Array.from({ length: 10 }, (_, idx) =>
        runAsTenant(TENANT_A, () =>
          loyaltyService.createHold(`conc-hold-key-${idx}`, {
            customerId: customer.id,
            points: 50,
            sourceRefType: 'CHECKOUT',
            sourceRefId: `chk-conc-${idx}`,
          }),
        ),
      ),
    );

    const succeeded = holdResults.filter((r) => r.status === 'fulfilled');
    const failed = holdResults.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(succeeded).toHaveLength(3);
    expect(failed).toHaveLength(7);
    for (const f of failed) {
      expect((f.reason as CustomerDomainError).code).toBe(
        CustomerDomainErrorCode.INSUFFICIENT_LOYALTY_POINTS,
      );
    }

    const wallet = await runAsTenant(TENANT_A, () =>
      loyaltyService.getLoyaltyAccount(customer.id),
    );
    expect(wallet.postedPointsBalance).toBe(150);
    expect(wallet.heldPoints).toBe(150);
    expect(wallet.availablePoints).toBe(0);

    // Test G: Idempotent replay with same key & payload returns replayed=true
    const winnerIdx = holdResults.findIndex((r) => r.status === 'fulfilled');
    const replaySame = await runAsTenant(TENANT_A, () =>
      loyaltyService.createHold(`conc-hold-key-${winnerIdx}`, {
        customerId: customer.id,
        points: 50,
        sourceRefType: 'CHECKOUT',
        sourceRefId: `chk-conc-${winnerIdx}`,
      }),
    );
    expect(replaySame.replayed).toBe(true);

    // Replay with same key but mutated points throws IDEMPOTENCY_CONFLICT
    await expect(
      runAsTenant(TENANT_A, () =>
        loyaltyService.createHold(`conc-hold-key-${winnerIdx}`, {
          customerId: customer.id,
          points: 60,
          sourceRefType: 'CHECKOUT',
          sourceRefId: `chk-conc-${winnerIdx}`,
        }),
      ),
    ).rejects.toMatchObject({
      code: CustomerDomainErrorCode.IDEMPOTENCY_CONFLICT,
      httpStatus: 409,
    });
  });

  it('Test H & I: Concurrent hold commit vs release race, hold expiration, and loyalty reconciliation worker', async () => {
    const customer = await profilesService.createCustomer(
      TENANT_A,
      ACTOR_MANAGER,
      {
        name: 'Hold Race & Expiry Tester',
        phone: '0933111222',
      },
    );

    await runAsTenant(TENANT_A, () =>
      loyaltyService.adjustPoints(customer.id, ACTOR_MANAGER, 'seed-200', {
        pointsDelta: 200,
        reason: 'Seed points for race and expiration tests',
      }),
    );

    const createdHold = await runAsTenant(TENANT_A, () =>
      loyaltyService.createHold('race-hold-1', {
        customerId: customer.id,
        points: 60,
        sourceRefType: 'CHECKOUT',
        sourceRefId: 'chk-race-1',
      }),
    );

    // Race commitHold and releaseHold concurrently
    const raceResults = await Promise.allSettled([
      runAsTenant(TENANT_A, () =>
        loyaltyService.commitHold(createdHold.holdId, {
          orderId: randomUUID(),
        }),
      ),
      runAsTenant(TENANT_A, () =>
        loyaltyService.releaseHold(createdHold.holdId, {
          reason: 'Concurrent cancel attempt',
        }),
      ),
    ]);

    const raceFulfilled = raceResults.filter((r) => r.status === 'fulfilled');
    const raceRejected = raceResults.filter((r) => r.status === 'rejected');
    expect(raceFulfilled).toHaveLength(1);
    expect(raceRejected).toHaveLength(1);

    // Create a second hold and backdate expires_at to test late commit rejection & reconciliation
    const expiringHold = await runAsTenant(TENANT_A, () =>
      loyaltyService.createHold('expiring-hold-1', {
        customerId: customer.id,
        points: 40,
        sourceRefType: 'CHECKOUT',
        sourceRefId: 'chk-exp-1',
        ttlSeconds: 30,
      }),
    );

    await dataSource.query(
      `UPDATE "${schema}"."loyalty_holds"
       SET "expires_at" = now() - interval '5 minutes'
       WHERE "id" = $1`,
      [expiringHold.holdId],
    );

    await expect(
      runAsTenant(TENANT_A, () =>
        loyaltyService.commitHold(expiringHold.holdId, {
          orderId: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({
      code: CustomerDomainErrorCode.LOYALTY_HOLD_EXPIRED,
      httpStatus: 409,
    });

    // Run reconciliation worker -> 0 discrepancies between wallet balances, ledger sums, and active holds
    const reconReport = await runAsTenant(TENANT_A, () =>
      loyaltyService.reconcileTenantLoyalty(),
    );
    expect(reconReport.discrepancyCount).toBe(0);
  });

  it('Test J & K: Multi-step partial return reversal using historical snapshot rate, negative clawback after redemption, and out-of-order return event reconciliation', async () => {
    const customer = await profilesService.createCustomer(
      TENANT_A,
      ACTOR_MANAGER,
      {
        name: 'Return Reversal Tester',
        phone: '0922111222',
      },
    );

    // Ensure rate is 10,000 VND / point when Order 1 completes
    await runAsTenant(TENANT_A, () =>
      loyaltyService.updateSettings(ACTOR_MANAGER, {
        earnAmountPerPoint: 10000,
      }),
    );

    const order1Id = randomUUID();
    await loyaltyService.onSalesOrderCompleted({
      id: randomUUID(),
      type: SALES_ORDER_COMPLETED.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT_A,
      actor: null,
      traceId: randomUUID(),
      payload: {
        orderId: order1Id,
        code: 'DH-RET-001',
        branchId: BRANCH_A,
        customerId: customer.id,
        totalAmount: 1500000,
        itemCount: 1,
        subtotal: 1500000,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: 1500000,
        paymentMethod: 'CASH',
        createdBy: ACTOR_MANAGER,
        completedAt: new Date().toISOString(),
        items: [],
      },
    });

    // Customer earned 150 points. Now change tenant earn rate to 25,000 VND / point!
    await runAsTenant(TENANT_A, () =>
      loyaltyService.updateSettings(ACTOR_MANAGER, {
        earnAmountPerPoint: 25000,
      }),
    );

    // Customer redeems 120 points on another purchase -> postedPointsBalance = 30
    const hold = await runAsTenant(TENANT_A, () =>
      loyaltyService.createHold('hold-before-return', {
        customerId: customer.id,
        points: 120,
        sourceRefType: 'CHECKOUT',
        sourceRefId: 'chk-before-ret',
      }),
    );
    await runAsTenant(TENANT_A, () =>
      loyaltyService.commitHold(hold.holdId, { orderId: randomUUID() }),
    );

    // Partial return 1: 500,000 VND of 1,500,000 VND -> reverses 50 points (using historical 150 pts snapshot)
    // Balance goes from 30 -> -20 (clawback debt = 20, available = 0)
    const return1Id = randomUUID();
    const return1Event: EventEnvelope<SalesReturnEventPayload> = {
      id: randomUUID(),
      type: SALES_RETURN_COMPLETED.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT_A,
      actor: null,
      traceId: randomUUID(),
      payload: {
        returnId: return1Id,
        code: 'TH000001',
        orderId: order1Id,
        customerId: customer.id,
        branchId: BRANCH_A,
        status: 'COMPLETED',
        totalRefundAmount: 500000,
        occurredAt: new Date().toISOString(),
      },
    };
    await loyaltyService.onSalesReturnCompleted(return1Event);
    // Replay return1Event -> idempotent no-op
    await loyaltyService.onSalesReturnCompleted(return1Event);

    const accAfterRet1 = await runAsTenant(TENANT_A, () =>
      loyaltyService.getLoyaltyAccount(customer.id),
    );
    expect(accAfterRet1.postedPointsBalance).toBe(-20);
    expect(accAfterRet1.availablePoints).toBe(0);

    // Partial return 2: remaining 1,000,000 VND -> reverses remaining 100 points (total reversed = 150, balance = -120)
    await loyaltyService.onSalesReturnCompleted({
      id: randomUUID(),
      type: SALES_RETURN_COMPLETED.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT_A,
      actor: null,
      traceId: randomUUID(),
      payload: {
        returnId: randomUUID(),
        code: 'TH000002',
        orderId: order1Id,
        customerId: customer.id,
        branchId: BRANCH_A,
        status: 'COMPLETED',
        totalRefundAmount: 1000000,
        occurredAt: new Date().toISOString(),
      },
    });

    const accAfterRet2 = await runAsTenant(TENANT_A, () =>
      loyaltyService.getLoyaltyAccount(customer.id),
    );
    expect(accAfterRet2.postedPointsBalance).toBe(-120);
    expect(accAfterRet2.availablePoints).toBe(0);

    // Restore rate to 10,000 VND / point and test out-of-order return arriving BEFORE order completion
    await runAsTenant(TENANT_A, () =>
      loyaltyService.updateSettings(ACTOR_MANAGER, {
        earnAmountPerPoint: 10000,
      }),
    );

    const outOfOrderCustomer = await profilesService.createCustomer(
      TENANT_A,
      ACTOR_MANAGER,
      {
        name: 'Out Of Order Event Customer',
        phone: '0919888777',
      },
    );
    const order2Id = randomUUID();
    const earlyReturnId = randomUUID();

    // Return event arrives FIRST
    await loyaltyService.onSalesReturnCompleted({
      id: randomUUID(),
      type: SALES_RETURN_COMPLETED.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT_A,
      actor: null,
      traceId: randomUUID(),
      payload: {
        returnId: earlyReturnId,
        code: 'TH-EARLY-01',
        orderId: order2Id,
        customerId: outOfOrderCustomer.id,
        branchId: BRANCH_A,
        status: 'COMPLETED',
        totalRefundAmount: 400000,
        occurredAt: new Date().toISOString(),
      },
    });

    // Order completion (1,000,000 VND -> 100 pts) arrives SECOND -> awards 100 pts and immediately reverses 40 pts -> net 60 pts!
    await loyaltyService.onSalesOrderCompleted({
      id: randomUUID(),
      type: SALES_ORDER_COMPLETED.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT_A,
      actor: null,
      traceId: randomUUID(),
      payload: {
        orderId: order2Id,
        code: 'DH-LATE-01',
        branchId: BRANCH_A,
        customerId: outOfOrderCustomer.id,
        totalAmount: 1000000,
        itemCount: 1,
        subtotal: 1000000,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: 1000000,
        paymentMethod: 'CASH',
        createdBy: ACTOR_MANAGER,
        completedAt: new Date().toISOString(),
        items: [],
      },
    });

    const oooAccount = await runAsTenant(TENANT_A, () =>
      loyaltyService.getLoyaltyAccount(outOfOrderCustomer.id),
    );
    expect(oooAccount.postedPointsBalance).toBe(60);
    expect(oooAccount.qualifyingPoints).toBe(60);
  });

  it('Test M & N: Manual point adjustments, duplicate detection, atomic customer merge with ledger transfer, and CSV import/export formula-injection protection', async () => {
    const sourceCust = await profilesService.createCustomer(
      TENANT_A,
      ACTOR_MANAGER,
      {
        name: 'Duplicate Customer Merge',
        phone: '0911222333',
        email: 'dup-merge@example.com',
        initialAddress: {
          addressLine: '99 Source Street',
        },
      },
    );
    const targetCust = await profilesService.createCustomer(
      TENANT_A,
      ACTOR_MANAGER,
      {
        name: 'Duplicate Customer Merge',
        phone: '0911222444',
        email: 'dup-merge@example.com',
      },
    );

    // Reject 0-delta manual adjustment
    await expect(
      runAsTenant(TENANT_A, () =>
        loyaltyService.adjustPoints(sourceCust.id, ACTOR_MANAGER, 'bad-adj', {
          pointsDelta: 0,
          reason: 'Zero delta not allowed',
        }),
      ),
    ).rejects.toMatchObject({
      code: CustomerDomainErrorCode.VALIDATION_ERROR,
      httpStatus: 422,
    });

    // Credit 120 points to sourceCust and 80 points to targetCust
    await runAsTenant(TENANT_A, () =>
      loyaltyService.adjustPoints(sourceCust.id, ACTOR_MANAGER, 'adj-src-120', {
        pointsDelta: 120,
        reason: 'Source customer bonus',
      }),
    );
    await runAsTenant(TENANT_A, () =>
      loyaltyService.adjustPoints(targetCust.id, ACTOR_MANAGER, 'adj-tgt-80', {
        pointsDelta: 80,
        reason: 'Target customer bonus',
      }),
    );

    // Detect duplicates
    const duplicates = await dataManagementService.findDuplicates(TENANT_A);
    expect(duplicates.total).toBeGreaterThanOrEqual(1);

    // Merge sourceCust into targetCust
    const mergeRes = await dataManagementService.mergeCustomers(
      TENANT_A,
      ACTOR_MANAGER,
      {
        sourceCustomerId: sourceCust.id,
        targetCustomerId: targetCust.id,
        reason: 'Consolidate duplicate profiles',
        idempotencyKey: 'merge-src-tgt-001',
      },
    );
    expect(mergeRes.idempotentReplay).toBe(false);
    expect(mergeRes.mergeRecord?.transferredPoints).toBe(120);
    expect(mergeRes.mergeRecord?.movedAddressesCount).toBe(1);
    expect(mergeRes.targetCustomer?.postedPointsBalance).toBe(200);

    // Idempotent replay of the merge
    const mergeReplay = await dataManagementService.mergeCustomers(
      TENANT_A,
      ACTOR_MANAGER,
      {
        sourceCustomerId: sourceCust.id,
        targetCustomerId: targetCust.id,
        idempotencyKey: 'merge-src-tgt-001',
      },
    );
    expect(mergeReplay.idempotentReplay).toBe(true);

    // Import job with formula injection payload and export with sanitization + PII masking
    const importJob = await dataManagementService.createImportJob(
      TENANT_A,
      ACTOR_MANAGER,
      {
        conflictPolicy: 'SKIP',
        rows: [
          {
            name: "=CMD|' /C calc'!A0",
            phone: '0905123456',
            email: 'csvinject@example.com',
            note: '+SUM(A1:A10)',
          },
          {
            name: 'Invalid Phone Row',
            phone: 'not-a-phone',
          },
        ],
      },
    );
    expect(importJob.totalRows).toBe(2);
    expect(importJob.successRows).toBe(1);
    expect(importJob.failedRows).toBe(1);

    const exportJob = await dataManagementService.createExportJob(
      TENANT_A,
      ACTOR_MANAGER,
      {},
    );
    expect(exportJob.resultCsv).toContain("'=CMD|");
    expect(exportJob.resultCsv).toContain('090***3456');
  });

  it('Test O: Strict cross-tenant isolation, 360-degree summary, S2S eligibility, and GDPR/privacy anonymization', async () => {
    // Tenant B can create a customer with the exact same phone number as Tenant A
    const tenantBCust = await profilesService.createCustomer(
      TENANT_B,
      ACTOR_MANAGER,
      {
        name: 'Tenant B Customer',
        phone: '0912345678',
        email: 'tenantb@example.com',
      },
      true,
    );
    expect(tenantBCust.phoneNormalized).toBe('0912345678');

    // Tenant A cannot read Tenant B's customer
    await expect(
      profilesService.getCustomerById(TENANT_A, tenantBCust.id),
    ).rejects.toMatchObject({
      code: CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
      httpStatus: 404,
    });

    // S2S Eligibility & 360 Summary on Tenant B customer
    const eligibility = await profilesService.getCustomerEligibility(
      TENANT_B,
      tenantBCust.id,
    );
    expect(eligibility.isActive).toBe(true);
    expect(eligibility.customerId).toBe(tenantBCust.id);

    const summary = await profilesService.getCustomerSummary(
      TENANT_B,
      tenantBCust.id,
    );
    expect(summary.financialSummary.authoritativeSource).toBe(
      'PENDING_M5_FINANCE',
    );

    // Anonymize Tenant B customer
    const anonymized = await profilesService.deactivateCustomer(
      TENANT_B,
      tenantBCust.id,
      ACTOR_MANAGER,
      {
        anonymize: true,
        reason: 'Customer privacy deletion request',
      },
    );
    expect(anonymized.status).toBe('ANONYMIZED');
    expect(anonymized.phone).toBeNull();
    expect(anonymized.phoneNormalized).toBeNull();
    expect(anonymized.email).toBeNull();
    expect(anonymized.name).toBe(`ANONYMIZED-${tenantBCust.code}`);

    // Verify all outbox events were recorded atomically
    const outboxCount = await dataSource
      .getRepository(OutboxEventEntity)
      .count();
    expect(outboxCount).toBeGreaterThan(10);

    // Verify global ledger invariant across all loyalty accounts in both tenants
    const ledgerAudit: Array<{ mismatch_count: string }> =
      await dataSource.query(
        `SELECT COUNT(*)::text AS mismatch_count
         FROM "${schema}"."loyalty_accounts" a
         WHERE a.posted_points_balance != COALESCE((
           SELECT SUM(t.points_delta)
           FROM "${schema}"."loyalty_transactions" t
           WHERE t.tenant_id = a.tenant_id AND t.loyalty_account_id = a.id
         ), 0)`,
      );
    expect(Number(ledgerAudit[0]?.mismatch_count ?? 0)).toBe(0);
  });
});
