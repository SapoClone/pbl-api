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
import { BranchGuard } from './common/branch-guard';
import {
  RESERVATION_TTL_MINUTES,
  readReservationTtlMinutes,
} from './config/inventory.config';
import {
  StockIssuesController,
  StockTakesController,
  StockTransfersController,
} from './documents/documents.controller';
import { StockIssuesService } from './documents/stock-issues.service';
import { StockTakesService } from './documents/stock-takes.service';
import { StockTransfersService } from './documents/stock-transfers.service';
import { CreateInventoryTables1791900000000 } from './migrations/1791900000000-create-inventory-tables';
import { AddPurchasingAndDocuments1792100000000 } from './migrations/1792100000000-add-purchasing-and-documents';
import { PurchaseOrdersController } from './purchasing/purchase-orders.controller';
import { PurchaseOrdersService } from './purchasing/purchase-orders.service';
import {
  InventoryLedgerEntity,
  StockItemEntity,
  StockReservationEntity,
  StockReservationItemEntity,
} from './stock/entities/stock.entities';
import { LedgerService } from './stock/ledger.service';
import { OrderCompletedHandler } from './stock/order-completed.handler';
import { ReservationExpiryJob } from './stock/reservation-expiry.job';
import { ReservationsController } from './stock/reservations.controller';
import { ReservationsService } from './stock/reservations.service';
import { StockThresholdsService } from './stock/stock-thresholds.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';
import { ThresholdsLedgerController } from './stock/thresholds-ledger.controller';
import { SuppliersController } from './suppliers/suppliers.controller';
import { SuppliersService } from './suppliers/suppliers.service';

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
      migrations: [
        ...CONSUMER_MIGRATIONS,
        CreateInventoryTables1791900000000,
        AddPurchasingAndDocuments1792100000000,
      ],
    }),
    PblEventsModule.forRoot({ service: 'inventory' }),
    TenancyModule.forFeature([StockItemEntity, BranchProjectionEntity]),
  ],
  controllers: [
    StockController,
    ThresholdsLedgerController,
    ReservationsController,
    SuppliersController,
    PurchaseOrdersController,
    StockTransfersController,
    StockTakesController,
    StockIssuesController,
  ],
  providers: [
    StockService,
    StockThresholdsService,
    LedgerService,
    BranchGuard,
    SuppliersService,
    PurchaseOrdersService,
    StockTransfersService,
    StockTakesService,
    StockIssuesService,
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
