export const EVENTS_CONFIG = Symbol('PBL_EVENTS_CONFIG');
export const EVENTS_OPTIONS = Symbol('PBL_EVENTS_OPTIONS');
export const SQS_CLIENT = Symbol('PBL_SQS_CLIENT');

export interface PblEventsOptions {
  /** The service name: its queue is `<service>-events` and its entry in the topology */
  service: string;
  /** Whether the service produces events (derived from the topology) */
  produces: boolean;
}
