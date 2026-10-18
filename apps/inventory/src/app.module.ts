import { Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { PblHealthModule, PblLoggingModule, TenancyModule } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PblDatabaseModule,
  PblEventsModule,
} from '@pbl/events';
import { BranchProjectionEntity } from './branches/branch-projection.entity';
import { BranchProjectionHandler } from './branches/branch-projection.handler';
import { CreateInventoryTables1791900000000 } from './migrations/1791900000000-create-inventory-tables';
import {
  InventoryLedgerEntity,
  StockItemEntity,
  StockReservationEntity,
  StockReservationItemEntity,
} from './stock/entities/stock.entities';
import { OrderCompletedHandler } from './stock/order-completed.handler';
import { ReservationExpiryJob } from './stock/reservation-expiry.job';
import { ReservationsController } from './stock/reservations.controller';
import { ReservationsService } from './stock/reservations.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [
    PblLoggingModule.forRoot('inventory'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({ service: 'inventory', redisFromEnv: true }),
    PblDatabaseModule.forRoot({
      entities: [
        StockItemEntity,
        StockReservationEntity,
        StockReservationItemEntity,
        InventoryLedgerEntity,
        BranchProjectionEntity,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [...CONSUMER_MIGRATIONS, CreateInventoryTables1791900000000],
    }),
    PblEventsModule.forRoot({ service: 'inventory' }),
    TenancyModule.forFeature([StockItemEntity, BranchProjectionEntity]),
  ],
  controllers: [StockController, ReservationsController],
  providers: [
    StockService,
    ReservationsService,
    ReservationExpiryJob,
    OrderCompletedHandler,
    BranchProjectionHandler,
  ],
})
export class AppModule {}
