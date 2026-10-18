import { bootstrapService } from '@pbl/common';
import { AppModule } from './app.module';

void bootstrapService(AppModule, { name: 'inventory' });
