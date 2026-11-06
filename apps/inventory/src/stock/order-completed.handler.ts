import { Injectable, Logger } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import { OrderCompletedPayload, SALES_ORDER_COMPLETED } from '@pbl/contracts';
import { OnEvent, qualifiedTable } from '@pbl/events';
import { EntityManager } from 'typeorm';
import { ReservationsService } from './reservations.service';

/**
 * A completed order turns its hold into a deduction (in the inbox transaction).
 *
 * D16 (partial): the older branch-and-SKU-code store (`stock_item`) is only
 * for orders that were held in it. An order whose stock lives in the
 * warehouse flow (it has a warehouse reservation, committed through
 * `POST /internal/v1/reservations/{id}/commit`) is skipped here: the old
 * path used to write a zero `sale_shortfall` ledger row for it (and deduct
 * if legacy rows happened to exist). The fact is read from inventory's own
 * data, so the event needs no new field. Full retirement of the older store
 * waits until sales has moved every checkout to the warehouse flow.
 */
@Injectable()
export class OrderCompletedHandler {
  private readonly logger = new Logger(OrderCompletedHandler.name);

  constructor(private readonly reservations: ReservationsService) {}

  @OnEvent(SALES_ORDER_COMPLETED.type)
  async onCompleted(
    event: EventEnvelope<OrderCompletedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    if (
      await this.hasWarehouseReservation(
        manager,
        event.tenantId,
        event.payload.orderId,
      )
    ) {
      this.logger.debug(
        `Order ${event.payload.code}: stock was committed in the warehouse flow, legacy deduction skipped`,
      );
      return;
    }
    await this.reservations.commit(manager, event.tenantId, event.payload);
  }

  private async hasWarehouseReservation(
    manager: EntityManager,
    tenantId: string,
    orderId: string,
  ): Promise<boolean> {
    const rows = await manager.query(
      `SELECT 1 FROM ${qualifiedTable(manager.connection, 'warehouse_reservation')}
        WHERE tenant_id = $1 AND source_ref_type = 'ORDER' AND source_ref_id = $2
        LIMIT 1`,
      [tenantId, orderId],
    );
    return rows.length > 0;
  }
}
