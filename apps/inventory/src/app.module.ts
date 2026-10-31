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
import { BranchProjectionEntity } from './branches/branch-projection.entity';
import { BranchProjectionHandler } from './branches/branch-projection.handler';
import {
  readReservationTtlMinutes,
  RESERVATION_TTL_MINUTES,
} from './config/inventory.config';
import { CatalogSkuProjectionHandler } from './infrastructure/catalog-reference/catalog-sku-projection.handler';
import { M2_INVENTORY_ENTITIES } from './infrastructure/persistence/inventory.entities';
import { CreateInventoryTables1791900000000 } from './migrations/1791900000000-create-inventory-tables';
import { AddWarehouseStockBalances1791900000100 } from './migrations/1791900000100-add-warehouse-stock-balances';
import { CreateM2InventoryCore1791900000200 } from './migrations/1791900000200-create-m2-inventory-core';
import { DocumentsController } from './modules/documents/documents.controller';
import { DocumentsService } from './modules/documents/documents.service';
import { IssuingController } from './modules/issuing/issuing.controller';
import { IssuingService } from './modules/issuing/issuing.service';
import { ProcurementController } from './modules/procurement/procurement.controller';
import { ProcurementService } from './modules/procurement/procurement.service';
import { ReceivingController } from './modules/receiving/receiving.controller';
import { ReceivingService } from './modules/receiving/receiving.service';
import { StockViewsController } from './modules/stock-views/stock-views.controller';
import { StockViewsService } from './modules/stock-views/stock-views.service';
import { StockQueryController } from './modules/stock/stock-query.controller';
import { StockQueryService } from './modules/stock/stock-query.service';
import { StocktakeController } from './modules/stocktake/stocktake.controller';
import { StocktakeService } from './modules/stocktake/stocktake.service';
import { TransfersController } from './modules/transfers/transfers.controller';
import { TransfersService } from './modules/transfers/transfers.service';
import { WarehousesController } from './modules/warehouses/warehouses.controller';
import { WarehousesService } from './modules/warehouses/warehouses.service';
import { WarehouseScopeService } from './scope/warehouse-scope';
import {
  InventoryLedgerEntity,
  StockItemEntity,
  StockReservationEntity,
  StockReservationItemEntity,
  WAREHOUSE_STOCK_ENTITIES,
} from './stock/entities/stock.entities';
import { OrderCompletedHandler } from './stock/order-completed.handler';
import { ReservationExpiryJob } from './stock/reservation-expiry.job';
import {
  ReservationsController,
  WarehouseReservationsController,
} from './stock/reservations.controller';
import { ReservationsService } from './stock/reservations.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [
    PblLoggingModule.forRoot('inventory'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({
      service: 'inventory',
      redisFromEnv: true,
      database: true,
    }),
    PblDatabaseModule.forRoot({
      entities: [
        StockItemEntity,
        StockReservationEntity,
        StockReservationItemEntity,
        InventoryLedgerEntity,
        BranchProjectionEntity,
        ...WAREHOUSE_STOCK_ENTITIES,
        ...M2_INVENTORY_ENTITIES,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateInventoryTables1791900000000,
        AddWarehouseStockBalances1791900000100,
        CreateM2InventoryCore1791900000200,
      ],
    }),
    PblEventsModule.forRoot({ service: 'inventory' }),
    TenancyModule.forFeature([
      StockItemEntity,
      BranchProjectionEntity,
      ...WAREHOUSE_STOCK_ENTITIES,
      ...M2_INVENTORY_ENTITIES,
    ]),
  ],
  controllers: [
    // before the controllers that own `:id` routes (summary, export, directory)
    DocumentsController,
    StockViewsController,
    StockController,
    WarehousesController,
    StockQueryController,
    ReceivingController,
    IssuingController,
    TransfersController,
    StocktakeController,
    ProcurementController,
    ReservationsController,
    WarehouseReservationsController,
  ],
  providers: [
    WarehouseScopeService,
    StockService,
    WarehousesService,
    StockQueryService,
    StockViewsService,
    DocumentsService,
    ReceivingService,
    IssuingService,
    TransfersService,
    StocktakeService,
    ProcurementService,
    ReservationsService,
    {
      provide: RESERVATION_TTL_MINUTES,
      useFactory: () => readReservationTtlMinutes(),
    },
    ReservationExpiryJob,
    OrderCompletedHandler,
    BranchProjectionHandler,
    CatalogSkuProjectionHandler,
  ],
})
export class AppModule {}
