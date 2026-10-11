import { HttpModule } from '@nestjs/axios';
import { DynamicModule, Module } from '@nestjs/common';
import { InternalHttpClient } from './internal-http.client';

/** `PblPropagationModule.forRoot()` provides and exports InternalHttpClient */
@Module({})
export class PblPropagationModule {
  static forRoot(): DynamicModule {
    return {
      module: PblPropagationModule,
      imports: [HttpModule],
      providers: [InternalHttpClient],
      exports: [InternalHttpClient],
    };
  }
}
