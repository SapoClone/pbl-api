import { Module } from '@nestjs/common';
import { PblPropagationModule, TenancyModule } from '@pbl/common';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import { BranchProjectionHandler } from '../branches/branch-projection.handler';
import { readInventoryUrl } from '../config/sales.config';
import { InventoryClient } from '../inventory/inventory.client';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderEntity } from './entities/order.entity';
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
      BranchProjectionEntity,
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, BranchProjectionHandler, InventoryClient],
})
export class OrdersModule {}
