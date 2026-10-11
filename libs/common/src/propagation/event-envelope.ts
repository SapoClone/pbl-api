import { randomUUID } from 'crypto';
import { RequestActor, RequestContext } from '../context';
import { TenantContext } from '../tenancy';

/**
 * Envelope of events between our services. Only internal producers write it,
 * with the tenant taken from their request context; consumers trust the
 * tenant in it (it never comes from a client).
 *
 * Platform's SQS email message is NOT an envelope: it is consumed by
 * pbl-mail-service and its format must not change.
 */
export interface EventEnvelope<T = unknown> {
  id: string;
  type: string;
  version: number;
  /** ISO-8601 timestamp */
  occurredAt: string;
  tenantId: string;
  actor: RequestActor | null;
  traceId: string;
  payload: T;
}

export class InvalidEventEnvelopeError extends Error {
  constructor(reason: string) {
    super(`Invalid event envelope: ${reason}`);
    this.name = 'InvalidEventEnvelopeError';
  }
}

/** Builds an envelope; throws MissingTenantContextError outside a tenant */
export function createEvent<T>(
  type: string,
  version: number,
  payload: T,
): EventEnvelope<T> {
  const tenantId = TenantContext.require();
  const state = RequestContext.get();
  return {
    id: randomUUID(),
    type,
    version,
    occurredAt: new Date().toISOString(),
    tenantId,
    actor: state?.actor ?? null,
    traceId: state?.requestId ?? randomUUID(),
    payload,
  };
}

const nonEmpty = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0;

function assertEnvelope(e: any): asserts e is EventEnvelope {
  if (!e || typeof e !== 'object') {
    throw new InvalidEventEnvelopeError('not an object');
  }
  if (!nonEmpty(e.id)) throw new InvalidEventEnvelopeError('id');
  if (!nonEmpty(e.type)) throw new InvalidEventEnvelopeError('type');
  if (!Number.isInteger(e.version)) {
    throw new InvalidEventEnvelopeError('version');
  }
  if (!nonEmpty(e.occurredAt) || Number.isNaN(Date.parse(e.occurredAt))) {
    throw new InvalidEventEnvelopeError('occurredAt');
  }
  if (!nonEmpty(e.tenantId)) throw new InvalidEventEnvelopeError('tenantId');
  if (!nonEmpty(e.traceId)) throw new InvalidEventEnvelopeError('traceId');
  if (
    e.actor !== null &&
    !(e.actor && nonEmpty(e.actor.id) && nonEmpty(e.actor.type))
  ) {
    throw new InvalidEventEnvelopeError('actor');
  }
  if (!('payload' in e)) throw new InvalidEventEnvelopeError('payload');
}

/**
 * Validates the envelope, then runs `handler` in a fresh request context with
 * the envelope's tenant, trace id and actor. No Authorization is carried.
 */
export async function consumeEvent<T, R>(
  envelope: EventEnvelope<T>,
  handler: (event: EventEnvelope<T>) => R | Promise<R>,
): Promise<R> {
  assertEnvelope(envelope);
  return RequestContext.run(
    {
      tenantId: envelope.tenantId,
      requestId: envelope.traceId,
      actor: envelope.actor,
    },
    () => handler(envelope),
  );
}
