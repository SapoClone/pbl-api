export type EventsTransport = 'sqs-direct' | 'sns';

export interface EventsConfig {
  /**
   * `sns`: production, publish to the producer's topic and SNS fans out to the
   * queues. `sqs-direct`: local, send straight to each subscriber's queue.
   */
  transport: EventsTransport;
  /** ARN of the producer's topic; required for `sns` */
  topicArn?: string;
  relayIntervalMs: number;
  relayBatch: number;
  /** After this many failed publishes an outbox row is flagged, never dropped */
  maxAttempts: number;
  /** SQS receives before a message moves to the DLQ */
  maxReceiveCount: number;
  visibilityTimeoutSeconds: number;
  pollWaitSeconds: number;
  /** Published outbox rows older than this are deleted */
  outboxRetentionDays: number;
}

const int = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : fallback;
};

export function readEventsConfig(
  env: Record<string, string | undefined> = process.env,
): EventsConfig {
  const transport = env.EVENTS_TRANSPORT ?? 'sqs-direct';
  if (transport !== 'sqs-direct' && transport !== 'sns') {
    throw new Error(
      `EVENTS_TRANSPORT must be "sqs-direct" or "sns", got "${transport}"`,
    );
  }
  if (transport === 'sns' && !env.EVENTS_TOPIC_ARN) {
    throw new Error('EVENTS_TRANSPORT=sns needs EVENTS_TOPIC_ARN');
  }
  return {
    transport,
    topicArn: env.EVENTS_TOPIC_ARN || undefined,
    relayIntervalMs: int(env.EVENTS_RELAY_INTERVAL_MS, 500),
    relayBatch: int(env.EVENTS_RELAY_BATCH, 50),
    maxAttempts: int(env.EVENTS_MAX_ATTEMPTS, 10),
    maxReceiveCount: int(env.EVENTS_MAX_RECEIVE_COUNT, 3),
    visibilityTimeoutSeconds: int(env.EVENTS_VISIBILITY_TIMEOUT, 30),
    pollWaitSeconds: int(env.EVENTS_POLL_WAIT_SECONDS, 5),
    outboxRetentionDays: int(env.EVENTS_OUTBOX_RETENTION_DAYS, 7),
  };
}
