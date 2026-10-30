import { Injectable } from '@nestjs/common';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
  MarketplaceProvider,
} from '../domain/integration-domain';
import type {
  MarketplaceProviderAdapter,
  ProviderCapabilityDeclaration,
} from './contracts/provider.contracts';
import { LazadaProviderAdapter } from './lazada/lazada.adapter';
import { ShopeeProviderAdapter } from './shopee/shopee.adapter';

@Injectable()
export class ProviderRegistryService {
  private readonly adapters: Map<
    MarketplaceProvider,
    MarketplaceProviderAdapter
  >;

  constructor(
    shopeeAdapter: ShopeeProviderAdapter,
    lazadaAdapter: LazadaProviderAdapter,
  ) {
    this.adapters = new Map<MarketplaceProvider, MarketplaceProviderAdapter>([
      ['SHOPEE', shopeeAdapter],
      ['LAZADA', lazadaAdapter],
    ]);
  }

  getAdapter(provider: MarketplaceProvider): MarketplaceProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.PROVIDER_CAPABILITY_UNSUPPORTED,
        `Unsupported marketplace provider "${provider}"`,
        400,
      );
    }
    return adapter;
  }

  listAllCapabilities(): ProviderCapabilityDeclaration[] {
    return Array.from(this.adapters.values()).map((a) => a.getCapabilities());
  }
}
