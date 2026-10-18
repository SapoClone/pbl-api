import { CreateInboxEventTable1791700000001 } from './create-inbox-event-table';
import { CreateOutboxEventTable1791700000000 } from './create-outbox-event-table';

export * from './create-inbox-event-table';
export * from './create-outbox-event-table';
export * from './table-name';

/** Add to the `migrations` of a service that produces events */
export const PRODUCER_MIGRATIONS = [CreateOutboxEventTable1791700000000];
/** Add to the `migrations` of a service that consumes events */
export const CONSUMER_MIGRATIONS = [CreateInboxEventTable1791700000001];
