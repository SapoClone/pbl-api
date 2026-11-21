import { Module } from '@nestjs/common';
import { PblPropagationModule } from '@pbl/common';
import { IntegrationEventsConsumer } from '../consumers/integration-events.consumer';
import { ProviderRateLimiterService } from '../infrastructure/rate-limiting/provider-rate-limiter.service';
import { SalesOrderClient } from '../infrastructure/sales-client/sales-order.client';
import { BranchBlockersController } from '../internal/branch-blockers.controller';
import { BranchBlockersService } from '../internal/branch-blockers.service';
import { NameProjectionHandler } from '../projections/name-projection.handler';
import { LazadaHttpClient } from '../providers/lazada/lazada-http.client';
import { LazadaProviderAdapter } from '../providers/lazada/lazada.adapter';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { ShopeeProviderAdapter } from '../providers/shopee/shopee.adapter';
import { TenantStatusHandler } from '../tenant-status/tenant-status.handler';
import { AdminIntegrationController } from './admin/admin-integration.controller';
import { AdminIntegrationService } from './admin/admin-integration.service';
import { BranchScopeService } from './branch-scope/branch-scope.service';
import { ConflictsController } from './conflicts/conflicts.controller';
import { ConflictsService } from './conflicts/conflicts.service';
import {
  ConnectionsController,
  LazadaOAuthCallbackController,
} from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';
import { InventorySyncService } from './inventory-sync/inventory-sync.service';
import { OrderSyncService } from './order-sync/order-sync.service';
import { ReconciliationController } from './reconciliation/reconciliation.controller';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import { SkuMappingController } from './sku-mapping/sku-mapping.controller';
import { SkuMappingService } from './sku-mapping/sku-mapping.service';
import { SyncJobsController } from './sync-jobs/sync-jobs.controller';
import { SyncJobsService } from './sync-jobs/sync-jobs.service';
import { WebhooksController } from './webhooks/webhooks.controller';
import { WebhooksService } from './webhooks/webhooks.service';

@Module({
  imports: [
    // sales gets no user token from background jobs; the call carries x-internal-token
    PblPropagationModule.forRoot({ baseURL: process.env.SALES_SERVICE_URL }),
  ],
  controllers: [
    ConnectionsController,
    LazadaOAuthCallbackController,
    SkuMappingController,
    SyncJobsController,
    ConflictsController,
    ReconciliationController,
    WebhooksController,
    BranchBlockersController,
    AdminIntegrationController,
  ],
  providers: [
    BranchBlockersService,
    ProviderRateLimiterService,
    LazadaHttpClient,
    ShopeeProviderAdapter,
    LazadaProviderAdapter,
    ProviderRegistryService,
    SalesOrderClient,
    BranchScopeService,
    ConnectionsService,
    SkuMappingService,
    OrderSyncService,
    InventorySyncService,
    SyncJobsService,
    WebhooksService,
    ConflictsService,
    ReconciliationService,
    IntegrationEventsConsumer,
    TenantStatusHandler,
    NameProjectionHandler,
    AdminIntegrationService,
  ],
  exports: [
    ProviderRateLimiterService,
    LazadaHttpClient,
    LazadaProviderAdapter,
    ProviderRegistryService,
    SalesOrderClient,
    ConnectionsService,
    SkuMappingService,
    OrderSyncService,
    InventorySyncService,
    SyncJobsService,
    WebhooksService,
    ConflictsService,
    ReconciliationService,
    IntegrationEventsConsumer,
  ],
})
export class IntegrationCoreModule {}
