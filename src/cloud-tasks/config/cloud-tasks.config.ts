import validateConfig from '@/utils/validate-config';
import { registerAs } from '@nestjs/config';
import { IsNotEmpty, IsString, IsUrl } from 'class-validator';
import { CloudTasksConfig } from './cloud-tasks-config.type';

class EnvironmentVariablesValidator {
  @IsString()
  @IsNotEmpty()
  GCP_PROJECT_ID: string;

  @IsString()
  @IsNotEmpty()
  CLOUD_TASKS_LOCATION: string;

  @IsString()
  @IsNotEmpty()
  CLOUD_TASKS_QUEUE_NAME: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  CLOUD_TASKS_MAIL_SERVICE_URL: string;

  @IsString()
  @IsNotEmpty()
  CLOUD_TASKS_INVOKER_SA_EMAIL: string;
}

export default registerAs<CloudTasksConfig>('cloudTasks', () => {
  console.info(`Register CloudTasksConfig from environment variables`);
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    projectId: process.env.GCP_PROJECT_ID,
    location: process.env.CLOUD_TASKS_LOCATION,
    queueName: process.env.CLOUD_TASKS_QUEUE_NAME,
    mailServiceUrl: process.env.CLOUD_TASKS_MAIL_SERVICE_URL,
    invokerServiceAccountEmail: process.env.CLOUD_TASKS_INVOKER_SA_EMAIL,
  };
});
