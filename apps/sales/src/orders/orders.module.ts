import { Module } from '@nestjs/common';
import { PblPropagationModule, TenancyModule } from '@pbl/common';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import { BranchProjectionHandler } from '../branches/branch-projection.handler';
import { CodeSequenceService } from '../common/code-sequence.service';
import { readInventoryUrl } from '../config/sales.config';
import { InventoryClient } from '../inventory/inventory.client';
import { ReferenceController } from '../reference/reference.controller';
import { ReferenceService } from '../reference/reference.service';
import { SalesChannelEntity } from '../reference/sales-channel.entity';
import { ShippingProviderEntity } from '../reference/shipping-provider.entity';
import { RegisterEntity } from '../registers/register.entity';
import { RegistersController } from '../registers/registers.controller';
import { RegistersService } from '../registers/registers.service';
import { ShiftEntity } from '../shifts/shift.entity';
import { ShiftsController } from '../shifts/shifts.controller';
import { ShiftsService } from '../shifts/shifts.service';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderPaymentEntity } from './entities/order-payment.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';
import { OrderEntity } from './entities/order.entity';
import { OrderActionsService } from './order-actions.service';
import { OrderQueryService } from './order-query.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    // the user's token is forwarded to inventory only (never to another host)
    PblPropagationModule.forRoot({
      baseURL: readInventoryUrl(),
    }),
    TenancyModule.forFeature([
      OrderEntity,
      OrderItemEntity,
      OrderPaymentEntity,
      OrderStatusHistoryEntity,
      BranchProjectionEntity,
      SalesChannelEntity,
      ShippingProviderEntity,
      RegisterEntity,
      ShiftEntity,
    ]),
  ],
  controllers: [
    // fixed-path controllers first: `shifts/current` etc. never meet a `:id`
    ReferenceController,
    RegistersController,
    ShiftsController,
    OrdersController,
  ],
  providers: [
    OrdersService,
    OrderActionsService,
    OrderQueryService,
    ReferenceService,
    RegistersService,
    ShiftsService,
    CodeSequenceService,
    BranchProjectionHandler,
    InventoryClient,
  ],
})
export class OrdersModule {}
