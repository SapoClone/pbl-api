import { Injectable } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import {
  BranchEventPayload,
  CATALOG_PRODUCT_CREATED,
  CATALOG_PRODUCT_DEACTIVATED,
  CATALOG_PRODUCT_UPDATED,
  CATALOG_VARIANT_CREATED,
  CATALOG_VARIANT_DEACTIVATED,
  CATALOG_VARIANT_UPDATED,
  CUSTOMER_CREATED,
  CUSTOMER_DEACTIVATED,
  CUSTOMER_GROUP_CHANGED,
  CUSTOMER_UPDATED,
  CatalogProductEventPayload,
  CatalogVariantEventPayload,
  CustomerGroupChangedPayload,
  CustomerLifecycleEventPayload,
  FINANCE_CASHBOOK_ENTRY_POSTED,
  FINANCE_RECEIVABLE_PAYMENT_APPLIED,
  FinanceCashbookEntryPostedPayload,
  FinanceReceivableEventPayload,
  INVENTORY_RESERVATION_COMMITTED,
  INVENTORY_RESERVATION_CONFIRMED,
  INVENTORY_RESERVATION_EXPIRED,
  INVENTORY_RESERVATION_RELEASED,
  INVENTORY_STOCKTAKE_ADJUSTED,
  INVENTORY_STOCK_BELOW_MIN,
  INVENTORY_STOCK_CHANGED,
  INVENTORY_STOCK_ISSUED,
  INVENTORY_STOCK_RECEIVED,
  INVENTORY_TRANSFER_DISPATCHED,
  INVENTORY_TRANSFER_RECEIVED,
  OrderCompletedPayload,
  PLATFORM_BRANCH_CREATED,
  PLATFORM_BRANCH_UPDATED,
  ReservationConfirmedPayload,
  ReservationLifecycleEventPayload,
  SALES_CHECKOUT_COMPLETED,
  SALES_ORDER_CANCELLED,
  SALES_ORDER_COMPLETED,
  SALES_ORDER_CONFIRMED,
  SALES_ORDER_CREATED,
  SALES_RETURN_COMPLETED,
  StockBelowMinPayload,
  StockChangedPayload,
} from '@pbl/contracts';
import { OnEvent } from '@pbl/events';
import { EntityManager } from 'typeorm';
import {
  NormalizedOrderEventInput,
  NormalizedReturnEventInput,
  ProjectionsService,
} from '../modules/projections/projections.service';

/**
 * What the sales events really carry (libs/contracts `OrderCompletedPayload` and
 * `SalesOrderLifecycleEventPayload`) in the shape the projection reads: the channel arrives as
 * `channel` (lower case) on `sales.order.completed` and as `channelType` on the lifecycle events,
 * and the cost of goods arrives as one `costAmount` for the whole order, which is spread over the
 * lines by their share of the subtotal (the last line takes the remainder).
 */
const normalized = (
  event: EventEnvelope<NormalizedOrderEventInput>,
): EventEnvelope<NormalizedOrderEventInput> => ({
  ...event,
  payload: normalizeOrderEvent(event.payload),
});

export function normalizeOrderEvent(
  payload: NormalizedOrderEventInput &
    Partial<
      Pick<OrderCompletedPayload, 'channel' | 'costAmount' | 'channelId'>
    >,
): NormalizedOrderEventInput {
  const { channel, costAmount, channelId: _channelId, ...rest } = payload;
  void _channelId;
  const normalized: NormalizedOrderEventInput = {
    ...rest,
    channelType: (rest.channelType ?? channel)?.toUpperCase(),
  };
  const items = normalized.items ?? normalized.lines;
  if (
    typeof costAmount === 'number' &&
    Number.isInteger(costAmount) &&
    costAmount >= 0 &&
    items &&
    items.length > 0 &&
    items.every((i) => i.cogsAmount === undefined && i.unitCost === undefined)
  ) {
    const weights = items.map((i) =>
      Math.round(Number(i.quantity) * Number(i.unitPrice)),
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let remaining = costAmount;
    const withCost = items.map((item, idx) => {
      const share =
        idx === items.length - 1
          ? remaining
          : total > 0
            ? Math.round((costAmount * weights[idx]) / total)
            : 0;
      remaining -= share;
      return { ...item, cogsAmount: share };
    });
    if (normalized.items) normalized.items = withCost;
    else normalized.lines = withCost;
  }
  return normalized;
}

/** A stock payload that really describes a stock line (the document-level events do not) */
const hasStockLine = (p: Partial<StockChangedPayload>): boolean =>
  Boolean(p.warehouseId && (p.skuId || (p as { skuCode?: string }).skuCode)) &&
  p.qtyDelta !== undefined;

@Injectable()
export class InsightEventsConsumer {
  constructor(private readonly projections: ProjectionsService) {}

  // ---- Platform Branch Metadata Events ----

  @OnEvent(PLATFORM_BRANCH_CREATED.type)
  async onBranchCreated(
    event: EventEnvelope<BranchEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.upsertDimensionCache(manager, {
      tenantId: event.tenantId,
      dimensionType: 'BRANCH',
      entityId: event.payload.id,
      code: event.payload.code,
      name: event.payload.name,
      metadata: {
        isWarehouse: event.payload.isWarehouse,
        status: event.payload.status,
      },
    });
  }

  @OnEvent(PLATFORM_BRANCH_UPDATED.type)
  async onBranchUpdated(
    event: EventEnvelope<BranchEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.onBranchCreated(event, manager);
  }

  // ---- Catalog Product & Variant Metadata Events ----

  @OnEvent(CATALOG_PRODUCT_CREATED.type)
  async onProductCreated(
    event: EventEnvelope<CatalogProductEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    await this.projections.upsertDimensionCache(manager, {
      tenantId: event.tenantId,
      dimensionType: 'PRODUCT',
      entityId: p.productId,
      code: p.productId,
      name: p.name,
      categoryId: p.categoryId,
      brandId: p.brandId,
      aggregateVersion: p.aggregateVersion ?? 1,
      metadata: { baseUnit: p.baseUnit, status: p.status },
    });
  }

  @OnEvent(CATALOG_PRODUCT_UPDATED.type)
  async onProductUpdated(
    event: EventEnvelope<CatalogProductEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.onProductCreated(event, manager);
  }

  @OnEvent(CATALOG_PRODUCT_DEACTIVATED.type)
  async onProductDeactivated(
    event: EventEnvelope<CatalogProductEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.onProductCreated(event, manager);
  }

  @OnEvent(CATALOG_VARIANT_CREATED.type)
  async onVariantCreated(
    event: EventEnvelope<CatalogVariantEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const v = event.payload;
    await this.projections.upsertDimensionCache(manager, {
      tenantId: event.tenantId,
      dimensionType: 'VARIANT',
      entityId: v.skuCode,
      code: v.skuCode,
      name: v.name,
      parentId: v.productId,
      aggregateVersion: v.aggregateVersion ?? 1,
      metadata: {
        variantId: v.variantId,
        basePrice: v.basePrice,
        status: v.status,
      },
    });
  }

  @OnEvent(CATALOG_VARIANT_UPDATED.type)
  async onVariantUpdated(
    event: EventEnvelope<CatalogVariantEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.onVariantCreated(event, manager);
  }

  @OnEvent(CATALOG_VARIANT_DEACTIVATED.type)
  async onVariantDeactivated(
    event: EventEnvelope<CatalogVariantEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.onVariantCreated(event, manager);
  }

  // ---- Customer & Segment Events ----

  @OnEvent(CUSTOMER_CREATED.type)
  async onCustomerCreated(
    event: EventEnvelope<CustomerLifecycleEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const c = event.payload;
    await this.projections.upsertDimensionCache(manager, {
      tenantId: event.tenantId,
      dimensionType: 'CUSTOMER',
      entityId: c.customerId,
      code: c.code,
      name: c.code,
      customerGroupId: c.customerGroupId ?? 'WALK_IN',
      aggregateVersion: c.version ?? 1,
      metadata: { membershipTierId: c.membershipTierId, status: c.status },
    });
  }

  @OnEvent(CUSTOMER_UPDATED.type)
  async onCustomerUpdated(
    event: EventEnvelope<CustomerLifecycleEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.onCustomerCreated(event, manager);
  }

  @OnEvent(CUSTOMER_DEACTIVATED.type)
  async onCustomerDeactivated(
    event: EventEnvelope<CustomerLifecycleEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.onCustomerCreated(event, manager);
  }

  @OnEvent(CUSTOMER_GROUP_CHANGED.type)
  async onCustomerGroupChanged(
    event: EventEnvelope<CustomerGroupChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const c = event.payload;
    await this.projections.setCustomerGroup(
      manager,
      event.tenantId,
      c.customerId,
      c.newGroupId ?? 'WALK_IN',
    );
  }

  // ---- Sales Order & Return Events ----

  @OnEvent(SALES_ORDER_CREATED.type)
  async onSalesOrderCreated(
    event: EventEnvelope<NormalizedOrderEventInput>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processSalesOrderEvent(
      normalized(event),
      manager,
      'CREATED',
    );
  }

  @OnEvent(SALES_ORDER_CONFIRMED.type)
  async onSalesOrderConfirmed(
    event: EventEnvelope<NormalizedOrderEventInput>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processSalesOrderEvent(
      normalized(event),
      manager,
      'CONFIRMED',
    );
  }

  @OnEvent(SALES_ORDER_COMPLETED.type)
  async onSalesOrderCompleted(
    event: EventEnvelope<NormalizedOrderEventInput>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processSalesOrderEvent(
      normalized(event),
      manager,
      'COMPLETED',
    );
  }

  @OnEvent(SALES_CHECKOUT_COMPLETED.type)
  async onSalesCheckoutCompleted(
    event: EventEnvelope<NormalizedOrderEventInput>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processSalesOrderEvent(
      normalized(event),
      manager,
      'COMPLETED',
    );
  }

  @OnEvent(SALES_ORDER_CANCELLED.type)
  async onSalesOrderCancelled(
    event: EventEnvelope<NormalizedOrderEventInput>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processSalesOrderEvent(
      normalized(event),
      manager,
      'CANCELLED',
    );
  }

  @OnEvent(SALES_RETURN_COMPLETED.type)
  async onSalesReturnCompleted(
    event: EventEnvelope<NormalizedReturnEventInput>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processSalesReturnCompleted(event, manager);
  }

  // ---- Inventory Stock, Cost & Transfer Events ----
  //
  // `inventory.stock.changed` is the one event that carries a stock line (variant id as `skuId`,
  // the quantity moved, the balances after, the cost). The document-level events (`received`,
  // `issued`, `transfer.dispatched`, `transfer.received`, `stocktake.adjusted`) only name the
  // document: they never move stock here, they just mark the projection as fresh.

  @OnEvent(INVENTORY_STOCK_CHANGED.type)
  async onInventoryStockChanged(
    event: EventEnvelope<StockChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.applyStockLine(event, manager);
  }

  @OnEvent(INVENTORY_STOCK_RECEIVED.type)
  async onInventoryStockReceived(
    event: EventEnvelope<StockChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.applyStockLine(event, manager, 'PURCHASE_RECEIPT');
  }

  @OnEvent(INVENTORY_STOCK_ISSUED.type)
  async onInventoryStockIssued(
    event: EventEnvelope<StockChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.applyStockLine(event, manager, 'SALE_ISSUE');
  }

  @OnEvent(INVENTORY_TRANSFER_DISPATCHED.type)
  async onInventoryTransferDispatched(
    event: EventEnvelope<
      StockChangedPayload & { destinationWarehouseId?: string }
    >,
    manager: EntityManager,
  ): Promise<void> {
    await this.applyStockLine(event, manager, 'TRANSFER_DISPATCH');
  }

  @OnEvent(INVENTORY_TRANSFER_RECEIVED.type)
  async onInventoryTransferReceived(
    event: EventEnvelope<StockChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.applyStockLine(event, manager, 'TRANSFER_RECEIPT');
  }

  @OnEvent(INVENTORY_STOCKTAKE_ADJUSTED.type)
  async onInventoryStocktakeAdjusted(
    event: EventEnvelope<StockChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.applyStockLine(event, manager, 'STOCKTAKE_ADJUSTMENT');
  }

  /** Learns which branch a warehouse belongs to: stock.changed names a warehouse only */
  @OnEvent(INVENTORY_STOCK_BELOW_MIN.type)
  async onStockBelowMin(
    event: EventEnvelope<StockBelowMinPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    if (p.branchId) {
      await this.projections.upsertDimensionCache(manager, {
        tenantId: event.tenantId,
        dimensionType: 'WAREHOUSE',
        entityId: p.warehouseId,
        code: p.warehouseId,
        name: p.warehouseId,
        parentId: p.branchId,
      });
    }
    await this.projections.touchCheckpoint(
      manager,
      event.tenantId,
      'inventory_analytics',
      event,
    );
  }

  /** Stock held by an order: no stock.changed reports it, the reserved quantity grows here */
  @OnEvent(INVENTORY_RESERVATION_CONFIRMED.type)
  async onReservationConfirmed(
    event: EventEnvelope<ReservationConfirmedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.moveReserved(event, manager, event.payload.lines, 1);
  }

  /**
   * The commit already arrives as stock.changed (`SALE_COMMIT`, with the balances after): the
   * reservation event only marks the projection fresh, a second movement would count the sale twice.
   */
  @OnEvent(INVENTORY_RESERVATION_COMMITTED.type)
  async onReservationCommitted(
    event: EventEnvelope<ReservationLifecycleEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.touchCheckpoint(
      manager,
      event.tenantId,
      'inventory_analytics',
      event,
    );
  }

  @OnEvent(INVENTORY_RESERVATION_RELEASED.type)
  async onReservationReleased(
    event: EventEnvelope<ReservationLifecycleEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.moveReserved(event, manager, event.payload.lines, -1);
  }

  @OnEvent(INVENTORY_RESERVATION_EXPIRED.type)
  async onReservationExpired(
    event: EventEnvelope<ReservationLifecycleEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.moveReserved(event, manager, event.payload.lines, -1);
  }

  private async moveReserved(
    event: EventEnvelope,
    manager: EntityManager,
    lines: { warehouseId: string; skuId: string; qty: string }[] | undefined,
    sign: 1 | -1,
  ): Promise<void> {
    for (const line of lines ?? []) {
      await this.projections.adjustReserved(
        manager,
        event.tenantId,
        line.warehouseId,
        line.skuId,
        sign === 1 ? String(line.qty) : `-${line.qty}`,
      );
    }
    await this.projections.touchCheckpoint(
      manager,
      event.tenantId,
      'inventory_analytics',
      event,
    );
  }

  /**
   * Projects one stock line: the variant id becomes the SKU code the orders use, and the branch of
   * the warehouse is resolved from what was learnt about it (else the warehouse stands in).
   * A payload without a stock line only touches the checkpoint.
   */
  private async applyStockLine(
    event: EventEnvelope<StockChangedPayload>,
    manager: EntityManager,
    defaultMovement?: string,
  ): Promise<void> {
    const p = event.payload;
    if (!hasStockLine(p)) {
      await this.projections.touchCheckpoint(
        manager,
        event.tenantId,
        'inventory_analytics',
        event,
      );
      return;
    }
    const skuCode = await this.projections.resolveSkuCode(
      manager,
      event.tenantId,
      p.skuId,
    );
    const branchId = await this.projections.resolveWarehouseBranch(
      manager,
      event.tenantId,
      p.warehouseId,
    );
    await this.projections.processInventoryStockEvent(
      {
        ...event,
        payload: {
          ...p,
          skuCode,
          branchId,
          movementType: p.movementType ?? defaultMovement,
        },
      },
      manager,
    );
  }

  // ---- Finance Cashbook & Debt Collection Events (Revenue-Safe) ----

  @OnEvent(FINANCE_RECEIVABLE_PAYMENT_APPLIED.type)
  async onReceivablePaymentApplied(
    event: EventEnvelope<FinanceReceivableEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    // the event holds the cumulative paid amount: only the growth is this payment
    const collected = await this.projections.receivablePaidDelta(
      manager,
      event.tenantId,
      event.payload.receivableId,
      event.payload.paidAmount,
    );
    await this.projections.processFinanceCashOrReceivableEvent(
      { ...event, payload: { ...event.payload, paymentDelta: collected } },
      manager,
      'RECEIVABLE_PAYMENT',
    );
  }

  @OnEvent(FINANCE_CASHBOOK_ENTRY_POSTED.type)
  async onCashbookEntryPosted(
    event: EventEnvelope<FinanceCashbookEntryPostedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processFinanceCashOrReceivableEvent(
      event,
      manager,
      'CASHBOOK',
    );
  }
}
