import { Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { PblHealthModule, PblLoggingModule } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  PblDatabaseModule,
  PblEventsModule,
} from '@pbl/events';
import { BranchProjectionEntity } from './branches/branch-projection.entity';
import { CreateSalesTables1791800000000 } from './migrations/1791800000000-create-sales-tables';
import { AddOrderIdempotency1791800000200 } from './migrations/1791800000200-add-order-idempotency';
import { OrderItemEntity } from './orders/entities/order-item.entity';
import { OrderEntity } from './orders/entities/order.entity';
import { OrdersModule } from './orders/orders.module';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [
    PblLoggingModule.forRoot('sales'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({ service: 'sales', redisFromEnv: true }),
    PblDatabaseModule.forRoot({
      entities: [
        OrderEntity,
        OrderItemEntity,
        BranchProjectionEntity,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateSalesTables1791800000000,
        AddOrderIdempotency1791800000200,
      ],
    }),
    PblEventsModule.forRoot({ service: 'sales' }),
    OrdersModule,
  ],
})
export class AppModule {}
