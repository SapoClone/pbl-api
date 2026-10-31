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
  /** Where the order was sold (`pos`, `manual`, `website`, `shopee`, ...); absent on older events */
  channel?: string;
  /** Buyer, when the order has one */
  customerId?: string | null;
  /** Integer VND, what the goods cost; absent until costs are tracked */
  costAmount?: number | null;
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
