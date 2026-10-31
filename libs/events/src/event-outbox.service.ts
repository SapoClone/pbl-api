import { Injectable } from '@nestjs/common';
import { EventEnvelope, RequestContext, createEvent } from '@pbl/common';
import { EventDefinition } from '@pbl/contracts';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { OutboxEventEntity } from './entities';

export interface OutboxAddOptions {
  /**
   * The event's tenant when the request has none (a login before a store is
   * selected). It must come from verified data, never from request input.
   * Without it the tenant comes from the request context.
   */
  tenantId?: string;
}

/**
 * Writes an event to the outbox in the caller's transaction, so a state change
 * and its event commit together or not at all (ADR-0007). The relay publishes it
 * afterwards.
 */
@Injectable()
export class EventOutbox {
  async add<P>(
    manager: EntityManager,
    event: EventDefinition,
    payload: P,
    options: OutboxAddOptions = {},
  ): Promise<EventEnvelope<P>> {
    const envelope = options.tenantId
      ? this.envelopeFor(options.tenantId, event, payload)
      : createEvent(event.type, event.version, payload);

    await manager.getRepository(OutboxEventEntity).insert({
      id: envelope.id,
      tenantId: envelope.tenantId,
      type: envelope.type,
      version: envelope.version,
      payload: envelope as EventEnvelope,
    });
    return envelope;
  }

  async enqueue<P>(
    manager: EntityManager,
    event: EventDefinition,
    params: {
      tenantId: string;
      aggregateId?: string;
      actor?: { id: string; type: string };
      payload: P;
    },
  ): Promise<EventEnvelope<P>> {
    return this.add(manager, event, params.payload, {
      tenantId: params.tenantId,
    });
  }

  private envelopeFor<P>(
    tenantId: string,
    event: EventDefinition,
    payload: P,
  ): EventEnvelope<P> {
    const state = RequestContext.get();
    return {
      id: randomUUID(),
      type: event.type,
      version: event.version,
      occurredAt: new Date().toISOString(),
      tenantId,
      actor: state?.actor ?? null,
      traceId: state?.requestId ?? randomUUID(),
      payload,
    };
  }
}
