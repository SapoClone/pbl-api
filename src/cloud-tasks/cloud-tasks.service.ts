import { AllConfigType } from '@/config/config.type';
import { CloudTasksClient } from '@google-cloud/tasks';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CloudTasksService {
  private readonly logger = new Logger(CloudTasksService.name);
  private readonly client = new CloudTasksClient();

  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  async enqueueEmailVerification(email: string, token: string): Promise<void> {
    const projectId = this.configService.getOrThrow('cloudTasks.projectId', {
      infer: true,
    });
    const location = this.configService.getOrThrow('cloudTasks.location', {
      infer: true,
    });
    const queueName = this.configService.getOrThrow('cloudTasks.queueName', {
      infer: true,
    });
    const mailServiceUrl = this.configService.getOrThrow(
      'cloudTasks.mailServiceUrl',
      { infer: true },
    );
    const invokerServiceAccountEmail = this.configService.getOrThrow(
      'cloudTasks.invokerServiceAccountEmail',
      { infer: true },
    );

    const parent = this.client.queuePath(projectId, location, queueName);

    this.logger.debug(`Enqueueing email-verification task for ${email}`);

    await this.client.createTask({
      parent,
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url: `${mailServiceUrl}/tasks/email-verification`,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(JSON.stringify({ email, token })).toString(
            'base64',
          ),
          oidcToken: {
            serviceAccountEmail: invokerServiceAccountEmail,
          },
        },
      },
    });
  }
}
