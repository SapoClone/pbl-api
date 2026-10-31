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
  INVENTORY_STOCK_CHANGED,
  INVENTORY_STOCK_ISSUED,
  INVENTORY_STOCK_RECEIVED,
  INVENTORY_TRANSFER_DISPATCHED,
  INVENTORY_TRANSFER_RECEIVED,
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
  StockChangedPayload,
} from '@pbl/contracts';
import { OnEvent } from '@pbl/events';
import { EntityManager } from 'typeorm';
import {
  NormalizedOrderEventInput,
  NormalizedReturnEventInput,
  ProjectionsService,
} from '../modules/projections/projections.service';

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

  @OnEvent(CUSTOMER_GROUP_CHANGED.type)
  async onCustomerGroupChanged(
    event: EventEnvelope<CustomerGroupChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const c = event.payload;
    await this.projections.upsertDimensionCache(manager, {
      tenantId: event.tenantId,
      dimensionType: 'CUSTOMER',
      entityId: c.customerId,
      code: c.customerId,
      name: c.customerId,
      customerGroupId: c.newGroupId ?? 'WALK_IN',
      aggregateVersion: 999,
    });
  }

  // ---- Sales Order & Return Events ----

  @OnEvent(SALES_ORDER_CREATED.type)
  async onSalesOrderCreated(
    event: EventEnvelope<NormalizedOrderEventInput>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processSalesOrderEvent(event, manager, 'CREATED');
  }

  @OnEvent(SALES_ORDER_CONFIRMED.type)
  async onSalesOrderConfirmed(
    event: EventEnvelope<NormalizedOrderEventInput>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processSalesOrderEvent(event, manager, 'CONFIRMED');
  }

  @OnEvent(SALES_ORDER_COMPLETED.type)
  async onSalesOrderCompleted(
    event: EventEnvelope<NormalizedOrderEventInput>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processSalesOrderEvent(event, manager, 'COMPLETED');
  }

  @OnEvent(SALES_CHECKOUT_COMPLETED.type)
  async onSalesCheckoutCompleted(
    event: EventEnvelope<NormalizedOrderEventInput>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processSalesOrderEvent(event, manager, 'COMPLETED');
  }

  @OnEvent(SALES_ORDER_CANCELLED.type)
  async onSalesOrderCancelled(
    event: EventEnvelope<NormalizedOrderEventInput>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processSalesOrderEvent(event, manager, 'CANCELLED');
  }

  @OnEvent(SALES_RETURN_COMPLETED.type)
  async onSalesReturnCompleted(
    event: EventEnvelope<NormalizedReturnEventInput>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processSalesReturnCompleted(event, manager);
  }

  // ---- Inventory Stock, Cost & Transfer Events ----

  @OnEvent(INVENTORY_STOCK_CHANGED.type)
  async onInventoryStockChanged(
    event: EventEnvelope<StockChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processInventoryStockEvent(event, manager);
  }

  @OnEvent(INVENTORY_STOCK_RECEIVED.type)
  async onInventoryStockReceived(
    event: EventEnvelope<StockChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processInventoryStockEvent(
      {
        ...event,
        payload: {
          ...event.payload,
          movementType: event.payload.movementType ?? 'PURCHASE_RECEIPT',
        },
      },
      manager,
    );
  }

  @OnEvent(INVENTORY_STOCK_ISSUED.type)
  async onInventoryStockIssued(
    event: EventEnvelope<StockChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processInventoryStockEvent(
      {
        ...event,
        payload: {
          ...event.payload,
          movementType: event.payload.movementType ?? 'SALE_ISSUE',
        },
      },
      manager,
    );
  }

  @OnEvent(INVENTORY_TRANSFER_DISPATCHED.type)
  async onInventoryTransferDispatched(
    event: EventEnvelope<
      StockChangedPayload & { destinationWarehouseId?: string }
    >,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processInventoryStockEvent(
      {
        ...event,
        payload: {
          ...event.payload,
          movementType: 'TRANSFER_DISPATCH',
        },
      },
      manager,
    );
  }

  @OnEvent(INVENTORY_TRANSFER_RECEIVED.type)
  async onInventoryTransferReceived(
    event: EventEnvelope<StockChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processInventoryStockEvent(
      {
        ...event,
        payload: {
          ...event.payload,
          movementType: 'TRANSFER_RECEIPT',
        },
      },
      manager,
    );
  }

  @OnEvent(INVENTORY_STOCKTAKE_ADJUSTED.type)
  async onInventoryStocktakeAdjusted(
    event: EventEnvelope<StockChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processInventoryStockEvent(
      {
        ...event,
        payload: {
          ...event.payload,
          movementType: 'STOCKTAKE_ADJUSTMENT',
        },
      },
      manager,
    );
  }

  @OnEvent(INVENTORY_RESERVATION_CONFIRMED.type)
  async onReservationConfirmed(
    event: EventEnvelope<ReservationConfirmedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    for (const line of event.payload.lines ?? []) {
      await this.projections.processInventoryStockEvent(
        {
          ...event,
          payload: {
            warehouseId: line.warehouseId,
            skuId: line.skuId,
            movementType: 'RESERVATION_HELD',
            qtyDelta: '0',
            referenceType: event.payload.sourceRefType,
            referenceId: event.payload.sourceRefId,
            occurredAt: event.occurredAt,
          },
        },
        manager,
      );
    }
  }

  @OnEvent(INVENTORY_RESERVATION_COMMITTED.type)
  async onReservationCommitted(
    event: EventEnvelope<ReservationLifecycleEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    for (const line of event.payload.lines ?? []) {
      await this.projections.processInventoryStockEvent(
        {
          ...event,
          payload: {
            warehouseId: line.warehouseId,
            skuId: line.skuId,
            movementType: 'SALE_COMMIT',
            qtyDelta: `-${line.qty}`,
            referenceType: event.payload.sourceRefType,
            referenceId: event.payload.sourceRefId,
            occurredAt: event.payload.occurredAt ?? event.occurredAt,
          },
        },
        manager,
      );
    }
  }

  @OnEvent(INVENTORY_RESERVATION_RELEASED.type)
  async onReservationReleased(
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

  @OnEvent(INVENTORY_RESERVATION_EXPIRED.type)
  async onReservationExpired(
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

  // ---- Finance Cashbook & Debt Collection Events (Revenue-Safe) ----

  @OnEvent(FINANCE_RECEIVABLE_PAYMENT_APPLIED.type)
  async onReceivablePaymentApplied(
    event: EventEnvelope<FinanceReceivableEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.projections.processFinanceCashOrReceivableEvent(
      event,
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
