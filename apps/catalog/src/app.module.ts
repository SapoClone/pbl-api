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
import { CATALOG_ENTITIES } from './infrastructure/persistence/catalog.entities';
import { CreateCatalogTables1791900000200 } from './migrations/1791900000200-create-catalog-tables';
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
import { ProductsController } from './modules/products/products.controller';
import { ProductsService } from './modules/products/products.service';
import {
  createFileStorage,
  FILE_STORAGE,
} from './modules/uploads/file-storage';
import { UploadsController } from './modules/uploads/uploads.controller';
import { UploadsService } from './modules/uploads/uploads.service';

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
    PricingController,
    UploadsController,
    ImportsController,
  ],
  providers: [
    CategoriesService,
    BrandsService,
    AttributesService,
    ProductsService,
    PricingService,
    UploadsService,
    ImportsService,
    { provide: FILE_STORAGE, useFactory: createFileStorage },
  ],
})
export class AppModule {}
