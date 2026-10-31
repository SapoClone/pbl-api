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
import { CreateReferenceAndShiftTables1792000000000 } from './migrations/1792000000000-create-reference-and-shift-tables';
import { ExtendOrders1792000000100 } from './migrations/1792000000100-extend-orders';
import { OrderItemEntity } from './orders/entities/order-item.entity';
import { OrderPaymentEntity } from './orders/entities/order-payment.entity';
import { OrderStatusHistoryEntity } from './orders/entities/order-status-history.entity';
import { OrderEntity } from './orders/entities/order.entity';
import { OrdersModule } from './orders/orders.module';
import { SalesChannelEntity } from './reference/sales-channel.entity';
import { ShippingProviderEntity } from './reference/shipping-provider.entity';
import { RegisterEntity } from './registers/register.entity';
import { ShiftEntity } from './shifts/shift.entity';

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
        OrderPaymentEntity,
        OrderStatusHistoryEntity,
        BranchProjectionEntity,
        SalesChannelEntity,
        ShippingProviderEntity,
        RegisterEntity,
        ShiftEntity,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateSalesTables1791800000000,
        AddOrderIdempotency1791800000200,
        CreateReferenceAndShiftTables1792000000000,
        ExtendOrders1792000000100,
      ],
    }),
    PblEventsModule.forRoot({ service: 'sales' }),
    OrdersModule,
  ],
})
export class AppModule {}
