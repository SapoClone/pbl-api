import validateConfig from '@/utils/validate-config';
import { registerAs } from '@nestjs/config';
import { IsNotEmpty, IsString, IsUrl } from 'class-validator';
import { QueueConfig } from './queue-config.type';

class EnvironmentVariablesValidator {
  @IsUrl({ require_tld: false, require_protocol: true })
  SQS_QUEUE_URL: string;

  @IsString()
  @IsNotEmpty()
  AWS_REGION: string;
}

export default registerAs<QueueConfig>('queue', () => {
  console.info(`Register QueueConfig from environment variables`);
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    queueUrl: process.env.SQS_QUEUE_URL,
    region: process.env.AWS_REGION,
  };
});
