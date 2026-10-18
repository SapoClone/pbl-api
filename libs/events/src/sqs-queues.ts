import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Injectable } from '@nestjs/common';
import { EventsConfig } from './events-config';
import { dlqName, queueName } from './queue-names';

/** Fourteen days, the SQS maximum, so a dead letter outlives a long weekend */
const DLQ_RETENTION_SECONDS = 14 * 24 * 60 * 60;

/**
 * Finds or creates the queue of a service. Locally (`sqs-direct`) the queue and
 * its DLQ are created on demand with the redrive policy, so start order does not
 * matter; in production Terraform owns them and only the URL is looked up.
 */
@Injectable()
export class QueueProvisioner {
  private readonly urls = new Map<string, string>();

  constructor(
    private readonly sqs: SQSClient,
    private readonly config: EventsConfig,
  ) {}

  /** Creates the queue and its DLQ when missing (idempotent), returns the queue URL */
  async ensureQueue(service: string): Promise<string> {
    const cached = this.urls.get(service);
    if (cached) return cached;

    const dlq = await this.sqs.send(
      new CreateQueueCommand({
        QueueName: dlqName(service),
        Attributes: { MessageRetentionPeriod: String(DLQ_RETENTION_SECONDS) },
      }),
    );
    const attributes = await this.sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: dlq.QueueUrl,
        AttributeNames: ['QueueArn'],
      }),
    );
    const queue = await this.sqs.send(
      new CreateQueueCommand({
        QueueName: queueName(service),
        Attributes: {
          VisibilityTimeout: String(this.config.visibilityTimeoutSeconds),
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: attributes.Attributes?.QueueArn,
            maxReceiveCount: this.config.maxReceiveCount,
          }),
        },
      }),
    );
    this.urls.set(service, queue.QueueUrl!);
    return queue.QueueUrl!;
  }

  /** Looks up the URL of an existing queue (production) */
  async getQueueUrl(service: string): Promise<string> {
    const cached = this.urls.get(service);
    if (cached) return cached;
    const { QueueUrl } = await this.sqs.send(
      new GetQueueUrlCommand({ QueueName: queueName(service) }),
    );
    this.urls.set(service, QueueUrl!);
    return QueueUrl!;
  }

  /** The URL a consumer of `service` reads from, for the configured transport */
  resolveQueueUrl(service: string): Promise<string> {
    return this.config.transport === 'sqs-direct'
      ? this.ensureQueue(service)
      : this.getQueueUrl(service);
  }
}
