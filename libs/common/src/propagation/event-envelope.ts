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
export interface EventEnvelope<
  T = unknown,
  TenantId extends string | null = string,
> {
  id: string;
  type: string;
  version: number;
  /** ISO-8601 timestamp */
  occurredAt: string;
  /**
   * The store the event belongs to. `null` only on a platform-scope event (`PlatformEventEnvelope`: a platform admin
   * action that belongs to no store); every other event has a store and consumers may rely on it.
   */
  tenantId: TenantId;
  actor: RequestActor | null;
  traceId: string;
  payload: T;
}

/** An event of the platform itself (settings, admins): no store, so no tenant context is entered for it */
export type PlatformEventEnvelope<T = unknown> = EventEnvelope<T, null>;

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

/** Builds a platform-scope envelope: no store, whatever the request context says */
export function createPlatformEvent<T>(
  type: string,
  version: number,
  payload: T,
): PlatformEventEnvelope<T> {
  const state = RequestContext.get();
  return {
    id: randomUUID(),
    type,
    version,
    occurredAt: new Date().toISOString(),
    tenantId: null,
    actor: state?.actor ?? null,
    traceId: state?.requestId ?? randomUUID(),
    payload,
  };
}

const nonEmpty = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0;

function assertEnvelope(
  e: any,
): asserts e is EventEnvelope<unknown, string | null> {
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
  // null is the platform scope; anything else must be a store id (undefined and '' stay invalid)
  if (e.tenantId !== null && !nonEmpty(e.tenantId)) {
    throw new InvalidEventEnvelopeError('tenantId');
  }
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
 * A platform-scope envelope (`tenantId` null) enters a context with no tenant.
 */
export async function consumeEvent<T, R, N extends string | null = string>(
  envelope: EventEnvelope<T, N>,
  handler: (event: EventEnvelope<T, N>) => R | Promise<R>,
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
