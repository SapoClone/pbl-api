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
import { CreateInventoryTables1791900000000 } from './migrations/1791900000000-create-inventory-tables';
import { AddWarehouseStockBalances1791900000100 } from './migrations/1791900000100-add-warehouse-stock-balances';
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
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateInventoryTables1791900000000,
        AddWarehouseStockBalances1791900000100,
      ],
    }),
    PblEventsModule.forRoot({ service: 'inventory' }),
    TenancyModule.forFeature([
      StockItemEntity,
      BranchProjectionEntity,
      ...WAREHOUSE_STOCK_ENTITIES,
    ]),
  ],
  controllers: [
    StockController,
    ReservationsController,
    WarehouseReservationsController,
  ],
  providers: [
    StockService,
    ReservationsService,
    {
      provide: RESERVATION_TTL_MINUTES,
      useFactory: () => readReservationTtlMinutes(),
    },
    ReservationExpiryJob,
    OrderCompletedHandler,
    BranchProjectionHandler,
  ],
})
export class AppModule {}
