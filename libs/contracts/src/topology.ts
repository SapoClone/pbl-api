import {
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
    sales: [SALES_ORDER_COMPLETED.type],
  },
  subscriptions: {
    sales: [PLATFORM_BRANCH_CREATED.type, PLATFORM_BRANCH_UPDATED.type],
    insight: [
      PLATFORM_ACCOUNT_LOGGED_IN.type,
      PLATFORM_MEMBERSHIP_GRANTED.type,
      PLATFORM_MEMBERSHIP_ROLE_CHANGED.type,
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
