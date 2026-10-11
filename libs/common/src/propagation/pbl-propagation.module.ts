import { HttpModule } from '@nestjs/axios';
import { DynamicModule, Module } from '@nestjs/common';
import { InternalHttpClient } from './internal-http.client';
import {
  PBL_PROPAGATION_OPTIONS,
  PblPropagationOptions,
} from './propagation-options';

/**
 * `PblPropagationModule.forRoot(options)` provides and exports
 * InternalHttpClient. Without `baseURL` / `allowedHosts` the client refuses
 * to forward the user's Authorization anywhere.
 */
@Module({})
export class PblPropagationModule {
  static forRoot(options: PblPropagationOptions = {}): DynamicModule {
    return {
      module: PblPropagationModule,
      imports: [HttpModule],
      providers: [
        { provide: PBL_PROPAGATION_OPTIONS, useValue: options },
        InternalHttpClient,
      ],
      exports: [InternalHttpClient],
    };
  }
}
