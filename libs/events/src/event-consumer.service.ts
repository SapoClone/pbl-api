import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  EventEnvelope,
  consumeEvent,
  runInTenantTransaction,
} from '@pbl/common';
import { DataSource } from 'typeorm';
import { EventHandlerRegistry } from './event-handler.registry';
import { EventsConfig } from './events-config';
import { qualifiedTable } from './migrations';
import { QueueProvisioner } from './sqs-queues';
import {
  EVENTS_CONFIG,
  EVENTS_OPTIONS,
  PblEventsOptions,
  SQS_CLIENT,
} from './tokens';

export type ConsumeResult = 'processed' | 'duplicate';

/**
 * Reads the service's queue and runs its `@OnEvent` handlers. For each message,
 * the inbox insert and the handlers share one transaction: a duplicate delivery
 * is recognised and skipped, and a failing handler rolls everything back. A
 * message is deleted only after that transaction committed, so a failure leaves
 * it for redelivery, and after the queue's `maxReceiveCount` it moves to the DLQ.
 */
@Injectable()
export class EventConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(EventConsumer.name);
  private stopped = false;
  private loop?: Promise<void>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: EventHandlerRegistry,
    private readonly queues: QueueProvisioner,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(EVENTS_CONFIG) private readonly config: EventsConfig,
    @Inject(EVENTS_OPTIONS) private readonly options: PblEventsOptions,
  ) {}

  onApplicationBootstrap(): void {
    if (this.registry.size === 0) return;
    this.loop = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    // the long poll ends by itself within pollWaitSeconds
    await Promise.race([
      this.loop,
      new Promise((resolve) => setTimeout(resolve, 2000).unref?.()),
    ]);
  }

  /**
   * Processes one message body: validates the envelope, records it in the inbox
   * and runs the handlers in one transaction. Throws when the message must be
   * retried. Public so tests and tools can drive the consumer.
   */
  async handleBody(body: string): Promise<ConsumeResult> {
    const envelope = JSON.parse(body) as EventEnvelope;
    // consumeEvent validates the envelope and restores tenant, trace and actor
    return consumeEvent(envelope, async (event): Promise<ConsumeResult> => {
      const handlers = this.registry.handlersFor(event.type);
      if (handlers.length === 0) {
        this.logger.warn(`No handler for ${event.type}; message dropped`);
        return 'processed';
      }
      // the event's tenant is bound to the transaction (`app.tenant_id`): the row-level security policies of the
      // tables a handler writes evaluate against it, and a role that is not a superuser is subject to them
      return runInTenantTransaction(this.dataSource, async (manager) => {
        const inserted = await manager.query(
          `INSERT INTO ${qualifiedTable(this.dataSource, 'inbox_event')} ("event_id", "type")
           VALUES ($1, $2) ON CONFLICT ("event_id") DO NOTHING RETURNING "event_id"`,
          [event.id, event.type],
        );
        if (inserted.length === 0) return 'duplicate';
        for (const handler of handlers) await handler(event, manager);
        return 'processed';
      });
    });
  }

  /**
   * One receive and its processing. Returns the number of messages received.
   * Public so tests and tools can drive the consumer without the loop.
   */
  async pollOnce(waitSeconds = this.config.pollWaitSeconds): Promise<number> {
    const queueUrl = await this.queues.resolveQueueUrl(this.options.service);
    const { Messages = [] } = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: waitSeconds,
      }),
    );
    for (const message of Messages) {
      if (this.stopped) break;
      await this.process(queueUrl, message);
    }
    return Messages.length;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.pollOnce();
      } catch (error) {
        this.logger.error(
          `Event consumer error: ${error instanceof Error ? error.message : error}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  private async process(queueUrl: string, message: Message): Promise<void> {
    try {
      const result = await this.handleBody(message.Body ?? '');
      if (result === 'duplicate') {
        this.logger.debug(`Duplicate event ignored (${message.MessageId})`);
      }
    } catch (error) {
      // not deleted: SQS redelivers it, then moves it to the DLQ
      this.logger.warn(
        `Event handling failed, will be retried: ${error instanceof Error ? error.message : error}`,
      );
      return;
    }
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }
}
