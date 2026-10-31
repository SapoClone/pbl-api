import { Injectable, Logger } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  OrderCompletedPayload,
  SALES_CHECKOUT_COMPLETED,
  SALES_CHECKOUT_RECONCILIATION_REQUIRED,
  SALES_ORDER_COMPLETED,
  SALES_PAYMENT_CONFIRMED,
  SALES_TENDER_RECORDED,
  SalesOrderLifecycleEventPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, In, QueryFailedError } from 'typeorm';
import { completedEventExtras } from '../../common/order-events';
import {
  CalculatedOrderQuote,
  SalesDomainError,
  SalesDomainErrorCode,
  TenderInputLine,
  TenderMethod,
  ValidatedTenderSummary,
  formatQtyMillis,
  parseQtyMillis,
  validateOrderTenders,
} from '../../domain/sales-domain';
import {
  getSchemaPrefix,
  nextTenantDocumentCode,
} from '../../infrastructure/persistence/sales-code.generator';
import {
  OrderStatusHistoryEntity,
  OrderTenderEntity,
} from '../../infrastructure/persistence/sales.entities';
import { InventoryClient } from '../../inventory/inventory.client';
import { OrderItemEntity } from '../../orders/entities/order-item.entity';
import {
  CheckoutWorkflowEntity,
  CheckoutWorkflowState,
  OrderEntity,
} from '../../orders/entities/order.entity';
import {
  BranchScope,
  assertBranchAllowed,
  branchAllowed,
  discountTierFor,
} from '../../presentation/access';
import { PosService } from '../pos/pos.service';
import { PromotionsService } from '../promotions/promotions.service';
import { ConfirmCheckoutPaymentDto, PosCheckoutDto } from './checkout.dto';

export interface PosCheckoutResult {
  checkoutId: string;
  tenantId: string;
  branchId: string;
  warehouseId: string;
  shiftId: string | null;
  state: CheckoutWorkflowState;
  reservationIdempotencyKey: string;
  reservationId: string | null;
  orderId: string | null;
  orderCode?: string;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  quote: CalculatedOrderQuote & { couponCode: string | null };
  tenders: ValidatedTenderSummary;
  replayed: boolean;
}

function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function hashPosCheckoutPayload(dto: PosCheckoutDto): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        branchId: dto.branchId,
        warehouseId: dto.warehouseId,
        shiftId: dto.shiftId ?? null,
        customerId: dto.customerId ?? null,
        orderDiscountType: dto.orderDiscountType ?? 'NONE',
        orderDiscountValue: Number(dto.orderDiscountValue ?? 0),
        couponCode: dto.couponCode?.trim().toUpperCase() ?? null,
        shippingFee: Number(dto.shippingFee ?? 0),
        paymentMethod: dto.paymentMethod ?? null,
        tenderedCash:
          dto.tenderedCash !== undefined ? Number(dto.tenderedCash) : null,
        lines: dto.lines.map((l) => ({
          variantId: l.variantId ?? null,
          skuCode: l.skuCode?.trim().toUpperCase() ?? null,
          qty: Number(l.qty),
          expectedUnitPrice:
            l.expectedUnitPrice !== undefined
              ? Number(l.expectedUnitPrice)
              : null,
          discountType: l.discountType ?? 'NONE',
          discountValue: Number(l.discountValue ?? 0),
        })),
        tenders: (dto.tenders ?? []).map((t) => ({
          method: t.method,
          amount: Number(t.amount),
          tenderedCash:
            t.tenderedCash !== undefined ? Number(t.tenderedCash) : null,
          status: t.status ?? null,
          verified: t.verified ?? null,
          externalRef: t.externalRef ?? null,
        })),
      }),
    )
    .digest('hex');
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly posService: PosService,
    private readonly promotionsService: PromotionsService,
    private readonly inventoryClient: InventoryClient,
    private readonly outbox: EventOutbox,
  ) {}

  async checkout(
    staffId: string,
    permissions: string[],
    scope: BranchScope,
    headerIdempotencyKey: string | undefined,
    dto: PosCheckoutDto,
  ): Promise<PosCheckoutResult> {
    assertBranchAllowed(
      scope,
      dto.branchId,
      'ORDER_NOT_FOUND',
      'Branch not found',
    );
    const tenantId = TenantContext.require();
    const rawKey = (headerIdempotencyKey ?? dto.idempotencyKey ?? '').trim();
    if (!rawKey) {
      throw new SalesDomainError(
        SalesDomainErrorCode.VALIDATION_ERROR,
        'Idempotency-Key header or idempotencyKey field is required',
        400,
      );
    }
    const idempotencyKey = rawKey.toLowerCase();
    const requestSha256 = hashPosCheckoutPayload(dto);
    const prefix = getSchemaPrefix(this.dataSource);

    // Step 0: Check existing checkout_workflow for idempotency
    const existingWf = await this.findWorkflowByKey(tenantId, idempotencyKey);
    if (existingWf) {
      this.assertWorkflowInScope(existingWf, scope);
      if (existingWf.requestSha256 !== requestSha256) {
        throw new SalesDomainError(
          SalesDomainErrorCode.IDEMPOTENCY_CONFLICT,
          'Idempotency-Key was already used with a different checkout payload',
          409,
          { idempotencyKey, checkoutId: existingWf.id },
        );
      }
      return this.resumeOrReplayExistingWorkflow(existingWf, staffId, true);
    }

    // Step 1: Pre-flight validation (branch active, shift open, Catalog price waterfall, discount authority, tenders)
    await this.validateBranchAndShift(tenantId, dto.branchId, dto.shiftId);

    const primaryRole = discountTierFor(permissions);
    const quote = await this.posService.resolveAndQuoteLines({
      branchId: dto.branchId,
      customerId: dto.customerId,
      lines: dto.lines,
      orderDiscountType: dto.orderDiscountType,
      orderDiscountValue: dto.orderDiscountValue,
      couponCode: dto.couponCode,
      shippingFee: dto.shippingFee,
      role: primaryRole,
      permissions,
      discountApprovedBy: dto.discountApprovedBy,
    });

    const tenderInputs = this.normalizeTenderInputs(dto, quote.grandTotal);
    const tenderSummary = validateOrderTenders(quote.grandTotal, tenderInputs);
    const primaryPaymentMethod = this.resolvePrimaryPaymentMethod(
      tenderSummary,
      dto.paymentMethod,
    );

    const checkoutId = deterministicUuid(
      `pos-chk:${tenantId}:${idempotencyKey}`,
    );
    const orderId = deterministicUuid(`pos-ord:${tenantId}:${idempotencyKey}`);
    const reservationIdempotencyKey = deterministicUuid(
      `pos-rsv:${tenantId}:${idempotencyKey}`,
    );

    // Step 2: Persist checkout_workflow in RESERVING_STOCK (and atomically claim coupon if present)
    let workflow: CheckoutWorkflowEntity;
    try {
      workflow = await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);

        // Re-check shift is still OPEN inside transaction
        if (dto.shiftId) {
          const shiftRows = await em.query(
            `SELECT status FROM ${prefix}"pos_shifts" WHERE tenant_id = $1 AND id = $2 FOR SHARE`,
            [tenantId, dto.shiftId],
          );
          if (shiftRows.length === 0 || shiftRows[0].status !== 'OPEN') {
            throw new SalesDomainError(
              SalesDomainErrorCode.SHIFT_NOT_OPEN,
              `POS shift ${dto.shiftId} is not OPEN`,
              409,
            );
          }
        }

        // Atomically claim coupon before calling Inventory so concurrent checkouts cannot over-redeem a coupon
        if (quote.couponCode) {
          const afterOrderDisc =
            quote.subtotal - quote.itemDiscountTotal - quote.orderDiscountTotal;
          await this.promotionsService.redeemCouponWithinTransaction(
            em,
            tenantId,
            quote.couponCode,
            afterOrderDisc,
            dto.branchId,
            dto.customerId ?? null,
            orderId,
          );
        }

        const wf = em.create(CheckoutWorkflowEntity, {
          id: checkoutId,
          tenantId,
          idempotencyKey,
          requestSha256,
          branchId: dto.branchId,
          warehouseId: dto.warehouseId,
          paymentMethod: primaryPaymentMethod,
          customerName: dto.customerName ?? 'Walk-in Customer',
          linesJson: quote.lines.map((l) => ({
            variantId: l.variantId,
            sku: l.skuCode,
            name: l.productName,
            qty: l.baseQty,
            unitPrice: l.unitPrice,
          })),
          totalAmount: quote.grandTotal,
          state: 'RESERVING_STOCK',
          reservationIdempotencyKey,
          reservationId: null,
          orderId: null,
          lastError: null,
          shiftId: dto.shiftId ?? null,
          draftId: dto.draftId ?? null,
          customerId: dto.customerId ?? null,
          couponCode: quote.couponCode,
          quoteJson: quote,
          tendersJson: tenderSummary,
          commitConfirmed: false,
          retryCount: 0,
          createdBy: staffId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return em.save(CheckoutWorkflowEntity, wf);
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === '23505'
      ) {
        const raced = await this.findWorkflowByKey(tenantId, idempotencyKey);
        if (raced) {
          if (raced.requestSha256 !== requestSha256) {
            throw new SalesDomainError(
              SalesDomainErrorCode.IDEMPOTENCY_CONFLICT,
              'Idempotency-Key was already used with a different checkout payload',
              409,
            );
          }
          return this.resumeOrReplayExistingWorkflow(raced, staffId, true);
        }
      }
      throw error;
    }

    // Step 3: Reserve Stock in Inventory via S2S HTTP (Zero DB transaction held open!)
    const reservationId = await this.executeReserveStep(
      tenantId,
      workflow,
      quote,
      orderId,
    );

    if (dto.simulateFailureAfterReserve) {
      await this.updateWorkflowState(tenantId, workflow.id, {
        state: 'RECOVERY_PENDING',
        reservationId,
        lastError: 'SIMULATED_FAILURE_AFTER_RESERVE',
      });
      throw new SalesDomainError(
        SalesDomainErrorCode.STOCK_RESERVATION_UNKNOWN,
        'Simulated failure after stock reservation; checkout placed in RECOVERY_PENDING',
        503,
        {
          checkoutId: workflow.id,
          state: 'RECOVERY_PENDING',
          reservationId,
        },
      );
    }

    // Step 4: Check Payment Settlement Status
    if (!tenderSummary.allConfirmed) {
      await this.updateWorkflowState(tenantId, workflow.id, {
        state: 'AWAITING_PAYMENT',
        reservationId,
      });
      return {
        checkoutId: workflow.id,
        tenantId,
        branchId: workflow.branchId,
        warehouseId: workflow.warehouseId,
        shiftId: workflow.shiftId ?? null,
        state: 'AWAITING_PAYMENT',
        reservationIdempotencyKey: workflow.reservationIdempotencyKey,
        reservationId,
        orderId: null,
        paymentStatus: tenderSummary.paymentStatus,
        fulfillmentStatus: 'RESERVED',
        quote,
        tenders: tenderSummary,
        replayed: false,
      };
    }

    // Step 5 & 6: Commit Stock Reservation & Finalize Local Order + Tenders + Shift Cash + Outbox
    return this.commitAndFinalizeCheckout(
      tenantId,
      workflow.id,
      reservationId,
      orderId,
      quote,
      tenderSummary,
      staffId,
      false,
      Boolean(dto.simulateFailureAfterCommit),
    );
  }

  async getCheckout(
    checkoutId: string,
    scope: BranchScope,
  ): Promise<PosCheckoutResult> {
    const tenantId = TenantContext.require();
    const wf = await this.findWorkflowById(tenantId, checkoutId);
    if (!wf || !branchAllowed(scope, wf.branchId)) {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_NOT_FOUND,
        `Checkout workflow ${checkoutId} not found`,
        404,
      );
    }
    return this.buildCheckoutResultFromWorkflow(tenantId, wf, false);
  }

  async retryCheckout(
    checkoutId: string,
    actorId: string,
    scope: BranchScope,
  ): Promise<PosCheckoutResult> {
    const tenantId = TenantContext.require();
    const wf = await this.findWorkflowById(tenantId, checkoutId);
    if (!wf || !branchAllowed(scope, wf.branchId)) {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_NOT_FOUND,
        `Checkout workflow ${checkoutId} not found`,
        404,
      );
    }
    return this.resumeOrReplayExistingWorkflow(wf, actorId, true);
  }

  async confirmCheckoutPayment(
    checkoutId: string,
    actorId: string,
    scope: BranchScope,
    dto: ConfirmCheckoutPaymentDto,
  ): Promise<PosCheckoutResult> {
    const tenantId = TenantContext.require();
    const wf = await this.findWorkflowById(tenantId, checkoutId);
    if (!wf || !branchAllowed(scope, wf.branchId)) {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_NOT_FOUND,
        `Checkout workflow ${checkoutId} not found`,
        404,
      );
    }

    if (wf.state === 'CONFIRMED' || wf.state === 'COMPLETED') {
      return this.buildCheckoutResultFromWorkflow(tenantId, wf, true);
    }

    if (wf.state === 'CANCELLED' || wf.state === 'REJECTED') {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_INVALID_STATE,
        `Cannot confirm payment on checkout in state ${wf.state}`,
        409,
      );
    }

    const quote = wf.quoteJson as CalculatedOrderQuote & {
      couponCode: string | null;
    };
    const prevTenders = wf.tendersJson as ValidatedTenderSummary;
    const confirmedTenders: ValidatedTenderSummary = {
      ...prevTenders,
      totalConfirmed: prevTenders.totalAllocated,
      allConfirmed: true,
      paymentStatus: 'PAID',
      tenders: prevTenders.tenders.map((t) => ({
        ...t,
        status: 'CONFIRMED',
        externalRef: t.externalRef ?? dto.externalRef ?? 'CONFIRMED-CALLBACK',
      })),
    };

    await this.updateWorkflowState(tenantId, wf.id, {
      tendersJson: confirmedTenders,
    });

    const orderId =
      wf.orderId ??
      deterministicUuid(`pos-ord:${tenantId}:${wf.idempotencyKey}`);
    let reservationId = wf.reservationId;
    if (!reservationId) {
      reservationId = await this.executeReserveStep(
        tenantId,
        wf,
        quote,
        orderId,
      );
    }

    return this.commitAndFinalizeCheckout(
      tenantId,
      wf.id,
      reservationId,
      orderId,
      quote,
      confirmedTenders,
      actorId,
      false,
      false,
    );
  }

  async cancelCheckout(
    checkoutId: string,
    actorId: string,
    scope: BranchScope,
    reason?: string,
  ): Promise<PosCheckoutResult> {
    const tenantId = TenantContext.require();
    const wf = await this.findWorkflowById(tenantId, checkoutId);
    if (!wf || !branchAllowed(scope, wf.branchId)) {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_NOT_FOUND,
        `Checkout workflow ${checkoutId} not found`,
        404,
      );
    }
    if (wf.state === 'CONFIRMED' || wf.state === 'COMPLETED') {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_ALREADY_COMPLETED,
        'Completed checkout cannot be cancelled; use Return workflow instead',
        409,
      );
    }
    if (wf.state === 'CANCELLED') {
      return this.buildCheckoutResultFromWorkflow(tenantId, wf, true);
    }

    if (wf.reservationId) {
      await this.inventoryClient.releaseWarehouseReservation(
        wf.reservationId,
        reason ?? 'POS_CHECKOUT_CANCELLED',
      );
    }

    const orderId = deterministicUuid(
      `pos-ord:${tenantId}:${wf.idempotencyKey}`,
    );
    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      await this.promotionsService.releaseCouponClaimWithinTransaction(
        em,
        tenantId,
        orderId,
      );
      const prefix = getSchemaPrefix(this.dataSource);
      await em.query(
        `UPDATE ${prefix}"checkout_workflow"
         SET state = 'CANCELLED', last_error = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, wf.id, reason ?? 'CANCELLED_BY_USER'],
      );
    });

    const updated = await this.findWorkflowById(tenantId, checkoutId);
    return this.buildCheckoutResultFromWorkflow(tenantId, updated!, false);
  }

  /**
   * Background reconciliation worker for stuck checkout workflows.
   * Safe to invoke periodically or on demand.
   */
  async reconcilePendingCheckouts(scope: BranchScope): Promise<{
    inspected: number;
    finalized: number;
    cancelled: number;
    escalated: number;
  }> {
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);

    const inBranches = scope === null ? {} : { branchId: In([...scope]) };
    const stuckRows: CheckoutWorkflowEntity[] =
      await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        return em.getRepository(CheckoutWorkflowEntity).find({
          where: [
            { tenantId, state: 'RESERVING_STOCK', ...inBranches },
            { tenantId, state: 'STOCK_RESERVED', ...inBranches },
            { tenantId, state: 'COMMITTING_STOCK', ...inBranches },
            { tenantId, state: 'FINALIZING', ...inBranches },
            { tenantId, state: 'RECOVERY_PENDING', ...inBranches },
          ],
          order: { createdAt: 'ASC' },
          take: 50,
        });
      });

    let finalized = 0;
    let cancelled = 0;
    let escalated = 0;

    for (const wf of stuckRows) {
      if (!wf.quoteJson || !wf.tendersJson) {
        continue;
      }
      try {
        const res = await this.resumeOrReplayExistingWorkflow(
          wf,
          wf.createdBy,
          true,
        );
        if (res.state === 'CONFIRMED' || res.state === 'COMPLETED') {
          finalized++;
        } else if (res.state === 'CANCELLED' || res.state === 'REJECTED') {
          cancelled++;
        }
      } catch (error) {
        const nextRetry = Number(wf.retryCount ?? 0) + 1;
        if (nextRetry >= 5) {
          await this.dataSource.transaction(async (em) => {
            await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
              tenantId,
            ]);
            await em.query(
              `UPDATE ${prefix}"checkout_workflow"
               SET state = 'REQUIRES_RECONCILIATION',
                   retry_count = $3,
                   last_error = $4,
                   updated_at = now()
               WHERE tenant_id = $1 AND id = $2`,
              [
                tenantId,
                wf.id,
                nextRetry,
                error instanceof Error ? error.message : String(error),
              ],
            );
            await this.outbox.add(em, SALES_CHECKOUT_RECONCILIATION_REQUIRED, {
              checkoutId: wf.id,
              branchId: wf.branchId,
              warehouseId: wf.warehouseId,
              reservationId: wf.reservationId,
              retryCount: nextRetry,
              reason: error instanceof Error ? error.message : String(error),
              occurredAt: new Date().toISOString(),
            });
          });
          escalated++;
        } else {
          await this.updateWorkflowState(tenantId, wf.id, {
            retryCount: nextRetry,
            lastError: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return {
      inspected: stuckRows.length,
      finalized,
      cancelled,
      escalated,
    };
  }

  private async resumeOrReplayExistingWorkflow(
    wf: CheckoutWorkflowEntity,
    actorId: string,
    replayed: boolean,
  ): Promise<PosCheckoutResult> {
    const tenantId = wf.tenantId;
    if (wf.state === 'CONFIRMED' || wf.state === 'COMPLETED') {
      return this.buildCheckoutResultFromWorkflow(tenantId, wf, replayed);
    }
    if (wf.state === 'AWAITING_PAYMENT') {
      return this.buildCheckoutResultFromWorkflow(tenantId, wf, replayed);
    }
    if (wf.state === 'REJECTED') {
      throw new SalesDomainError(
        SalesDomainErrorCode.INSUFFICIENT_STOCK,
        wf.lastError || 'Insufficient stock for checkout',
        409,
      );
    }
    if (wf.state === 'CANCELLED') {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_ALREADY_CANCELLED,
        'Checkout workflow was cancelled',
        409,
      );
    }

    const quote = wf.quoteJson as CalculatedOrderQuote & {
      couponCode: string | null;
    };
    const tenderSummary = wf.tendersJson as ValidatedTenderSummary;
    const orderId =
      wf.orderId ??
      deterministicUuid(`pos-ord:${tenantId}:${wf.idempotencyKey}`);

    // Recover or execute reservation
    let reservationId = wf.reservationId;
    let reservationAlreadyCommitted = Boolean(wf.commitConfirmed);

    if (!reservationId) {
      const existingRsv =
        await this.inventoryClient.getWarehouseReservationByKey(
          wf.reservationIdempotencyKey,
          'sales',
        );
      if (existingRsv) {
        if (
          existingRsv.state === 'RELEASED' ||
          existingRsv.state === 'EXPIRED'
        ) {
          await this.cancelExpiredWorkflow(
            tenantId,
            wf.id,
            orderId,
            existingRsv.state,
          );
        }
        reservationId = existingRsv.reservationId;
        if (existingRsv.state === 'COMMITTED') {
          reservationAlreadyCommitted = true;
        }
        await this.updateWorkflowState(tenantId, wf.id, {
          state: reservationAlreadyCommitted ? 'FINALIZING' : 'STOCK_RESERVED',
          reservationId,
          commitConfirmed: reservationAlreadyCommitted,
        });
      } else {
        reservationId = await this.executeReserveStep(
          tenantId,
          wf,
          quote,
          orderId,
        );
      }
    } else if (!reservationAlreadyCommitted) {
      const rsvStatus =
        await this.inventoryClient.getWarehouseReservation(reservationId);
      if (rsvStatus) {
        if (rsvStatus.state === 'RELEASED' || rsvStatus.state === 'EXPIRED') {
          await this.cancelExpiredWorkflow(
            tenantId,
            wf.id,
            orderId,
            rsvStatus.state,
          );
        }
        if (rsvStatus.state === 'COMMITTED') {
          reservationAlreadyCommitted = true;
        }
      }
    }

    if (!tenderSummary.allConfirmed) {
      await this.updateWorkflowState(tenantId, wf.id, {
        state: 'AWAITING_PAYMENT',
        reservationId,
      });
      const updated = await this.findWorkflowById(tenantId, wf.id);
      return this.buildCheckoutResultFromWorkflow(tenantId, updated!, replayed);
    }

    return this.commitAndFinalizeCheckout(
      tenantId,
      wf.id,
      reservationId,
      orderId,
      quote,
      tenderSummary,
      actorId,
      replayed,
      false,
      reservationAlreadyCommitted,
    );
  }

  private async cancelExpiredWorkflow(
    tenantId: string,
    checkoutId: string,
    orderId: string,
    rsvState: string,
  ): Promise<never> {
    const prefix = getSchemaPrefix(this.dataSource);
    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      await this.promotionsService.releaseCouponClaimWithinTransaction(
        em,
        tenantId,
        orderId,
      );
      await em.query(
        `UPDATE ${prefix}"checkout_workflow"
         SET state = 'CANCELLED', last_error = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, checkoutId, `RESERVATION_${rsvState}`],
      );
    });
    throw new SalesDomainError(
      SalesDomainErrorCode.STOCK_RESERVATION_FAILED,
      `Warehouse reservation for checkout is ${rsvState}`,
      409,
    );
  }

  private async executeReserveStep(
    tenantId: string,
    workflow: CheckoutWorkflowEntity,
    quote: CalculatedOrderQuote & { couponCode: string | null },
    orderId: string,
  ): Promise<string> {
    // Coalesce baseQty by skuCode so multi-line carts with same SKU reserve atomically
    const qtyBySku = new Map<string, bigint>();
    for (const line of quote.lines) {
      const prev = qtyBySku.get(line.skuCode) ?? 0n;
      qtyBySku.set(line.skuCode, prev + parseQtyMillis(line.baseQty));
    }

    const rsvLines = Array.from(qtyBySku.entries()).map(([skuId, millis]) => ({
      warehouseId: workflow.warehouseId,
      skuId,
      qty: formatQtyMillis(millis),
    }));

    let reserveResult;
    try {
      reserveResult = await this.inventoryClient.reserveWarehouseStock(
        workflow.reservationIdempotencyKey,
        {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: workflow.id,
          lines: rsvLines,
        },
      );
    } catch (error) {
      // Timeout or network error: attempt deterministic lookup by idempotency key before failing
      await this.updateWorkflowState(tenantId, workflow.id, {
        state: 'RECOVERY_PENDING',
        lastError: error instanceof Error ? error.message : String(error),
      });

      try {
        const recovered =
          await this.inventoryClient.getWarehouseReservationByKey(
            workflow.reservationIdempotencyKey,
            'sales',
          );
        if (
          recovered &&
          (recovered.state === 'HELD' || recovered.state === 'COMMITTED')
        ) {
          await this.updateWorkflowState(tenantId, workflow.id, {
            state: 'STOCK_RESERVED',
            reservationId: recovered.reservationId,
            lastError: null,
          });
          return recovered.reservationId;
        }
      } catch {
        // Still unreachable
      }

      throw new SalesDomainError(
        SalesDomainErrorCode.STOCK_RESERVATION_UNKNOWN,
        'Inventory reservation timed out; checkout placed in RECOVERY_PENDING',
        503,
        {
          checkoutId: workflow.id,
          state: 'RECOVERY_PENDING',
          reservationIdempotencyKey: workflow.reservationIdempotencyKey,
        },
      );
    }

    if (reserveResult.status === 'INSUFFICIENT_STOCK') {
      const prefix = getSchemaPrefix(this.dataSource);
      await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        await this.promotionsService.releaseCouponClaimWithinTransaction(
          em,
          tenantId,
          orderId,
        );
        await em.query(
          `UPDATE ${prefix}"checkout_workflow"
           SET state = 'REJECTED', last_error = $3, updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, workflow.id, JSON.stringify(reserveResult.shortages)],
        );
      });

      throw new SalesDomainError(
        SalesDomainErrorCode.INSUFFICIENT_STOCK,
        'Insufficient available stock in warehouse for POS checkout',
        409,
        { shortages: reserveResult.shortages },
      );
    }

    const reservationId = reserveResult.reservation.reservationId;
    await this.updateWorkflowState(tenantId, workflow.id, {
      state: 'STOCK_RESERVED',
      reservationId,
      lastError: null,
    });

    return reservationId;
  }

  private async commitAndFinalizeCheckout(
    tenantId: string,
    checkoutId: string,
    reservationId: string,
    orderId: string,
    quote: CalculatedOrderQuote & { couponCode: string | null },
    tenderSummary: ValidatedTenderSummary,
    actorId: string,
    replayed: boolean,
    simulateFailureAfterCommit: boolean,
    alreadyCommitted = false,
  ): Promise<PosCheckoutResult> {
    if (!alreadyCommitted) {
      await this.updateWorkflowState(tenantId, checkoutId, {
        state: 'COMMITTING_STOCK',
        reservationId,
      });

      try {
        await this.inventoryClient.commitWarehouseReservation(reservationId);
      } catch (error) {
        // Check if reservation was actually expired/released or if Inventory timed out
        try {
          const check =
            await this.inventoryClient.getWarehouseReservation(reservationId);
          if (
            check &&
            (check.state === 'EXPIRED' || check.state === 'RELEASED')
          ) {
            await this.cancelExpiredWorkflow(
              tenantId,
              checkoutId,
              orderId,
              check.state,
            );
          }
          if (check && check.state === 'COMMITTED') {
            // Commit actually succeeded despite network error!
            alreadyCommitted = true;
          }
        } catch {
          // Ignore secondary lookup error
        }

        if (!alreadyCommitted) {
          await this.updateWorkflowState(tenantId, checkoutId, {
            state: 'RECOVERY_PENDING',
            reservationId,
            lastError: error instanceof Error ? error.message : String(error),
          });
          throw new SalesDomainError(
            SalesDomainErrorCode.STOCK_COMMIT_PENDING,
            'Inventory reservation commit outcome unknown; checkout placed in RECOVERY_PENDING',
            503,
            { checkoutId, reservationId, state: 'RECOVERY_PENDING' },
          );
        }
      }
    }

    await this.updateWorkflowState(tenantId, checkoutId, {
      state: 'FINALIZING',
      reservationId,
      commitConfirmed: true,
    });

    if (simulateFailureAfterCommit) {
      await this.updateWorkflowState(tenantId, checkoutId, {
        state: 'RECOVERY_PENDING',
        reservationId,
        commitConfirmed: true,
        lastError: 'SIMULATED_FAILURE_AFTER_COMMIT',
      });
      throw new SalesDomainError(
        SalesDomainErrorCode.STOCK_COMMIT_PENDING,
        'Simulated failure after stock commit; checkout placed in RECOVERY_PENDING for reconciliation',
        503,
        { checkoutId, reservationId, commitConfirmed: true },
      );
    }

    // Step 6: Atomic local DB transaction to create Order, OrderItems, Tenders, StatusHistory, Shift cash & Outbox
    const prefix = getSchemaPrefix(this.dataSource);
    const finalized = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const wfRows: CheckoutWorkflowEntity[] = await em
        .getRepository(CheckoutWorkflowEntity)
        .find({
          where: { id: checkoutId, tenantId },
          lock: { mode: 'pessimistic_write' },
        });
      const wf = wfRows[0];
      if (!wf) {
        throw new SalesDomainError(
          SalesDomainErrorCode.ORDER_NOT_FOUND,
          `Checkout workflow ${checkoutId} not found`,
          404,
        );
      }

      const existingOrder = await em.getRepository(OrderEntity).findOne({
        where: { id: wf.orderId ?? orderId, tenantId },
      });
      if (
        existingOrder ||
        wf.state === 'CONFIRMED' ||
        wf.state === 'COMPLETED'
      ) {
        if (wf.state !== 'CONFIRMED' && wf.state !== 'COMPLETED') {
          wf.state = 'CONFIRMED';
          wf.orderId = existingOrder?.id ?? orderId;
          await em.save(CheckoutWorkflowEntity, wf);
        }
        return {
          wf,
          orderCode: existingOrder?.code ?? '',
          alreadyDone: true,
        };
      }

      const orderCode = await nextTenantDocumentCode(em, tenantId, 'HD');
      const now = new Date();
      const grandTotalInt = quote.grandTotal;
      const itemCount = quote.lines.reduce(
        (sum, l) => sum + Math.max(1, Math.round(Number(l.qty))),
        0,
      );

      // Ensure coupon claim exists if couponCode was used
      if (quote.couponCode) {
        const afterOrderDisc =
          quote.subtotal - quote.itemDiscountTotal - quote.orderDiscountTotal;
        await this.promotionsService.redeemCouponWithinTransaction(
          em,
          tenantId,
          quote.couponCode,
          afterOrderDisc,
          wf.branchId,
          wf.customerId ?? null,
          orderId,
        );
      }

      const orderEntity = em.create(OrderEntity, {
        id: orderId,
        tenantId,
        code: orderCode,
        branchId: wf.branchId,
        warehouseId: wf.warehouseId,
        shiftId: wf.shiftId ?? null,
        customerId: wf.customerId ?? null,
        customerName: wf.customerName,
        channelType: 'POS',
        status: 'completed',
        orderStatus: 'COMPLETED',
        paymentStatus: tenderSummary.paymentStatus,
        fulfillmentStatus: 'FULFILLED',
        paymentMethod: wf.paymentMethod,
        subtotal: quote.subtotal,
        itemDiscountTotal: quote.itemDiscountTotal,
        orderDiscountType: quote.orderDiscountType,
        orderDiscountValue: quote.orderDiscountValue,
        orderDiscountTotal: quote.orderDiscountTotal,
        promotionDiscountTotal: quote.promotionDiscountTotal,
        couponCode: quote.couponCode,
        shippingFee: quote.shippingFee,
        taxTotal: quote.taxTotal,
        grandTotal: quote.grandTotal,
        paidAmount: tenderSummary.totalConfirmed,
        refundedAmount: 0,
        totalAmount: grandTotalInt,
        itemCount,
        reservationId,
        createdBy: wf.createdBy,
        idempotencyKey: wf.id,
        requestHash: wf.requestSha256,
        version: 1,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });
      await em.save(OrderEntity, orderEntity);

      // Persist immutable order_items snapshots
      const itemEntities: OrderItemEntity[] = quote.lines.map((line) =>
        em.create(OrderItemEntity, {
          id: randomUUID(),
          tenantId,
          orderId,
          variantId: line.variantId,
          productId: line.productId,
          sku: line.skuCode,
          name: line.productName,
          variantLabel: line.variantLabel,
          unitCode: line.unitCode,
          conversionFactor: line.conversionFactor,
          quantity: Math.max(1, Math.round(Number(line.qty))),
          qty: line.qty,
          baseQty: line.baseQty,
          unitPrice: line.unitPrice,
          lineGross: line.lineGross,
          itemDiscountType: line.itemDiscountType,
          itemDiscountValue: line.itemDiscountValue,
          itemDiscountAmount: line.itemDiscountAmount,
          allocatedOrderDiscount: line.allocatedOrderDiscount,
          lineNet: line.lineNet,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
          unitCostSnapshot: line.unitCostSnapshot,
          returnedQty: '0.000',
          refundedAmount: 0,
        }),
      );
      await em.save(OrderItemEntity, itemEntities);

      // Persist order_tenders
      const tenderEntities: OrderTenderEntity[] = tenderSummary.tenders.map(
        (t, idx) =>
          em.create(OrderTenderEntity, {
            id: randomUUID(),
            tenantId,
            orderId,
            checkoutId: wf.id,
            shiftId: wf.shiftId ?? null,
            idempotencyKey: `${wf.id}:tender:${idx + 1}`,
            method: t.method,
            amount: t.amount,
            tenderedCash: t.tenderedCash,
            changeDue: t.changeDue,
            status: t.status,
            externalRef: t.externalRef,
            confirmedBy: t.status === 'CONFIRMED' ? actorId : null,
            confirmedAt: t.status === 'CONFIRMED' ? now : null,
            createdAt: now,
          }),
      );
      await em.save(OrderTenderEntity, tenderEntities);

      // Persist initial -> completed order_status_history
      const historyEntity = em.create(OrderStatusHistoryEntity, {
        id: randomUUID(),
        tenantId,
        orderId,
        fromOrderStatus: null,
        toOrderStatus: 'COMPLETED',
        fromPaymentStatus: null,
        toPaymentStatus: tenderSummary.paymentStatus,
        fromFulfillmentStatus: null,
        toFulfillmentStatus: 'FULFILLED',
        reason: 'POS_CHECKOUT_FINALIZED',
        actorId,
        createdAt: now,
      });
      await em.save(OrderStatusHistoryEntity, historyEntity);

      // Update POS shift cash_sales_total and expected_cash if cash was collected
      if (wf.shiftId && tenderSummary.totalCashSales > 0) {
        await em.query(
          `UPDATE ${prefix}"pos_shifts"
           SET cash_sales_total = cash_sales_total + $3::bigint,
               expected_cash = expected_cash + $3::bigint,
               version = version + 1
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, wf.shiftId, tenderSummary.totalCashSales],
        );
      }

      // Mark POS draft as CONVERTED if checkout originated from a draft
      if (wf.draftId) {
        await em.query(
          `UPDATE ${prefix}"pos_drafts"
           SET status = 'CONVERTED', updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, wf.draftId],
        );
      }

      // Update checkout_workflow to CONFIRMED
      wf.state = 'CONFIRMED';
      wf.orderId = orderId;
      wf.reservationId = reservationId;
      wf.commitConfirmed = true;
      wf.lastError = null;
      wf.updatedAt = now;
      await em.save(CheckoutWorkflowEntity, wf);

      const totalDiscountVnd =
        (quote.itemDiscountTotal ?? 0) +
        (quote.orderDiscountTotal ?? 0) +
        (quote.promotionDiscountTotal ?? 0);

      // Emit transactional outbox events
      await this.outbox.add(em, SALES_ORDER_COMPLETED, {
        orderId,
        code: orderCode,
        branchId: wf.branchId,
        customerId: wf.customerId ?? null,
        subtotal: quote.subtotal,
        discountTotal: totalDiscountVnd,
        taxTotal: quote.taxTotal,
        grandTotal: quote.grandTotal,
        totalAmount: grandTotalInt,
        itemCount,
        paymentMethod: wf.paymentMethod,
        createdBy: wf.createdBy,
        completedAt: now.toISOString(),
        items: quote.lines.map((l) => ({
          sku: l.skuCode,
          name: l.productName,
          quantity: Math.max(1, Math.round(Number(l.qty))),
          unitPrice: l.unitPrice,
          variantId: l.variantId,
        })),
        ...completedEventExtras({ channelType: 'POS' }, quote.lines),
      } satisfies OrderCompletedPayload);

      await this.outbox.add(em, SALES_CHECKOUT_COMPLETED, {
        orderId,
        code: orderCode,
        branchId: wf.branchId,
        customerId: wf.customerId ?? null,
        channelType: 'POS',
        orderStatus: 'COMPLETED',
        paymentStatus: tenderSummary.paymentStatus,
        fulfillmentStatus: 'FULFILLED',
        subtotal: quote.subtotal,
        discountTotal: totalDiscountVnd,
        taxTotal: quote.taxTotal,
        grandTotal: quote.grandTotal,
        actorId,
        occurredAt: now.toISOString(),
      } satisfies SalesOrderLifecycleEventPayload);

      await this.outbox.add(em, SALES_TENDER_RECORDED, {
        orderId,
        checkoutId: wf.id,
        shiftId: wf.shiftId ?? null,
        totalConfirmed: tenderSummary.totalConfirmed,
        totalCashSales: tenderSummary.totalCashSales,
        totalChangeDue: tenderSummary.totalChangeDue,
        occurredAt: now.toISOString(),
      });

      if (tenderSummary.allConfirmed) {
        await this.outbox.add(em, SALES_PAYMENT_CONFIRMED, {
          orderId,
          checkoutId: wf.id,
          amount: tenderSummary.totalConfirmed,
          paymentStatus: tenderSummary.paymentStatus,
          occurredAt: now.toISOString(),
        });
      }

      return { wf, orderCode, alreadyDone: false };
    });

    return {
      checkoutId: finalized.wf.id,
      tenantId,
      branchId: finalized.wf.branchId,
      warehouseId: finalized.wf.warehouseId,
      shiftId: finalized.wf.shiftId ?? null,
      state: 'CONFIRMED',
      reservationIdempotencyKey: finalized.wf.reservationIdempotencyKey,
      reservationId,
      orderId,
      orderCode: finalized.orderCode,
      paymentStatus: tenderSummary.paymentStatus,
      fulfillmentStatus: 'FULFILLED',
      quote,
      tenders: tenderSummary,
      replayed: replayed || finalized.alreadyDone,
    };
  }

  private async validateBranchAndShift(
    tenantId: string,
    branchId: string,
    shiftId?: string,
  ): Promise<void> {
    const prefix = getSchemaPrefix(this.dataSource);
    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const branchRows = await em.query(
        `SELECT status FROM ${prefix}"branch_projection" WHERE tenant_id = $1 AND branch_id = $2 LIMIT 1`,
        [tenantId, branchId],
      );
      if (branchRows.length === 0 || branchRows[0].status !== 'active') {
        throw new SalesDomainError(
          SalesDomainErrorCode.UNKNOWN_BRANCH,
          `Branch ${branchId} does not exist or is not active`,
          400,
        );
      }

      if (shiftId) {
        const shiftRows = await em.query(
          `SELECT status, branch_id FROM ${prefix}"pos_shifts" WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
          [tenantId, shiftId],
        );
        if (shiftRows.length === 0) {
          throw new SalesDomainError(
            SalesDomainErrorCode.SHIFT_NOT_FOUND,
            `POS shift ${shiftId} not found`,
            404,
          );
        }
        if (shiftRows[0].branch_id !== branchId) {
          throw new SalesDomainError(
            SalesDomainErrorCode.SHIFT_NOT_OPEN,
            `POS shift ${shiftId} does not belong to branch ${branchId}`,
            409,
          );
        }
        if (shiftRows[0].status !== 'OPEN') {
          throw new SalesDomainError(
            SalesDomainErrorCode.SHIFT_NOT_OPEN,
            `POS shift ${shiftId} is ${shiftRows[0].status} and cannot accept sales`,
            409,
          );
        }
      }
    });
  }

  private normalizeTenderInputs(
    dto: PosCheckoutDto,
    grandTotalVnd: number,
  ): TenderInputLine[] {
    if (dto.tenders && dto.tenders.length > 0) {
      return dto.tenders.map((t) => {
        const isConfirmedElectronic =
          t.method !== 'CASH' &&
          t.method !== 'COD' &&
          (t.verified === true || t.status === 'CONFIRMED');
        return {
          method: t.method,
          amount: t.amount,
          tenderedCash: t.tenderedCash,
          verified: isConfirmedElectronic ? true : Boolean(t.verified),
          externalRef:
            t.externalRef ??
            (isConfirmedElectronic ? `POS-${t.method}` : undefined),
        };
      });
    }

    const rawMethod = (dto.paymentMethod ?? 'CASH').trim().toUpperCase();
    const method: Exclude<TenderMethod, 'COMBINED'> = (
      ['CASH', 'BANK_TRANSFER', 'CARD', 'E_WALLET', 'COD'].includes(rawMethod)
        ? rawMethod
        : 'CASH'
    ) as Exclude<TenderMethod, 'COMBINED'>;

    return [
      {
        method,
        amount: grandTotalVnd,
        tenderedCash:
          dto.tenderedCash !== undefined ? dto.tenderedCash : grandTotalVnd,
        verified: method !== 'COD',
        externalRef: method !== 'CASH' ? `POS-${method}` : undefined,
      },
    ];
  }

  private resolvePrimaryPaymentMethod(
    summary: ValidatedTenderSummary,
    fallback?: string,
  ): string {
    if (summary.tenders.length > 1) {
      return 'COMBINED';
    }
    return summary.tenders[0]?.method ?? fallback ?? 'CASH';
  }

  private assertWorkflowInScope(
    wf: CheckoutWorkflowEntity,
    scope: BranchScope,
  ): void {
    if (!branchAllowed(scope, wf.branchId)) {
      throw new SalesDomainError(
        SalesDomainErrorCode.ORDER_NOT_FOUND,
        `Checkout workflow ${wf.id} not found`,
        404,
      );
    }
  }

  private async findWorkflowByKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<CheckoutWorkflowEntity | null> {
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return em.getRepository(CheckoutWorkflowEntity).findOne({
        where: { tenantId, idempotencyKey },
      });
    });
  }

  private async findWorkflowById(
    tenantId: string,
    checkoutId: string,
  ): Promise<CheckoutWorkflowEntity | null> {
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return em.getRepository(CheckoutWorkflowEntity).findOne({
        where: { tenantId, id: checkoutId },
      });
    });
  }

  private async updateWorkflowState(
    tenantId: string,
    checkoutId: string,
    patch: Partial<CheckoutWorkflowEntity>,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const currentRows: CheckoutWorkflowEntity[] = await em
        .getRepository(CheckoutWorkflowEntity)
        .find({
          where: { id: checkoutId, tenantId },
          lock: { mode: 'pessimistic_write' },
        });
      const current = currentRows[0];
      if (!current) {
        return;
      }
      if (
        current.state === 'CONFIRMED' ||
        current.state === 'COMPLETED' ||
        current.state === 'CANCELLED' ||
        current.state === 'REJECTED'
      ) {
        return;
      }
      await em.getRepository(CheckoutWorkflowEntity).update(
        { id: checkoutId, tenantId },
        {
          ...patch,
          updatedAt: new Date(),
        },
      );
    });
  }

  private async buildCheckoutResultFromWorkflow(
    tenantId: string,
    wf: CheckoutWorkflowEntity,
    replayed: boolean,
  ): Promise<PosCheckoutResult> {
    let orderCode: string | undefined;
    let paymentStatus = 'PAID';
    let fulfillmentStatus =
      wf.state === 'CONFIRMED' || wf.state === 'COMPLETED'
        ? 'FULFILLED'
        : wf.reservationId
          ? 'RESERVED'
          : 'UNFULFILLED';

    if (wf.orderId) {
      const order = await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        return em.getRepository(OrderEntity).findOne({
          where: { id: wf.orderId!, tenantId },
        });
      });
      if (order) {
        orderCode = order.code;
        paymentStatus = order.paymentStatus ?? 'PAID';
        fulfillmentStatus = order.fulfillmentStatus ?? 'FULFILLED';
      }
    } else if (wf.tendersJson) {
      paymentStatus = (wf.tendersJson as ValidatedTenderSummary).paymentStatus;
    }

    return {
      checkoutId: wf.id,
      tenantId: wf.tenantId,
      branchId: wf.branchId,
      warehouseId: wf.warehouseId,
      shiftId: wf.shiftId ?? null,
      state: wf.state,
      reservationIdempotencyKey: wf.reservationIdempotencyKey,
      reservationId: wf.reservationId,
      orderId: wf.orderId,
      orderCode,
      paymentStatus,
      fulfillmentStatus,
      quote: (wf.quoteJson ?? {}) as CalculatedOrderQuote & {
        couponCode: string | null;
      },
      tenders: (wf.tendersJson ?? {}) as ValidatedTenderSummary,
      replayed,
    };
  }
}
