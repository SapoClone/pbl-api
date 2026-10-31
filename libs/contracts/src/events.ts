/**
 * Event contracts shared by producers and consumers (ADR-0007). Types only:
 * no logic. Fields are only ever added within a version; a breaking change
 * is a new version of the event.
 */

export interface EventDefinition {
  readonly type: string;
  readonly version: number;
}

/** Store roles carried in the access token (`roles`) and in `account_tenant.role`. */
export const ROLES = {
  OWNER: 'owner',
  /** @deprecated use ROLE_CODES.BRANCH_MANAGER (`branch_manager`) */
  MANAGER: 'manager',
  /** @deprecated use ROLE_CODES.SALES_STAFF (`sales_staff`) */
  CASHIER: 'cashier',
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

// ---- platform

export const PLATFORM_BRANCH_CREATED = {
  type: 'platform.branch.created',
  version: 1,
} as const satisfies EventDefinition;
export const PLATFORM_BRANCH_UPDATED = {
  type: 'platform.branch.updated',
  version: 1,
} as const satisfies EventDefinition;

export interface BranchEventPayload {
  id: string;
  code: string;
  name: string;
  isWarehouse: boolean;
  status: string;
  /** ISO 8601; consumers ignore an event older than the row they hold */
  updatedAt: string;
}

export const PLATFORM_ACCOUNT_LOGGED_IN = {
  type: 'platform.account.logged_in',
  version: 1,
} as const satisfies EventDefinition;

export interface AccountLoggedInPayload {
  accountId: string;
  sessionId: string;
  /** Role in the selected store */
  role: string;
  method: 'password' | 'switch_tenant';
}

export const PLATFORM_MEMBERSHIP_GRANTED = {
  type: 'platform.membership.granted',
  version: 1,
} as const satisfies EventDefinition;
export const PLATFORM_MEMBERSHIP_ROLE_CHANGED = {
  type: 'platform.membership.role_changed',
  version: 1,
} as const satisfies EventDefinition;

export interface MembershipEventPayload {
  accountId: string;
  email: string;
  role: string;
  /** Set on `role_changed` */
  previousRole?: string;
  changedBy: string;
}

// ---- sales (M0 & M3 Sales & POS Core — ADR-0015)

export const SALES_ORDER_CREATED = {
  type: 'sales.order.created',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_ORDER_CONFIRMED = {
  type: 'sales.order.confirmed',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_ORDER_CANCELLED = {
  type: 'sales.order.cancelled',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_ORDER_COMPLETED = {
  type: 'sales.order.completed',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_ORDER_PACKING = {
  type: 'sales.order.packing',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_ORDER_SHIPPED = {
  type: 'sales.order.shipped',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_CHECKOUT_COMPLETED = {
  type: 'sales.checkout.completed',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_CHECKOUT_RECONCILIATION_REQUIRED = {
  type: 'sales.checkout.reconciliation_required',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_TENDER_RECORDED = {
  type: 'sales.tender.recorded',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_PAYMENT_CONFIRMED = {
  type: 'sales.payment.confirmed',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_RETURN_CREATED = {
  type: 'sales.return.created',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_RETURN_APPROVED = {
  type: 'sales.return.approved',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_RETURN_COMPLETED = {
  type: 'sales.return.completed',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_REFUND_REQUESTED = {
  type: 'sales.refund.requested',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_SHIFT_OPENED = {
  type: 'sales.shift.opened',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_SHIFT_CLOSED = {
  type: 'sales.shift.closed',
  version: 1,
} as const satisfies EventDefinition;

export const SALES_FULFILLMENT_COMPLETED = {
  type: 'sales.fulfillment.completed',
  version: 1,
} as const satisfies EventDefinition;

export interface OrderCompletedPayload {
  orderId: string;
  code: string;
  branchId: string;
  customerId?: string | null;
  /** Integer VND */
  subtotal?: number;
  /** Integer VND */
  discountTotal?: number;
  /** Integer VND */
  taxTotal?: number;
  /** Integer VND */
  grandTotal?: number;
  /** Integer VND */
  totalAmount: number;
  itemCount: number;
  paymentMethod: string;
  createdBy: string;
  completedAt: string;
  items: {
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    /** Catalog variant of the line, when the order was built from variants */
    variantId?: string;
  }[];
  /** Where the order was sold (`pos`, `manual`, `website`, `shopee`, ...); absent on older events */
  channel?: string;
  /** The sales channel row of the order, when it has one */
  channelId?: string | null;
  /** Integer VND, what the goods cost; absent until costs are tracked */
  costAmount?: number | null;
}

export interface SalesOrderLifecycleEventPayload {
  orderId: string;
  code: string;
  branchId: string;
  customerId?: string | null;
  channelType: string;
  orderStatus: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  /** Integer VND */
  subtotal: number;
  /** Integer VND */
  discountTotal: number;
  /** Integer VND */
  taxTotal: number;
  /** Integer VND */
  grandTotal: number;
  actorId: string;
  occurredAt: string;
}

/** `sales.order.shipped` (a lifecycle payload plus how the parcel travels) */
export interface SalesOrderShippedPayload
  extends SalesOrderLifecycleEventPayload {
  shippingProviderId?: string | null;
  trackingCode?: string | null;
}

export interface SalesShiftEventPayload {
  shiftId: string;
  code: string;
  branchId: string;
  staffId: string;
  status: 'OPEN' | 'CLOSED';
  /** Integer VND */
  openingCash: number;
  /** Integer VND */
  expectedCash?: number;
  /** Integer VND */
  actualCash?: number;
  /** Integer VND, negative when the drawer is short */
  variance?: number;
  occurredAt: string;
}

export interface SalesReturnEventPayload {
  returnId: string;
  code: string;
  orderId: string;
  branchId: string;
  customerId?: string | null;
  status: string;
  /** Integer VND */
  totalRefundAmount: number;
  occurredAt: string;
}

export interface SalesRefundRequestedPayload {
  refundRequestId: string;
  returnId: string;
  orderId: string;
  branchId: string;
  /** Integer VND */
  amount: number;
  method: string;
  status: string;
  occurredAt: string;
}

// ---- inventory (internal command, not an event: sales holds stock before it sells)

export interface StockLine {
  sku: string;
  quantity: number;
}

/** `POST /internal/reservations` of inventory; `orderId` is the idempotency key */
export interface ReserveStockRequest {
  orderId: string;
  branchId: string;
  lines: StockLine[];
}

export interface StockShortage {
  sku: string;
  requested: number;
  /** on hand minus what other holds keep */
  available: number;
}

export interface StockReservation {
  orderId: string;
  branchId: string;
  status: 'held' | 'committed' | 'released' | 'expired';
  expiresAt: string;
  lines: StockLine[];
}

// ---- inventory events & warehouse reservation contract (ADR-0012)

export const INVENTORY_RESERVATION_CONFIRMED = {
  type: 'inventory.reservation.confirmed',
  version: 1,
} as const satisfies EventDefinition;

export interface ReservationConfirmedPayload {
  reservationId: string;
  sourceRefType: 'ORDER' | 'TRANSFER' | 'RETURN';
  sourceRefId: string;
  state: 'HELD';
  expiresAt: string;
  lines: {
    warehouseId: string;
    skuId: string;
    qty: string;
  }[];
}

export const INVENTORY_STOCK_CHANGED = {
  type: 'inventory.stock.changed',
  version: 1,
} as const satisfies EventDefinition;

export const INVENTORY_STOCK_RECEIVED = {
  type: 'inventory.stock.received',
  version: 1,
} as const satisfies EventDefinition;

export const INVENTORY_STOCK_ISSUED = {
  type: 'inventory.stock.issued',
  version: 1,
} as const satisfies EventDefinition;

export const INVENTORY_RESERVATION_COMMITTED = {
  type: 'inventory.reservation.committed',
  version: 1,
} as const satisfies EventDefinition;

export const INVENTORY_RESERVATION_RELEASED = {
  type: 'inventory.reservation.released',
  version: 1,
} as const satisfies EventDefinition;

export const INVENTORY_RESERVATION_EXPIRED = {
  type: 'inventory.reservation.expired',
  version: 1,
} as const satisfies EventDefinition;

export const INVENTORY_TRANSFER_DISPATCHED = {
  type: 'inventory.transfer.dispatched',
  version: 1,
} as const satisfies EventDefinition;

export const INVENTORY_TRANSFER_RECEIVED = {
  type: 'inventory.transfer.received',
  version: 1,
} as const satisfies EventDefinition;

export const INVENTORY_STOCKTAKE_ADJUSTED = {
  type: 'inventory.stocktake.adjusted',
  version: 1,
} as const satisfies EventDefinition;

export const INVENTORY_PURCHASE_ORDER_APPROVED = {
  type: 'inventory.purchase_order.approved',
  version: 1,
} as const satisfies EventDefinition;

export type InventoryMovementType =
  | 'SALE_COMMIT'
  | 'SALE_ISSUE'
  | 'RECEIPT'
  | 'PURCHASE_RECEIPT'
  | 'MANUAL_RECEIPT'
  | 'MANUAL_ISSUE'
  | 'TRANSFER_DISPATCH'
  | 'TRANSFER_RECEIPT'
  | 'STOCKTAKE_ADJUSTMENT'
  | 'RETURN_IN'
  | 'RETURN_RECEIPT'
  | 'ADJUSTMENT'
  | 'REVERSAL';

export interface StockChangedPayload {
  warehouseId: string;
  skuId: string;
  movementType: InventoryMovementType;
  qtyDelta: string;
  onHandAfter: string;
  reservedAfter: string;
  unitCost?: number;
  avgCostAfter?: number;
  referenceType: string;
  referenceId: string;
  occurredAt: string;
}

/** A stock threshold change put available stock of a branch SKU below its minimum */
export const INVENTORY_STOCK_BELOW_MIN = {
  type: 'inventory.stock.below_min',
  version: 1,
} as const satisfies EventDefinition;

export interface StockBelowMinPayload {
  branchId: string | null;
  warehouseId: string;
  /** the catalog variant id (inventory calls it `skuId`) */
  variantId: string;
  sku: string | null;
  name: string | null;
  available: number;
  minQuantity: number;
  occurredAt: string;
}

export interface ReservationLifecycleEventPayload {
  reservationId: string;
  sourceRefType: 'ORDER' | 'TRANSFER' | 'RETURN';
  sourceRefId: string;
  state: 'COMMITTED' | 'RELEASED' | 'EXPIRED';
  reason?: string;
  occurredAt: string;
  lines: {
    warehouseId: string;
    skuId: string;
    qty: string;
  }[];
}

export interface PurchaseOrderApprovedPayload {
  purchaseOrderId: string;
  code: string;
  supplierId: string;
  warehouseId: string;
  totalAmount: number;
  approvedAt: string;
}

export type WarehouseReservationState =
  | 'HELD'
  | 'COMMITTED'
  | 'RELEASED'
  | 'EXPIRED';

export interface WarehouseReservationLineInput {
  warehouseId: string;
  skuId: string;
  qty: string;
}

export interface CreateWarehouseReservationRequest {
  callerService: 'sales' | 'inventory' | 'integration';
  sourceRefType: 'ORDER' | 'TRANSFER' | 'RETURN';
  sourceRefId: string;
  ttlSeconds?: number;
  lines: WarehouseReservationLineInput[];
}

export interface WarehouseReservationLineResult {
  lineNo: number;
  warehouseId: string;
  skuId: string;
  qty: string;
  onHandAfter: string;
  reservedAfter: string;
  availableAfter: string;
}

export interface WarehouseReservationResponse {
  reservationId: string;
  tenantId: string;
  callerService: string;
  sourceRefType: 'ORDER' | 'TRANSFER' | 'RETURN';
  sourceRefId: string;
  state: WarehouseReservationState;
  expiresAt: string;
  createdAt: string;
  lines: WarehouseReservationLineResult[];
}

export interface WarehouseStockShortage {
  warehouseId: string;
  skuId: string;
  requestedQty: string;
  availableQty: string;
}

// ---- catalog (M1 Catalog Core — ADR-0013)

export const CATALOG_PRODUCT_CREATED = {
  type: 'catalog.product.created',
  version: 1,
} as const satisfies EventDefinition;

export const CATALOG_PRODUCT_UPDATED = {
  type: 'catalog.product.updated',
  version: 1,
} as const satisfies EventDefinition;

export const CATALOG_PRODUCT_DEACTIVATED = {
  type: 'catalog.product.deactivated',
  version: 1,
} as const satisfies EventDefinition;

export const CATALOG_VARIANT_CREATED = {
  type: 'catalog.variant.created',
  version: 1,
} as const satisfies EventDefinition;

export const CATALOG_VARIANT_UPDATED = {
  type: 'catalog.variant.updated',
  version: 1,
} as const satisfies EventDefinition;

export const CATALOG_VARIANT_DEACTIVATED = {
  type: 'catalog.variant.deactivated',
  version: 1,
} as const satisfies EventDefinition;

export const CATALOG_PRICE_CHANGED = {
  type: 'catalog.price.changed',
  version: 1,
} as const satisfies EventDefinition;

export interface CatalogProductEventPayload {
  productId: string;
  name: string;
  baseUnit: string;
  categoryId: string | null;
  brandId: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  aggregateVersion: number;
  updatedAt: string;
}

export interface CatalogVariantEventPayload {
  variantId: string;
  productId: string;
  skuCode: string;
  previousSkuCode?: string;
  barcode: string | null;
  name: string;
  basePrice: number;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  isDefault: boolean;
  aggregateVersion: number;
  updatedAt: string;
}

export interface CatalogPriceChangedPayload {
  priceListId: string;
  priceListName: string;
  isDefault: boolean;
  currency: string;
  variantId: string;
  skuCode: string;
  price: number;
  previousPrice?: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  aggregateVersion: number;
  updatedAt: string;
}

// ---- customer & loyalty (M4 Customer & Loyalty Core — ADR-0016)

export const CUSTOMER_CREATED = {
  type: 'customer.created',
  version: 1,
} as const satisfies EventDefinition;

export const CUSTOMER_UPDATED = {
  type: 'customer.updated',
  version: 1,
} as const satisfies EventDefinition;

export const CUSTOMER_DEACTIVATED = {
  type: 'customer.deactivated',
  version: 1,
} as const satisfies EventDefinition;

export const CUSTOMER_GROUP_CHANGED = {
  type: 'customer.group.changed',
  version: 1,
} as const satisfies EventDefinition;

export const CUSTOMER_MEMBERSHIP_CHANGED = {
  type: 'customer.membership.changed',
  version: 1,
} as const satisfies EventDefinition;

export const CUSTOMER_LOYALTY_POINTS_EARNED = {
  type: 'customer.loyalty.points_earned',
  version: 1,
} as const satisfies EventDefinition;

export const CUSTOMER_LOYALTY_POINTS_REDEEMED = {
  type: 'customer.loyalty.points_redeemed',
  version: 1,
} as const satisfies EventDefinition;

export const CUSTOMER_LOYALTY_POINTS_REVERSED = {
  type: 'customer.loyalty.points_reversed',
  version: 1,
} as const satisfies EventDefinition;

export const CUSTOMER_LOYALTY_HOLD_CREATED = {
  type: 'customer.loyalty.hold_created',
  version: 1,
} as const satisfies EventDefinition;

export const CUSTOMER_LOYALTY_HOLD_COMMITTED = {
  type: 'customer.loyalty.hold_committed',
  version: 1,
} as const satisfies EventDefinition;

export const CUSTOMER_LOYALTY_HOLD_RELEASED = {
  type: 'customer.loyalty.hold_released',
  version: 1,
} as const satisfies EventDefinition;

export const CUSTOMER_LOYALTY_HOLD_EXPIRED = {
  type: 'customer.loyalty.hold_expired',
  version: 1,
} as const satisfies EventDefinition;

export interface CustomerLifecycleEventPayload {
  customerId: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ANONYMIZED';
  customerGroupId: string | null;
  membershipTierId: string | null;
  version: number;
  occurredAt: string;
}

export interface CustomerGroupChangedPayload {
  customerId: string;
  previousGroupId: string | null;
  newGroupId: string | null;
  actorId: string | null;
  occurredAt: string;
}

export interface CustomerMembershipChangedPayload {
  customerId: string;
  previousTierId: string | null;
  newTierId: string | null;
  qualifyingPoints: number;
  occurredAt: string;
}

export interface LoyaltyPointsEventPayload {
  transactionId: string;
  customerId: string;
  loyaltyAccountId: string;
  transactionType:
    | 'EARN'
    | 'REDEEM'
    | 'EARN_REVERSAL'
    | 'REDEMPTION_REVERSAL'
    | 'MANUAL_ADJUSTMENT'
    | 'EXPIRE'
    | 'MERGE_IN'
    | 'MERGE_OUT';
  pointsDelta: number;
  postedBalanceAfter: number;
  orderId?: string | null;
  returnId?: string | null;
  holdId?: string | null;
  occurredAt: string;
}

export interface LoyaltyHoldEventPayload {
  holdId: string;
  customerId: string;
  loyaltyAccountId: string;
  points: number;
  state: 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
  sourceRefType: string;
  sourceRefId: string;
  expiresAt: string;
  occurredAt: string;
}

// ---- finance & accounting (M5 Finance Core — ADR-0017)

export const FINANCE_CASHBOOK_ENTRY_POSTED = {
  type: 'finance.cashbook.entry_posted',
  version: 1,
} as const satisfies EventDefinition;

export const FINANCE_RECEIVABLE_CREATED = {
  type: 'finance.receivable.created',
  version: 1,
} as const satisfies EventDefinition;

export const FINANCE_RECEIVABLE_PAYMENT_APPLIED = {
  type: 'finance.receivable.payment_applied',
  version: 1,
} as const satisfies EventDefinition;

export const FINANCE_PAYABLE_CREATED = {
  type: 'finance.payable.created',
  version: 1,
} as const satisfies EventDefinition;

export const FINANCE_PAYABLE_PAYMENT_APPLIED = {
  type: 'finance.payable.payment_applied',
  version: 1,
} as const satisfies EventDefinition;

export const FINANCE_CREDIT_AUTHORIZED = {
  type: 'finance.credit.authorized',
  version: 1,
} as const satisfies EventDefinition;

export const FINANCE_CREDIT_COMMITTED = {
  type: 'finance.credit.committed',
  version: 1,
} as const satisfies EventDefinition;

export const FINANCE_CREDIT_RELEASED = {
  type: 'finance.credit.released',
  version: 1,
} as const satisfies EventDefinition;

export const FINANCE_PAYMENT_SETTLEMENT_CONFIRMED = {
  type: 'finance.payment.settlement_confirmed',
  version: 1,
} as const satisfies EventDefinition;

export const FINANCE_REFUND_COMPLETED = {
  type: 'finance.refund.completed',
  version: 1,
} as const satisfies EventDefinition;

export const FINANCE_REFUND_RECONCILIATION_REQUIRED = {
  type: 'finance.refund.reconciliation_required',
  version: 1,
} as const satisfies EventDefinition;

export const FINANCE_COD_SETTLEMENT_RECONCILED = {
  type: 'finance.cod.settlement_reconciled',
  version: 1,
} as const satisfies EventDefinition;

export const FINANCE_COD_DISCREPANCY_DETECTED = {
  type: 'finance.cod.discrepancy_detected',
  version: 1,
} as const satisfies EventDefinition;

export interface FinanceCashbookEntryPostedPayload {
  entryId: string;
  code: string;
  branchId: string | null;
  cashAccountId: string;
  categoryId: string;
  direction: 'RECEIPT' | 'EXPENSE';
  voucherType: string;
  amount: number;
  currency: string;
  journalId: string;
  sourceType: string | null;
  sourceId: string | null;
  postedBy: string;
  occurredAt: string;
}

export interface FinanceReceivableEventPayload {
  receivableId: string;
  code: string;
  customerId: string;
  orderId: string | null;
  branchId: string | null;
  originalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  customerTotalDebtAfter: number;
  status: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'WRITTEN_OFF' | 'REVERSED';
  journalId: string;
  occurredAt: string;
}

export interface FinancePayableEventPayload {
  payableId: string;
  code: string;
  supplierId: string;
  purchaseOrderId: string | null;
  receiptId: string | null;
  warehouseId: string | null;
  originalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  supplierTotalDebtAfter: number;
  status: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'ADJUSTED' | 'REVERSED';
  journalId: string;
  occurredAt: string;
}

export interface FinanceCreditAuthorizationEventPayload {
  authorizationId: string;
  code: string;
  customerId: string;
  orderId: string | null;
  authorizedAmount: number;
  state: 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
  postedDebtAfter: number;
  heldCreditAfter: number;
  availableCreditAfter: number;
  receivableId?: string | null;
  occurredAt: string;
}

export interface FinancePaymentSettlementConfirmedPayload {
  settlementId: string;
  code: string;
  orderId: string;
  checkoutId: string | null;
  paymentMethod: string;
  provider: string;
  externalTxId: string | null;
  confirmedAmount: number;
  settlementStatus: string;
  journalId: string | null;
  occurredAt: string;
}

export interface FinanceRefundEventPayload {
  refundId: string;
  code: string;
  salesRefundRequestId: string | null;
  returnId: string | null;
  orderId: string;
  amount: number;
  method: string;
  status: string;
  journalId: string | null;
  reason?: string | null;
  occurredAt: string;
}

export interface FinanceCodSettlementEventPayload {
  batchId: string;
  code: string;
  carrierCode: string;
  statementRef: string;
  totalExpectedCod: number;
  totalReportedCod: number;
  totalCarrierFee: number;
  totalNetPayout: number;
  totalDiscrepancy: number;
  status: string;
  journalId: string | null;
  occurredAt: string;
}

// ---- integration & omnichannel (M6 Integration Core — ADR-0018)

export const INTEGRATION_CONNECTION_CONNECTED = {
  type: 'integration.connection.connected',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_CONNECTION_DISCONNECTED = {
  type: 'integration.connection.disconnected',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_CONNECTION_REAUTH_REQUIRED = {
  type: 'integration.connection.reauth_required',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_SKU_MAPPING_CREATED = {
  type: 'integration.sku_mapping.created',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_SKU_MAPPING_UPDATED = {
  type: 'integration.sku_mapping.updated',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_EXTERNAL_ORDER_RECEIVED = {
  type: 'integration.external_order.received',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_EXTERNAL_ORDER_IMPORTED = {
  type: 'integration.external_order.imported',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_EXTERNAL_ORDER_MAPPING_REQUIRED = {
  type: 'integration.external_order.mapping_required',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_EXTERNAL_ORDER_SYNC_FAILED = {
  type: 'integration.external_order.sync_failed',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_INVENTORY_PUBLICATION_SUCCEEDED = {
  type: 'integration.inventory.publication_succeeded',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_INVENTORY_PUBLICATION_FAILED = {
  type: 'integration.inventory.publication_failed',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_SYNC_JOB_COMPLETED = {
  type: 'integration.sync_job.completed',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_SYNC_JOB_FAILED = {
  type: 'integration.sync_job.failed',
  version: 1,
} as const satisfies EventDefinition;

export const INTEGRATION_RECONCILIATION_DISCREPANCY_DETECTED = {
  type: 'integration.reconciliation.discrepancy_detected',
  version: 1,
} as const satisfies EventDefinition;

export interface IntegrationConnectionEventPayload {
  connectionId: string;
  provider: 'SHOPEE' | 'LAZADA';
  externalShopId: string;
  shopName: string;
  branchId: string;
  warehouseId: string | null;
  status: string;
  reason?: string | null;
  occurredAt: string;
}

export interface IntegrationSkuMappingEventPayload {
  mappingId: string;
  connectionId: string;
  provider: 'SHOPEE' | 'LAZADA';
  externalItemId: string;
  externalSkuId: string;
  externalSkuCode: string | null;
  internalVariantId: string;
  internalSkuCode: string;
  mappingVersion: number;
  status: string;
  occurredAt: string;
}

export interface IntegrationExternalOrderEventPayload {
  channelOrderRefId: string;
  connectionId: string;
  provider: 'SHOPEE' | 'LAZADA';
  externalShopId: string;
  externalOrderId: string;
  internalOrderId: string | null;
  syncStatus: string;
  externalStatus: string;
  normalizedStatus: string;
  reason?: string | null;
  occurredAt: string;
}

export interface IntegrationInventoryPublicationEventPayload {
  publicationId: string;
  connectionId: string;
  provider: 'SHOPEE' | 'LAZADA';
  mappingId: string;
  internalVariantId: string;
  externalItemId: string;
  externalSkuId: string;
  publishedQuantity: number;
  stockVersion: number;
  status: 'SUCCEEDED' | 'FAILED';
  reason?: string | null;
  occurredAt: string;
}

export interface IntegrationSyncJobEventPayload {
  jobId: string;
  connectionId: string | null;
  provider: string | null;
  jobType: string;
  status: 'COMPLETED' | 'FAILED_PERMANENT' | 'DEAD_LETTERED';
  attemptCount: number;
  errorCategory?: string | null;
  errorMessage?: string | null;
  occurredAt: string;
}

export interface IntegrationReconciliationDiscrepancyPayload {
  runId: string;
  issueId: string;
  connectionId: string | null;
  provider: string | null;
  issueType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  externalRef: string | null;
  internalRef: string | null;
  occurredAt: string;
}

// ---- insight & analytics (M7 Insight Core — ADR-0021)

export const INSIGHT_PROJECTION_REBUILT = {
  type: 'insight.projection.rebuilt',
  version: 1,
} as const satisfies EventDefinition;

export const INSIGHT_PROJECTION_STALE_DETECTED = {
  type: 'insight.projection.stale_detected',
  version: 1,
} as const satisfies EventDefinition;

export const INSIGHT_RECONCILIATION_DISCREPANCY_DETECTED = {
  type: 'insight.reconciliation.discrepancy_detected',
  version: 1,
} as const satisfies EventDefinition;

export const INSIGHT_EXPORT_COMPLETED = {
  type: 'insight.export.completed',
  version: 1,
} as const satisfies EventDefinition;

export const INSIGHT_EXPORT_FAILED = {
  type: 'insight.export.failed',
  version: 1,
} as const satisfies EventDefinition;

export interface InsightProjectionRebuiltPayload {
  rebuildId: string;
  projectionName: string;
  previousGenerationId: string;
  newGenerationId: string;
  fromDate: string | null;
  toDate: string | null;
  ordersProcessed: number;
  returnsProcessed: number;
  durationMs: number;
  triggeredBy: string;
  occurredAt: string;
}

export interface InsightProjectionStaleDetectedPayload {
  projectionName: string;
  lastProcessedAt: string | null;
  lagSeconds: number;
  thresholdSeconds: number;
  detectedAt: string;
}

export interface InsightReconciliationDiscrepancyPayload {
  runId: string;
  issueId: string;
  scope: string;
  metricName: string;
  dimensionKey: string;
  expectedValue: string;
  actualValue: string;
  deltaValue: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  occurredAt: string;
}

export interface InsightExportJobEventPayload {
  jobId: string;
  reportType: string;
  format: 'CSV' | 'XLSX' | 'PDF';
  status: 'COMPLETED' | 'FAILED';
  rowCount: number;
  byteSize: number;
  requestedBy: string;
  errorMessage?: string | null;
  occurredAt: string;
}
