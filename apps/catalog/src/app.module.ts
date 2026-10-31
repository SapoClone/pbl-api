import { Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { PblHealthModule, PblLoggingModule, TenancyModule } from '@pbl/common';
import { PblDatabaseModule } from '@pbl/events';
import { CATALOG_ENTITIES } from './entities/catalog.entities';
import { CreateCatalogTables1792000000000 } from './migrations/1792000000000-create-catalog-tables';
import {
  ProductsController,
  VariantsController,
} from './products/products.controller';
import { ProductsService } from './products/products.service';
import { AttributesService } from './taxonomy/attributes.service';
import { BrandsService } from './taxonomy/brands.service';
import { CategoriesService } from './taxonomy/categories.service';
import {
  AttributesController,
  BrandsController,
  CategoriesController,
} from './taxonomy/taxonomy.controller';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [
    PblLoggingModule.forRoot('catalog'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({ service: 'catalog', redisFromEnv: true }),
    PblDatabaseModule.forRoot({
      entities: CATALOG_ENTITIES,
      migrations: [CreateCatalogTables1792000000000],
    }),
    TenancyModule.forFeature(CATALOG_ENTITIES),
  ],
  controllers: [
    CategoriesController,
    BrandsController,
    AttributesController,
    ProductsController,
    VariantsController,
  ],
  providers: [
    CategoriesService,
    BrandsService,
    AttributesService,
    ProductsService,
  ],
})
export class AppModule {}
