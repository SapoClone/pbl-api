import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { EventEnvelope } from '@pbl/common';
import { subscribersOf } from '@pbl/contracts';
import { QueueProvisioner } from '../sqs-queues';
import { EventPublisher } from './event-publisher';

/**
 * Local transport: no SNS, so the publisher itself fans out, sending the event
 * straight to the queue of each subscriber named in the topology.
 */
export class SqsDirectPublisher implements EventPublisher {
  constructor(
    private readonly sqs: SQSClient,
    private readonly queues: QueueProvisioner,
    /** Which services' queues get an event type; the topology unless a test says otherwise */
    private readonly subscribers: (type: string) => string[] = subscribersOf,
  ) {}

  async publish(envelope: EventEnvelope): Promise<void> {
    for (const service of this.subscribers(envelope.type)) {
      const queueUrl = await this.queues.ensureQueue(service);
      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(envelope),
          MessageAttributes: {
            type: { DataType: 'String', StringValue: envelope.type },
          },
        }),
      );
    }
  }
}
