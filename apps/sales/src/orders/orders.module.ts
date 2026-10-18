import { Module } from '@nestjs/common';
import { TenancyModule } from '@pbl/common';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import { BranchProjectionHandler } from '../branches/branch-projection.handler';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderEntity } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TenancyModule.forFeature([
      OrderEntity,
      OrderItemEntity,
      BranchProjectionEntity,
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, BranchProjectionHandler],
})
export class OrdersModule {}
