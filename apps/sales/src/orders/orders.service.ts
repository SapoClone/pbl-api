import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantContext,
  TenantScopedRepository,
} from '@pbl/common';
import { OrderCompletedPayload, SALES_ORDER_COMPLETED } from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { createHash, randomUUID } from 'crypto';
import { In, QueryFailedError } from 'typeorm';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import {
  InventoryClient,
  InventoryClientErrorCode,
} from '../inventory/inventory.client';
import {
  BranchScope,
  assertBranchAllowed,
  branchAllowed,
  branchFilter,
} from '../presentation/access';
import {
  CreateCheckoutReqDto,
  CreateOrderReqDto,
} from './dto/create-order.req.dto';
import { ListOrdersReqDto } from './dto/list-orders.req.dto';
import { OrderRes, toOrderRes } from './dto/order.res';
import { OrderItemEntity } from './entities/order-item.entity';
import {
  CheckoutWorkflowEntity,
  CheckoutWorkflowLine,
  CheckoutWorkflowState,
  OrderEntity,
} from './entities/order.entity';

/** Error codes of this service (a domain letter plus 3 digits, api-conventions §6) */
export const SalesErrorCode = {
  UNKNOWN_BRANCH: 'S001',
  IDEMPOTENCY_KEY_REQUIRED: 'S002',
  IDEMPOTENCY_KEY_REUSED: 'S003',
  OUT_OF_STOCK: 'S004',
  CHECKOUT_RECOVERY_PENDING: InventoryClientErrorCode.TIMEOUT_RECOVERY_PENDING,
} as const;

/** The order id derives from the key, so a racing retry can hit the primary key first */
const ORDER_PRIMARY_KEY = 'PK_orders_id';
const IDEMPOTENCY_INDEX = 'UQ_orders_tenant_idempotency_key';

export interface Page<T> {
  data: T[];
  pagination: {
    limit: number;
    currentPage: number;
    nextPage?: number;
    totalRecords: number;
    totalPages: number;
  };
}

export interface CreateOrderResult {
  order: OrderRes;
  /** True when the same Idempotency-Key had already created this order */
  replayed: boolean;
}

export interface CheckoutWorkflowResponse {
  checkoutId: string;
  tenantId: string;
  branchId: string;
  warehouseId: string;
  state: CheckoutWorkflowState;
  reservationIdempotencyKey: string;
  reservationId: string | null;
  orderId: string | null;
  order?: OrderRes;
  replayed: boolean;
}

/** What identifies a request: the same key with another body is a client bug */
export function hashRequest(dto: CreateOrderReqDto): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        branchId: dto.branchId,
        paymentMethod: dto.paymentMethod,
        customerName: dto.customerName ?? null,
        items: dto.items.map((i) => [i.sku, i.name, i.quantity, i.unitPrice]),
      }),
    )
    .digest('hex');
}

export function hashCheckoutRequest(dto: CreateCheckoutReqDto): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        branchId: dto.branchId,
        warehouseId: dto.warehouseId,
        paymentMethod: dto.paymentMethod,
        customerName: dto.customerName ?? null,
        items: dto.items.map((i) => [
          i.variantId,
          i.sku,
          i.name,
          i.qty,
          i.unitPrice,
        ]),
      }),
    )
    .digest('hex');
}

/**
 * Deterministic reservation idempotency key derived from `(tenantId, checkoutIdempotencyKey)`.
 * Ensures timeout recovery replays the exact same reservation key without double-reserving stock.
 */
export function reservationIdempotencyKeyFor(
  tenantId: string,
  checkoutIdempotencyKey: string,
): string {
  const h = createHash('sha256')
    .update(`rsv:${tenantId}:${checkoutIdempotencyKey}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A stable UUID for the order of this tenant and key (the hold is keyed by it) */
function orderIdFor(tenantId: string, idempotencyKey: string): string {
  const h = createHash('sha256')
    .update(`${tenantId}:${idempotencyKey}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Sells at the counter: the order, its lines and the `sales.order.completed`
 * event commit in one transaction. Every read and write is scoped to the
 * token's store by TenantScopedRepository (ADR-0008). Creating is idempotent
 * per `Idempotency-Key`, so a client that retries on a bad network never sells
 * twice.
 */
@Injectable()
export class OrdersService {
  constructor(
    @InjectTenantScopedRepository(OrderEntity)
    private readonly orders: TenantScopedRepository<OrderEntity>,
    @InjectTenantScopedRepository(BranchProjectionEntity)
    private readonly branches: TenantScopedRepository<BranchProjectionEntity>,
    private readonly outbox: EventOutbox,
    private readonly inventory: InventoryClient,
    @Optional()
    @InjectTenantScopedRepository(CheckoutWorkflowEntity)
    private readonly checkouts?: TenantScopedRepository<CheckoutWorkflowEntity>,
  ) {}

  async create(
    accountId: string,
    scope: BranchScope,
    idempotencyKey: string,
    dto: CreateOrderReqDto,
  ): Promise<CreateOrderResult> {
    assertBranchAllowed(
      scope,
      dto.branchId,
      'ORDER_NOT_FOUND',
      'Branch not found',
    );
    const requestHash = hashRequest(dto);
    const earlier = await this.findByKey(idempotencyKey);
    if (earlier) return this.replay(earlier, requestHash);

    await this.assertActiveBranch(dto.branchId);

    // The order id is the reservation key, so it exists before the order does. It
    // derives from the Idempotency-Key: a concurrent retry asks for the same hold
    // (inventory is idempotent per order) instead of taking a second one.
    const orderId = orderIdFor(TenantContext.require(), idempotencyKey);
    const shortages = await this.inventory.reserve(
      orderId,
      dto.branchId,
      dto.items.map(({ sku, quantity }) => ({ sku, quantity })),
    );
    if (shortages) {
      throw new ConflictException({
        errorCode: SalesErrorCode.OUT_OF_STOCK,
        message: 'Not enough stock for this order',
        details: shortages,
      });
    }
    const items = dto.items.map((line) => {
      const item = new OrderItemEntity();
      item.id = randomUUID();
      item.orderId = orderId;
      item.sku = line.sku;
      item.name = line.name;
      item.quantity = line.quantity;
      item.unitPrice = line.unitPrice;
      item.lineTotal = line.quantity * line.unitPrice;
      return item;
    });
    const order = new OrderEntity();
    order.id = orderId;
    order.code = this.newCode();
    order.branchId = dto.branchId;
    order.status = 'completed';
    order.paymentMethod = dto.paymentMethod;
    order.customerName = dto.customerName ?? null;
    order.totalAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
    order.itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    order.createdBy = accountId;
    order.createdAt = new Date();
    order.idempotencyKey = idempotencyKey;
    order.requestHash = requestHash;

    try {
      const txResult = await this.orders.transaction(async (orders, em) => {
        await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `${TenantContext.require()}:${idempotencyKey}`,
        ]);
        const winner = await orders.findOne({
          where: { idempotencyKey },
          relations: { items: true },
        });
        if (winner) {
          return { row: winner, replayed: true };
        }
        const row = await orders.save(order);
        const lines = await TenantScopedRepository.forEntity(
          em,
          OrderItemEntity,
        ).save(items);
        await this.outbox.add(em, SALES_ORDER_COMPLETED, {
          orderId: row.id,
          code: row.code,
          branchId: row.branchId,
          totalAmount: row.totalAmount,
          itemCount: row.itemCount,
          paymentMethod: row.paymentMethod,
          createdBy: accountId,
          completedAt: new Date().toISOString(),
          items: lines.map((l) => ({
            sku: l.sku,
            name: l.name,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
        } satisfies OrderCompletedPayload);
        row.items = lines;
        return { row, replayed: false };
      });
      if (txResult.replayed) {
        return this.replay(txResult.row, requestHash);
      }
      return { order: toOrderRes(txResult.row), replayed: false };
    } catch (error) {
      // Two requests with the same key raced past the lookup; the index decided.
      // They share one hold, which belongs to the winner: nothing to give back.
      if (this.isKeyViolation(error)) {
        const winner = await this.findByKey(idempotencyKey);
        if (winner) return this.replay(winner, requestHash);
      }
      await this.releaseUnlessCreated(orderId, idempotencyKey);
      throw error;
    }
  }

  /**
   * Warehouse-backed checkout state machine (ADR-0012):
   * `PENDING_STOCK -> RESERVING -> STOCK_RESERVED -> CONFIRMED` with
   * deterministic timeout recovery (`RECOVERY_PENDING`) when Inventory is
   * unreachable or times out mid-reservation.
   */
  async checkout(
    accountId: string,
    scope: BranchScope,
    idempotencyKey: string,
    dto: CreateCheckoutReqDto,
  ): Promise<CheckoutWorkflowResponse> {
    assertBranchAllowed(
      scope,
      dto.branchId,
      'ORDER_NOT_FOUND',
      'Branch not found',
    );
    const checkoutsRepo = this.requireCheckoutsRepo();
    const tenantId = TenantContext.require();
    const requestSha256 = hashCheckoutRequest(dto);

    const existing = await checkoutsRepo.findOne({
      where: { idempotencyKey },
    });
    if (existing) {
      assertBranchAllowed(
        scope,
        existing.branchId,
        'CHECKOUT_NOT_FOUND',
        'Checkout workflow not found',
      );
      if (existing.requestSha256 !== requestSha256) {
        throw new ConflictException({
          errorCode: SalesErrorCode.IDEMPOTENCY_KEY_REUSED,
          message:
            'The Idempotency-Key was already used for a different checkout request',
        });
      }
      if (
        existing.state === 'RECOVERY_PENDING' ||
        existing.state === 'RESERVING' ||
        existing.state === 'STOCK_RESERVED'
      ) {
        return this.reconcileCheckout(existing, true);
      }
      return this.toCheckoutResponse(existing, true);
    }

    await this.assertActiveBranch(dto.branchId);

    const checkoutId = orderIdFor(tenantId, `chk:${idempotencyKey}`);
    const reservationIdempotencyKey = reservationIdempotencyKeyFor(
      tenantId,
      idempotencyKey,
    );
    const linesJson: CheckoutWorkflowLine[] = dto.items.map((item) => ({
      variantId: item.variantId,
      sku: item.sku,
      name: item.name,
      qty: item.qty,
      unitPrice: item.unitPrice,
    }));
    const totalAmount = linesJson.reduce(
      (sum, line) => sum + Math.round(Number(line.qty) * line.unitPrice),
      0,
    );

    const workflow = new CheckoutWorkflowEntity();
    workflow.id = checkoutId;
    workflow.tenantId = tenantId;
    workflow.idempotencyKey = idempotencyKey;
    workflow.requestSha256 = requestSha256;
    workflow.branchId = dto.branchId;
    workflow.warehouseId = dto.warehouseId;
    workflow.paymentMethod = dto.paymentMethod;
    workflow.customerName = dto.customerName ?? null;
    workflow.linesJson = linesJson;
    workflow.totalAmount = totalAmount;
    workflow.state = 'RESERVING';
    workflow.reservationIdempotencyKey = reservationIdempotencyKey;
    workflow.reservationId = null;
    workflow.orderId = null;
    workflow.lastError = null;
    workflow.createdBy = accountId;
    workflow.createdAt = new Date();
    workflow.updatedAt = new Date();

    await checkoutsRepo.save(workflow);

    return this.executeReservationAndConfirm(workflow, false);
  }

  async getCheckout(
    checkoutId: string,
    scope: BranchScope,
  ): Promise<CheckoutWorkflowResponse> {
    const checkoutsRepo = this.requireCheckoutsRepo();
    const workflow = await checkoutsRepo.findOne({
      where: { id: checkoutId },
    });
    if (!workflow || !branchAllowed(scope, workflow.branchId)) {
      throw new NotFoundException({
        errorCode: 'CHECKOUT_NOT_FOUND',
        message: 'Checkout workflow not found',
      });
    }
    return this.toCheckoutResponse(workflow, false);
  }

  /**
   * Deterministic recovery for a checkout workflow stuck in `RECOVERY_PENDING`
   * after an ambiguous network timeout calling Inventory (`POST /internal/v1/reservations`).
   */
  async recoverCheckout(
    checkoutId: string,
    scope: BranchScope,
  ): Promise<CheckoutWorkflowResponse> {
    const checkoutsRepo = this.requireCheckoutsRepo();
    const workflow = await checkoutsRepo.findOne({
      where: { id: checkoutId },
    });
    if (!workflow || !branchAllowed(scope, workflow.branchId)) {
      throw new NotFoundException({
        errorCode: 'CHECKOUT_NOT_FOUND',
        message: 'Checkout workflow not found',
      });
    }
    if (workflow.state === 'CONFIRMED') {
      return this.toCheckoutResponse(workflow, true);
    }
    return this.reconcileCheckout(workflow, false);
  }

  async cancelCheckout(
    checkoutId: string,
    scope: BranchScope,
  ): Promise<CheckoutWorkflowResponse> {
    const checkoutsRepo = this.requireCheckoutsRepo();
    const workflow = await checkoutsRepo.findOne({
      where: { id: checkoutId },
    });
    if (!workflow || !branchAllowed(scope, workflow.branchId)) {
      throw new NotFoundException({
        errorCode: 'CHECKOUT_NOT_FOUND',
        message: 'Checkout workflow not found',
      });
    }
    if (workflow.state === 'CANCELLED') {
      return this.toCheckoutResponse(workflow, true);
    }
    if (workflow.reservationId) {
      await this.inventory.releaseWarehouseReservation(
        workflow.reservationId,
        'CHECKOUT_CANCELLED',
      );
    }
    workflow.state = 'CANCELLED';
    workflow.updatedAt = new Date();
    await checkoutsRepo.save(workflow);
    return this.toCheckoutResponse(workflow, false);
  }

  async list(
    query: ListOrdersReqDto,
    scope: BranchScope,
  ): Promise<Page<OrderRes>> {
    const branchIds = branchFilter(
      scope,
      query.branchId,
      'ORDER_NOT_FOUND',
      'Branch not found',
    );
    const [rows, total] =
      branchIds?.length === 0
        ? [[], 0]
        : await this.orders.findAndCount({
            where: branchIds ? { branchId: In(branchIds) } : {},
            order: { createdAt: 'DESC' },
            take: query.limit,
            skip: (query.page - 1) * query.limit,
          });
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    return {
      data: rows.map(toOrderRes),
      pagination: {
        limit: query.limit,
        currentPage: query.page,
        ...(query.page < totalPages ? { nextPage: query.page + 1 } : {}),
        totalRecords: total,
        totalPages,
      },
    };
  }

  async get(id: string, scope: BranchScope): Promise<OrderRes> {
    const order = await this.orders.findOne({
      where: { id },
      relations: { items: true },
    });
    if (!order || !branchAllowed(scope, order.branchId)) {
      // also another store's or another branch's order: never revealed (api-conventions §6, ADR-0020)
      throw new NotFoundException();
    }
    return toOrderRes(order);
  }

  private async reconcileCheckout(
    workflow: CheckoutWorkflowEntity,
    replayed: boolean,
  ): Promise<CheckoutWorkflowResponse> {
    if (workflow.state === 'STOCK_RESERVED' && workflow.reservationId) {
      return this.confirmReservedOrder(workflow, replayed);
    }
    return this.executeReservationAndConfirm(workflow, replayed);
  }

  private async executeReservationAndConfirm(
    workflow: CheckoutWorkflowEntity,
    replayed: boolean,
  ): Promise<CheckoutWorkflowResponse> {
    const checkoutsRepo = this.requireCheckoutsRepo();
    let reserveOutcome;
    try {
      reserveOutcome = await this.inventory.reserveWarehouseStock(
        workflow.reservationIdempotencyKey,
        {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: workflow.id,
          ttlSeconds: 900,
          lines: workflow.linesJson.map((line) => ({
            warehouseId: workflow.warehouseId,
            skuId: line.variantId,
            qty: line.qty,
          })),
        },
      );
    } catch (error) {
      workflow.state = 'RECOVERY_PENDING';
      workflow.lastError =
        error instanceof Error ? error.message : 'Inventory unreachable';
      workflow.updatedAt = new Date();
      await checkoutsRepo.save(workflow);

      throw new ServiceUnavailableException({
        errorCode: SalesErrorCode.CHECKOUT_RECOVERY_PENDING,
        message:
          'Inventory reservation outcome is ambiguous; checkout placed in RECOVERY_PENDING',
        details: {
          checkoutId: workflow.id,
          state: workflow.state,
          reservationIdempotencyKey: workflow.reservationIdempotencyKey,
        },
      });
    }

    if (reserveOutcome.status === 'INSUFFICIENT_STOCK') {
      workflow.state = 'REJECTED';
      workflow.lastError = 'INSUFFICIENT_STOCK';
      workflow.updatedAt = new Date();
      await checkoutsRepo.save(workflow);

      throw new ConflictException({
        errorCode: SalesErrorCode.OUT_OF_STOCK,
        message: 'Not enough stock for this checkout',
        details: reserveOutcome.shortages,
      });
    }

    workflow.state = 'STOCK_RESERVED';
    workflow.reservationId = reserveOutcome.reservation.reservationId;
    workflow.lastError = null;
    workflow.updatedAt = new Date();
    await checkoutsRepo.save(workflow);

    return this.confirmReservedOrder(workflow, replayed);
  }

  private async confirmReservedOrder(
    workflow: CheckoutWorkflowEntity,
    replayed: boolean,
  ): Promise<CheckoutWorkflowResponse> {
    const tenantId = TenantContext.require();
    const orderId =
      workflow.orderId ?? orderIdFor(tenantId, workflow.idempotencyKey);

    const existingOrder = await this.orders.findOne({
      where: { id: orderId },
      relations: { items: true },
    });
    if (existingOrder) {
      workflow.orderId = existingOrder.id;
      workflow.state = 'CONFIRMED';
      workflow.updatedAt = new Date();
      await this.requireCheckoutsRepo().save(workflow);
      return {
        ...(await this.toCheckoutResponse(workflow, replayed)),
        order: toOrderRes(existingOrder),
      };
    }

    const items = workflow.linesJson.map((line) => {
      const qtyInt = Math.max(1, Math.round(Number(line.qty)));
      const item = new OrderItemEntity();
      item.id = randomUUID();
      item.orderId = orderId;
      item.sku = line.sku;
      item.name = line.name;
      item.quantity = qtyInt;
      item.unitPrice = line.unitPrice;
      item.lineTotal = Math.round(Number(line.qty) * line.unitPrice);
      return item;
    });

    const order = new OrderEntity();
    order.id = orderId;
    order.code = this.newCode();
    order.branchId = workflow.branchId;
    order.status = 'completed';
    order.paymentMethod = workflow.paymentMethod;
    order.customerName = workflow.customerName;
    order.totalAmount = workflow.totalAmount;
    order.itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    order.createdBy = workflow.createdBy;
    order.createdAt = new Date();
    order.idempotencyKey = workflow.idempotencyKey;
    order.requestHash = workflow.requestSha256;

    const savedOrder = await this.orders.transaction(async (orders, em) => {
      const row = await orders.save(order);
      const savedLines = await TenantScopedRepository.forEntity(
        em,
        OrderItemEntity,
      ).save(items);

      workflow.orderId = row.id;
      workflow.state = 'CONFIRMED';
      workflow.updatedAt = new Date();
      await TenantScopedRepository.forEntity(em, CheckoutWorkflowEntity).save(
        workflow,
      );

      await this.outbox.add(em, SALES_ORDER_COMPLETED, {
        orderId: row.id,
        code: row.code,
        branchId: row.branchId,
        totalAmount: row.totalAmount,
        itemCount: row.itemCount,
        paymentMethod: row.paymentMethod,
        createdBy: workflow.createdBy,
        completedAt: new Date().toISOString(),
        items: savedLines.map((l) => ({
          sku: l.sku,
          name: l.name,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      } satisfies OrderCompletedPayload);

      row.items = savedLines;
      return row;
    });

    if (workflow.reservationId) {
      try {
        await this.inventory.commitWarehouseReservation(workflow.reservationId);
      } catch {
        // Reservation remains HELD in inventory and can be reconciled asynchronously
      }
    }

    return {
      checkoutId: workflow.id,
      tenantId: workflow.tenantId,
      branchId: workflow.branchId,
      warehouseId: workflow.warehouseId,
      state: workflow.state,
      reservationIdempotencyKey: workflow.reservationIdempotencyKey,
      reservationId: workflow.reservationId,
      orderId: savedOrder.id,
      order: toOrderRes(savedOrder),
      replayed,
    };
  }

  private async toCheckoutResponse(
    workflow: CheckoutWorkflowEntity,
    replayed: boolean,
  ): Promise<CheckoutWorkflowResponse> {
    let orderRes: OrderRes | undefined;
    if (workflow.orderId) {
      const order = await this.orders.findOne({
        where: { id: workflow.orderId },
        relations: { items: true },
      });
      if (order) {
        orderRes = toOrderRes(order);
      }
    }
    return {
      checkoutId: workflow.id,
      tenantId: workflow.tenantId,
      branchId: workflow.branchId,
      warehouseId: workflow.warehouseId,
      state: workflow.state,
      reservationIdempotencyKey: workflow.reservationIdempotencyKey,
      reservationId: workflow.reservationId,
      orderId: workflow.orderId,
      ...(orderRes ? { order: orderRes } : {}),
      replayed,
    };
  }

  private requireCheckoutsRepo(): TenantScopedRepository<CheckoutWorkflowEntity> {
    if (!this.checkouts) {
      throw new Error('CheckoutWorkflowEntity repository is not configured');
    }
    return this.checkouts;
  }

  /**
   * Gives the stock back after a failure, but only when the order is known not to
   * exist: an error after COMMIT (a dropped connection) must not free stock that a
   * stored order has sold. When that cannot be told, the hold expires by itself.
   */
  private async releaseUnlessCreated(
    orderId: string,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      if (await this.findByKey(idempotencyKey)) return;
      await this.inventory.release(orderId);
    } catch {
      // the hold expires after its time to live
    }
  }

  private findByKey(idempotencyKey: string): Promise<OrderEntity | null> {
    return this.orders.findOne({
      where: { idempotencyKey },
      relations: { items: true },
    });
  }

  /** The first result for this key, or a conflict when the request is not the same */
  private replay(order: OrderEntity, requestHash: string): CreateOrderResult {
    if (order.requestHash !== requestHash) {
      throw new ConflictException({
        errorCode: SalesErrorCode.IDEMPOTENCY_KEY_REUSED,
        message: 'The Idempotency-Key was already used for a different request',
      });
    }
    return { order: toOrderRes(order), replayed: true };
  }

  private isKeyViolation(error: unknown): boolean {
    const driver = (error as QueryFailedError)?.driverError as
      | { code?: string; constraint?: string }
      | undefined;
    return (
      error instanceof QueryFailedError &&
      driver?.code === '23505' &&
      (driver?.constraint === IDEMPOTENCY_INDEX ||
        driver?.constraint === ORDER_PRIMARY_KEY)
    );
  }

  /** A bare branch id from the request is checked against the projection, with the tenant */
  private async assertActiveBranch(branchId: string): Promise<void> {
    const branch = await this.branches.findOne({ where: { branchId } });
    if (!branch || branch.status !== 'active') {
      throw new BadRequestException({
        errorCode: SalesErrorCode.UNKNOWN_BRANCH,
        message: 'The branch does not exist in this store or is not active',
      });
    }
  }

  private newCode(): string {
    const stamp = Date.now().toString(36).toUpperCase();
    const salt = randomUUID().slice(0, 3).toUpperCase();
    return `DH-${stamp}${salt}`;
  }
}
