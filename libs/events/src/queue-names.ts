/** Queue of a consuming service (one per service, fed by every producer it subscribes to) */
export const queueName = (service: string) => `${service}-events`;
/** Dead-letter queue of a service's queue */
export const dlqName = (service: string) => `${service}-events-dlq`;
/** SNS topic of a producing service (production only) */
export const topicName = (producer: string) => `pbl-${producer}-events`;
