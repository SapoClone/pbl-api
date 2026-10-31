import { bootstrapService } from '@pbl/common';
import { AppModule } from './app.module';
import { assertIntegrationConfig } from './config/integration.config';

// fail before listening when a required secret or URL is missing
assertIntegrationConfig();
void bootstrapService(AppModule, { name: 'integration' });
