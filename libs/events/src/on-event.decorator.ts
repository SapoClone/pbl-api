import { SetMetadata } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import { EntityManager } from 'typeorm';

export const ON_EVENT_METADATA = 'pbl:on-event';

/**
 * A handler runs inside the transaction that records the event in the inbox, in
 * the request context restored from the envelope (tenant, trace id). Use the
 * given `manager` for every write, so the handler's effects and the inbox row
 * commit together. Throwing rolls everything back and the message is retried.
 */
export type EventHandler<P = any> = (
  event: EventEnvelope<P>,
  manager: EntityManager,
) => Promise<void>;

/** Marks a provider method as the handler of an event type */
export const OnEvent = (type: string): MethodDecorator =>
  SetMetadata(ON_EVENT_METADATA, type);
