import { Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { PblHealthModule, PblLoggingModule, TenancyModule } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PblDatabaseModule,
  PblEventsModule,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
} from '@pbl/events';
import { BranchProjectionHandler } from './branches/branch-projection.handler';
import { CATALOG_ENTITIES } from './infrastructure/persistence/catalog.entities';
import { CreateCatalogTables1791900000200 } from './migrations/1791900000200-create-catalog-tables';
import { CreateTenantPlanQuota1792800000000 } from './migrations/1792800000000-create-tenant-plan-quota';
import { AllowUploadCleanupSelect1793300000000 } from './migrations/1793300000000-allow-upload-cleanup-select';
import { CreateProductAttributes1793400000000 } from './migrations/1793400000000-create-product-attributes';
import { CreatePriceListBranches1793500000000 } from './migrations/1793500000000-create-price-list-branches';
import { AttributesController } from './modules/attributes/attributes.controller';
import { AttributesService } from './modules/attributes/attributes.service';
import { BrandsController } from './modules/brands/brands.controller';
import { BrandsService } from './modules/brands/brands.service';
import { CategoriesController } from './modules/categories/categories.controller';
import { CategoriesService } from './modules/categories/categories.service';
import { ImportsController } from './modules/imports/imports.controller';
import { ImportsService } from './modules/imports/imports.service';
import { PricingController } from './modules/pricing/pricing.controller';
import { PricingService } from './modules/pricing/pricing.service';
import { ProductAttributesService } from './modules/products/product-attributes';
import { ProductAttributesController } from './modules/products/product-attributes.controller';
import { ProductsController } from './modules/products/products.controller';
import { ProductsService } from './modules/products/products.service';
import {
  createFileStorage,
  FILE_STORAGE,
} from './modules/uploads/file-storage';
import { UploadsCleanupJob } from './modules/uploads/uploads-cleanup.job';
import { UploadsController } from './modules/uploads/uploads.controller';
import { UploadsService } from './modules/uploads/uploads.service';
import { PlanQuotaHandler } from './quota/plan-quota.handler';
import { PlanQuotaService } from './quota/plan-quota.service';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [
    PblLoggingModule.forRoot('catalog'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({
      service: 'catalog',
      redisFromEnv: true,
      database: true,
    }),
    PblDatabaseModule.forRoot({
      entities: [
        ...CATALOG_ENTITIES,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateCatalogTables1791900000200,
        CreateTenantPlanQuota1792800000000,
        AllowUploadCleanupSelect1793300000000,
        CreateProductAttributes1793400000000,
        CreatePriceListBranches1793500000000,
      ],
    }),
    PblEventsModule.forRoot({ service: 'catalog' }),
    TenancyModule.forFeature(CATALOG_ENTITIES),
  ],
  controllers: [
    CategoriesController,
    BrandsController,
    AttributesController,
    ProductsController,
    ProductAttributesController,
    PricingController,
    UploadsController,
    ImportsController,
  ],
  providers: [
    CategoriesService,
    BrandsService,
    AttributesService,
    ProductsService,
    ProductAttributesService,
    PricingService,
    UploadsService,
    UploadsCleanupJob,
    ImportsService,
    PlanQuotaHandler,
    BranchProjectionHandler,
    PlanQuotaService,
    { provide: FILE_STORAGE, useFactory: createFileStorage },
  ],
})
export class AppModule {}
