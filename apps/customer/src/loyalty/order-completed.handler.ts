import { Injectable } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import { OrderCompletedPayload, SALES_ORDER_COMPLETED } from '@pbl/contracts';
import { OnEvent } from '@pbl/events';
import { EntityManager } from 'typeorm';
import { LoyaltyService } from './loyalty.service';

/** A completed order moves the buyer's totals and earns points (in the inbox transaction) */
@Injectable()
export class OrderCompletedHandler {
  constructor(private readonly loyalty: LoyaltyService) {}

  @OnEvent(SALES_ORDER_COMPLETED.type)
  onCompleted(
    event: EventEnvelope<OrderCompletedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    return this.loyalty.onOrderCompleted(
      manager,
      event.tenantId,
      event.payload,
    );
  }
}
