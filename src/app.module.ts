import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import generateModulesSet from './utils/modules-set';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ...generateModulesSet(),
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY,
      appSecret: process.env.OBSERVE_APP_SECRET,
      serviceId: 'pbl-api',
    }),
  ],
})
export class AppModule {}
