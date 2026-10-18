import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { EventEnvelope } from '@pbl/common';
import { EventPublisher } from './event-publisher';

/**
 * Production transport: publish to the producer's SNS topic. The event type is a
 * message attribute so subscriptions can filter on it; the queues subscribe with
 * raw message delivery, so a consumer reads the same envelope as locally.
 */
export class SnsEventPublisher implements EventPublisher {
  constructor(
    private readonly sns: SNSClient,
    private readonly topicArn: string,
  ) {}

  async publish(envelope: EventEnvelope): Promise<void> {
    await this.sns.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Message: JSON.stringify(envelope),
        MessageAttributes: {
          type: { DataType: 'String', StringValue: envelope.type },
        },
      }),
    );
  }
}
