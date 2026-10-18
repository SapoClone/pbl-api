import { InboxEventEntity } from './inbox-event.entity';
import { OutboxEventEntity } from './outbox-event.entity';

export * from './inbox-event.entity';
export * from './outbox-event.entity';

/** Add to the `entities` of a service that produces events */
export const PRODUCER_ENTITIES = [OutboxEventEntity];
/** Add to the `entities` of a service that consumes events */
export const CONSUMER_ENTITIES = [InboxEventEntity];
