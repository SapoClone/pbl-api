import validateConfig from '@/utils/validate-config';
import { registerAs } from '@nestjs/config';
import { IsNotEmpty, IsString, IsUrl } from 'class-validator';
import { QueueConfig } from './queue-config.type';

class EnvironmentVariablesValidator {
  @IsString()
  @IsNotEmpty()
  QSTASH_TOKEN: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  MAIL_SERVICE_URL: string;
}

export default registerAs<QueueConfig>('queue', () => {
  console.info(`Register QueueConfig from environment variables`);
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    qstashToken: process.env.QSTASH_TOKEN,
    mailServiceUrl: process.env.MAIL_SERVICE_URL,
  };
});
