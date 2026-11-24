import validateConfig from '@/utils/validate-config';
import { registerAs } from '@nestjs/config';
import { IsOptional, IsUrl } from 'class-validator';
import { WebConfig } from './web-config.type';

class EnvironmentVariablesValidator {
  @IsUrl({ require_tld: false, require_protocol: true })
  @IsOptional()
  WEB_APP_URL: string;
}

export const DEFAULT_WEB_APP_URL = 'http://localhost:5173';

export default registerAs<WebConfig>('web', () => {
  console.info(`Register WebConfig from environment variables`);
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    appUrl: (process.env.WEB_APP_URL || DEFAULT_WEB_APP_URL).replace(
      /\/+$/,
      '',
    ),
  };
});
