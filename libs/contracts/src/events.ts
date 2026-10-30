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
  MANAGER: 'manager',
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

// ---- sales

export const SALES_ORDER_COMPLETED = {
  type: 'sales.order.completed',
  version: 1,
} as const satisfies EventDefinition;

export interface OrderCompletedPayload {
  orderId: string;
  code: string;
  branchId: string;
  /** Integer VND */
  totalAmount: number;
  itemCount: number;
  paymentMethod: string;
  createdBy: string;
  completedAt: string;
  items: { sku: string; name: string; quantity: number; unitPrice: number }[];
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

export interface StockChangedPayload {
  warehouseId: string;
  skuId: string;
  movementType: 'SALE_COMMIT' | 'RECEIPT' | 'ADJUSTMENT' | 'RETURN_IN';
  qtyDelta: string;
  onHandAfter: string;
  reservedAfter: string;
  referenceType: string;
  referenceId: string;
  occurredAt: string;
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
  basePrice: string;
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
  price: string;
  previousPrice?: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  aggregateVersion: number;
  updatedAt: string;
}
