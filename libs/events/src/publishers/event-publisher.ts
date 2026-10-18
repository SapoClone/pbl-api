import { EventEnvelope } from '@pbl/common';

export const EVENT_PUBLISHER = Symbol('PBL_EVENT_PUBLISHER');

/**
 * Sends one event to the bus. It resolves only when the bus accepted the event
 * for every subscriber it knows of; a rejection makes the relay retry later.
 * Delivery is at least once, so consumers dedupe through their inbox.
 */
export interface EventPublisher {
  publish(envelope: EventEnvelope): Promise<void>;
}
