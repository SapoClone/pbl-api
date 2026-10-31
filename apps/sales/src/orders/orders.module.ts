import { Module } from '@nestjs/common';
import { PblPropagationModule, TenancyModule } from '@pbl/common';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import { BranchProjectionHandler } from '../branches/branch-projection.handler';
import { readInventoryUrl } from '../config/sales.config';
import { CatalogClient } from '../infrastructure/catalog-client/catalog.client';
import { M3_SALES_ENTITIES } from '../infrastructure/persistence/sales.entities';
import { InternalOrdersController } from '../internal/internal-orders.controller';
import { InventoryClient } from '../inventory/inventory.client';
import { CheckoutController } from '../modules/checkout/checkout.controller';
import { CheckoutService } from '../modules/checkout/checkout.service';
import { FulfillmentController } from '../modules/fulfillment/fulfillment.controller';
import { FulfillmentService } from '../modules/fulfillment/fulfillment.service';
import { M3OrdersController } from '../modules/orders/m3-orders.controller';
import { M3OrdersService } from '../modules/orders/m3-orders.service';
import { PosController } from '../modules/pos/pos.controller';
import { PosService } from '../modules/pos/pos.service';
import { PromotionsController } from '../modules/promotions/promotions.controller';
import { PromotionsService } from '../modules/promotions/promotions.service';
import { ReferenceController } from '../modules/reference/reference.controller';
import { ReferenceService } from '../modules/reference/reference.service';
import { ReturnsController } from '../modules/returns/returns.controller';
import { ReturnsService } from '../modules/returns/returns.service';
import { OrderActionsService } from '../modules/screen/order-actions.service';
import { OrderQueryService } from '../modules/screen/order-query.service';
import { OrderViewsController } from '../modules/screen/order-views.controller';
import { ScreenShiftsController } from '../modules/screen/screen-shifts.controller';
import { ShiftViewService } from '../modules/screen/shift-view.service';
import { ShiftsController } from '../modules/shifts/shifts.controller';
import { ShiftsService } from '../modules/shifts/shifts.service';
import { OrderItemEntity } from './entities/order-item.entity';
import { CheckoutWorkflowEntity, OrderEntity } from './entities/order.entity';
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
      CheckoutWorkflowEntity,
      BranchProjectionEntity,
      ...M3_SALES_ENTITIES,
    ]),
  ],
  controllers: [
    // before OrdersController: `/orders/summary` and `/orders/export` are not order ids
    OrderViewsController,
    OrdersController,
    M3OrdersController,
    ShiftsController,
    PosController,
    CheckoutController,
    ReturnsController,
    FulfillmentController,
    PromotionsController,
    ReferenceController,
    ScreenShiftsController,
    InternalOrdersController,
  ],
  providers: [
    OrderQueryService,
    OrderActionsService,
    ShiftViewService,
    ReferenceService,
    OrdersService,
    M3OrdersService,
    ShiftsService,
    PosService,
    CheckoutService,
    ReturnsService,
    FulfillmentService,
    PromotionsService,
    CatalogClient,
    BranchProjectionHandler,
    InventoryClient,
  ],
  exports: [
    OrdersService,
    M3OrdersService,
    ShiftsService,
    PosService,
    CheckoutService,
    ReturnsService,
    FulfillmentService,
    PromotionsService,
    CatalogClient,
    InventoryClient,
  ],
})
export class OrdersModule {}
