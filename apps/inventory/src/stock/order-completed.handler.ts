import { Injectable } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import { OrderCompletedPayload, SALES_ORDER_COMPLETED } from '@pbl/contracts';
import { OnEvent } from '@pbl/events';
import { EntityManager } from 'typeorm';
import { ReservationsService } from './reservations.service';

/** A completed order turns its hold into a deduction (in the inbox transaction) */
@Injectable()
export class OrderCompletedHandler {
  constructor(private readonly reservations: ReservationsService) {}

  @OnEvent(SALES_ORDER_COMPLETED.type)
  onCompleted(
    event: EventEnvelope<OrderCompletedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    return this.reservations.commit(manager, event.tenantId, event.payload);
  }
}
