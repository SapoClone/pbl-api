import { AllConfigType } from '@/config/config.type';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@upstash/qstash';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly client: Client;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    this.client = new Client({
      token: this.configService.getOrThrow('queue.qstashToken', {
        infer: true,
      }),
    });
  }

  async enqueueEmailVerification(email: string, token: string): Promise<void> {
    const mailServiceUrl = this.configService.getOrThrow(
      'queue.mailServiceUrl',
      { infer: true },
    );

    this.logger.debug(`Publishing email-verification message for ${email}`);

    await this.client.publishJSON({
      url: `${mailServiceUrl}/tasks/email-verification`,
      body: { email, token },
    });
  }
}
