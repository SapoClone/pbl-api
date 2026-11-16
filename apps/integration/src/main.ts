import { bootstrapService } from '@pbl/common';
import { AppModule } from './app.module';
import {
  assertIntegrationConfig,
  loadIntegrationEnvFileIfPresent,
} from './config/integration.config';

// load local .env (if present) and fail before listening when a required secret or URL is missing
loadIntegrationEnvFileIfPresent();
assertIntegrationConfig();
void bootstrapService(AppModule, { name: 'integration' });
