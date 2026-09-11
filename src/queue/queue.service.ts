import { AllConfigType } from '@/config/config.type';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly client: SQSClient;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    this.client = new SQSClient({
      region: this.configService.getOrThrow('queue.region', { infer: true }),
    });
  }

  async enqueueEmailVerification(email: string, token: string): Promise<void> {
    const queueUrl = this.configService.getOrThrow('queue.queueUrl', {
      infer: true,
    });

    this.logger.debug(`Enqueueing email-verification message for ${email}`);

    await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ email, token }),
      }),
    );
  }
}
