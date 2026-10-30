import {
  CATALOG_PRICE_CHANGED,
  CATALOG_PRODUCT_CREATED,
  CATALOG_PRODUCT_DEACTIVATED,
  CATALOG_PRODUCT_UPDATED,
  CATALOG_VARIANT_CREATED,
  CATALOG_VARIANT_DEACTIVATED,
  CATALOG_VARIANT_UPDATED,
  INVENTORY_PURCHASE_ORDER_APPROVED,
  INVENTORY_RESERVATION_COMMITTED,
  INVENTORY_RESERVATION_CONFIRMED,
  INVENTORY_RESERVATION_EXPIRED,
  INVENTORY_RESERVATION_RELEASED,
  INVENTORY_STOCK_CHANGED,
  INVENTORY_STOCK_ISSUED,
  INVENTORY_STOCK_RECEIVED,
  INVENTORY_STOCKTAKE_ADJUSTED,
  INVENTORY_TRANSFER_DISPATCHED,
  INVENTORY_TRANSFER_RECEIVED,
  PLATFORM_ACCOUNT_LOGGED_IN,
  PLATFORM_BRANCH_CREATED,
  PLATFORM_BRANCH_UPDATED,
  PLATFORM_MEMBERSHIP_GRANTED,
  PLATFORM_MEMBERSHIP_ROLE_CHANGED,
  SALES_ORDER_COMPLETED,
} from './events';

/**
 * Who produces which events and who consumes them: the one source for the local
 * queue set-up today, and for Terraform (topics, queues, subscriptions) when the
 * system is deployed.
 */
export const TOPOLOGY = {
  producers: {
    platform: [
      PLATFORM_BRANCH_CREATED.type,
      PLATFORM_BRANCH_UPDATED.type,
      PLATFORM_ACCOUNT_LOGGED_IN.type,
      PLATFORM_MEMBERSHIP_GRANTED.type,
      PLATFORM_MEMBERSHIP_ROLE_CHANGED.type,
    ],
    catalog: [
      CATALOG_PRODUCT_CREATED.type,
      CATALOG_PRODUCT_UPDATED.type,
      CATALOG_PRODUCT_DEACTIVATED.type,
      CATALOG_VARIANT_CREATED.type,
      CATALOG_VARIANT_UPDATED.type,
      CATALOG_VARIANT_DEACTIVATED.type,
      CATALOG_PRICE_CHANGED.type,
    ],
    inventory: [
      INVENTORY_RESERVATION_CONFIRMED.type,
      INVENTORY_RESERVATION_COMMITTED.type,
      INVENTORY_RESERVATION_RELEASED.type,
      INVENTORY_RESERVATION_EXPIRED.type,
      INVENTORY_STOCK_CHANGED.type,
      INVENTORY_STOCK_RECEIVED.type,
      INVENTORY_STOCK_ISSUED.type,
      INVENTORY_TRANSFER_DISPATCHED.type,
      INVENTORY_TRANSFER_RECEIVED.type,
      INVENTORY_STOCKTAKE_ADJUSTED.type,
      INVENTORY_PURCHASE_ORDER_APPROVED.type,
    ],
    sales: [SALES_ORDER_COMPLETED.type],
  },
  subscriptions: {
    sales: [
      PLATFORM_BRANCH_CREATED.type,
      PLATFORM_BRANCH_UPDATED.type,
      INVENTORY_RESERVATION_CONFIRMED.type,
      INVENTORY_RESERVATION_COMMITTED.type,
      INVENTORY_RESERVATION_RELEASED.type,
      INVENTORY_RESERVATION_EXPIRED.type,
    ],
    inventory: [
      PLATFORM_BRANCH_CREATED.type,
      PLATFORM_BRANCH_UPDATED.type,
      CATALOG_PRODUCT_CREATED.type,
      CATALOG_PRODUCT_UPDATED.type,
      CATALOG_PRODUCT_DEACTIVATED.type,
      CATALOG_VARIANT_CREATED.type,
      CATALOG_VARIANT_UPDATED.type,
      CATALOG_VARIANT_DEACTIVATED.type,
      SALES_ORDER_COMPLETED.type,
    ],
    insight: [
      PLATFORM_ACCOUNT_LOGGED_IN.type,
      PLATFORM_MEMBERSHIP_GRANTED.type,
      PLATFORM_MEMBERSHIP_ROLE_CHANGED.type,
      CATALOG_PRODUCT_CREATED.type,
      CATALOG_PRODUCT_UPDATED.type,
      CATALOG_PRODUCT_DEACTIVATED.type,
      CATALOG_VARIANT_CREATED.type,
      CATALOG_VARIANT_UPDATED.type,
      CATALOG_VARIANT_DEACTIVATED.type,
      CATALOG_PRICE_CHANGED.type,
      INVENTORY_RESERVATION_CONFIRMED.type,
      INVENTORY_RESERVATION_COMMITTED.type,
      INVENTORY_RESERVATION_RELEASED.type,
      INVENTORY_RESERVATION_EXPIRED.type,
      INVENTORY_STOCK_CHANGED.type,
      INVENTORY_STOCK_RECEIVED.type,
      INVENTORY_STOCK_ISSUED.type,
      INVENTORY_TRANSFER_DISPATCHED.type,
      INVENTORY_TRANSFER_RECEIVED.type,
      INVENTORY_STOCKTAKE_ADJUSTED.type,
      INVENTORY_PURCHASE_ORDER_APPROVED.type,
      SALES_ORDER_COMPLETED.type,
    ],
  },
} as const satisfies {
  producers: Record<string, readonly string[]>;
  subscriptions: Record<string, readonly string[]>;
};

/** Services whose queue must receive an event of this type */
export function subscribersOf(type: string): string[] {
  return Object.entries(TOPOLOGY.subscriptions)
    .filter(([, types]) => (types as readonly string[]).includes(type))
    .map(([service]) => service);
}

/** The service that produces an event type, if any */
export function producerOf(type: string): string | undefined {
  return Object.entries(TOPOLOGY.producers).find(([, types]) =>
    (types as readonly string[]).includes(type),
  )?.[0];
}
