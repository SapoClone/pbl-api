/**
 * Integration tests of the event bus against a real Postgres and a real SQS
 * (ElasticMQ), the four scenarios ADR-0007 requires plus competing relays.
 * They need `docker compose up -d postgres elasticmq`; run with
 * `pnpm test:events:int`. Everything is created under a throwaway schema and
 * throwaway queue names.
 */
import {
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { EventEnvelope, RequestContext } from '@pbl/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  CONSUMER_MIGRATIONS,
  EventConsumer,
  EventHandlerRegistry,
  EventOutbox,
  InboxEventEntity,
  OutboxEventEntity,
  OutboxRelay,
  PRODUCER_MIGRATIONS,
  QueueProvisioner,
  SqsDirectPublisher,
  readEventsConfig,
  type EventPublisher,
} from '../src';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { redrive } = require('../../../scripts/redrive-dlq.js');

process.env.AWS_ENDPOINT_URL_SQS ??= 'http://localhost:9324';
process.env.AWS_ACCESS_KEY_ID ??= 'local';
process.env.AWS_SECRET_ACCESS_KEY ??= 'local';

const TYPE = 'platform.branch.updated';
const TENANT = '11111111-1111-4111-8111-111111111111';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const config = readEventsConfig({
  EVENTS_VISIBILITY_TIMEOUT: '1',
  EVENTS_POLL_WAIT_SECONDS: '1',
  EVENTS_MAX_RECEIVE_COUNT: '3',
});

describe('event bus (Postgres + SQS)', () => {
  const schema = `events_it_${Date.now().toString(36)}`;
  let dataSource: DataSource;
  let sqs: SQSClient;

  beforeAll(async () => {
    sqs = new SQSClient({ region: 'ap-southeast-1' });
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.EVENTS_IT_DB_HOST ?? 'localhost',
      port: Number(process.env.EVENTS_IT_DB_PORT ?? 25432),
      username: 'postgres',
      password: 'postgres',
      database: 'pbl',
      schema,
      entities: [OutboxEventEntity, InboxEventEntity],
      migrations: [...PRODUCER_MIGRATIONS, ...CONSUMER_MIGRATIONS],
    });
    await dataSource.initialize();
    await dataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
    sqs.destroy();
  });

  /** A fresh service name (so a fresh queue) with its relay and consumer */
  async function setup(
    publisherFor?: (real: EventPublisher) => EventPublisher,
  ) {
    const service = `it${randomUUID().slice(0, 8)}`;
    const queues = new QueueProvisioner(sqs, config);
    await queues.ensureQueue(service);
    const real = new SqsDirectPublisher(sqs, queues, () => [service]);
    const publisher = publisherFor ? publisherFor(real) : real;
    const relay = new OutboxRelay(dataSource, publisher, config, {
      service: 'it',
      produces: true,
    });
    const registry = new EventHandlerRegistry(
      null as never,
      null as never,
      null as never,
    );
    const consumer = new EventConsumer(
      dataSource,
      registry,
      queues,
      sqs,
      config,
      {
        service,
        produces: false,
      },
    );
    return { service, queues, relay, registry, consumer };
  }

  const outboxRows = () => dataSource.getRepository(OutboxEventEntity).find();
  const inboxCount = () => dataSource.getRepository(InboxEventEntity).count();

  /** Writes an event to the outbox the way a producer does, in a transaction */
  async function emit(payload: object = { id: 'b1' }): Promise<EventEnvelope> {
    return RequestContext.run({ tenantId: TENANT, requestId: 'it' }, () =>
      dataSource.transaction((manager) =>
        new EventOutbox().add(manager, { type: TYPE, version: 1 }, payload, {
          tenantId: TENANT,
        }),
      ),
    );
  }

  const receive = async (queueUrl: string, waitSeconds = 2) =>
    (
      await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: waitSeconds,
        }),
      )
    ).Messages ?? [];
  const dlqUrl = async (service: string) =>
    (
      await sqs.send(
        new GetQueueUrlCommand({ QueueName: `${service}-events-dlq` }),
      )
    ).QueueUrl!;

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM "${schema}"."outbox_event"`);
    await dataSource.query(`DELETE FROM "${schema}"."inbox_event"`);
  });

  it('delivers an event from the outbox to a handler once', async () => {
    const { relay, registry, consumer } = await setup();
    const handled: string[] = [];
    registry.register(TYPE, async (event) => void handled.push(event.id));

    const event = await emit();
    expect(await relay.relayOnce()).toBe(1);
    await consumer.pollOnce(3);

    expect(handled).toEqual([event.id]);
    expect(await inboxCount()).toBe(1);
    const [row] = await outboxRows();
    expect(row.publishedAt).not.toBeNull();
  });

  it('1. a failing handler is retried, then the message lands in the DLQ after 3 receives', async () => {
    const { service, relay, registry, consumer } = await setup();
    const handler = jest.fn().mockRejectedValue(new Error('projection failed'));
    registry.register(TYPE, handler);
    await emit();
    await relay.relayOnce();

    for (let attempt = 0; attempt < 4; attempt++) {
      await consumer.pollOnce(2);
      await sleep(1300); // the visibility timeout is 1 s
    }

    expect(handler).toHaveBeenCalledTimes(3);
    expect(await inboxCount()).toBe(0); // every attempt rolled back
    expect(await receive(await dlqUrl(service), 3)).toHaveLength(1);
  });

  it('2. redrive moves the dead letter back and it is processed once the handler is fixed', async () => {
    const { service, relay, registry, consumer } = await setup();
    let broken = true;
    const processed: string[] = [];
    registry.register(TYPE, async (event) => {
      if (broken) throw new Error('not yet');
      processed.push(event.id);
    });
    const event = await emit();
    await relay.relayOnce();
    for (let attempt = 0; attempt < 4; attempt++) {
      await consumer.pollOnce(2);
      await sleep(1300);
    }
    expect(processed).toEqual([]);

    broken = false;
    expect(await redrive({ sqs, service })).toBe(1);
    await consumer.pollOnce(3);

    expect(processed).toEqual([event.id]);
    expect(await inboxCount()).toBe(1);
  });

  it('3. a duplicate delivery is ignored by the inbox', async () => {
    const { queues, service, registry, consumer } = await setup();
    const handler = jest.fn().mockResolvedValue(undefined);
    registry.register(TYPE, handler);
    const envelope: EventEnvelope = {
      id: randomUUID(),
      type: TYPE,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT,
      actor: null,
      traceId: 'dup',
      payload: { id: 'b1' },
    };
    const queueUrl = await queues.ensureQueue(service);
    for (let i = 0; i < 2; i++) {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(envelope),
        }),
      );
    }

    await consumer.pollOnce(2);
    await consumer.pollOnce(2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(await inboxCount()).toBe(1);
  });

  it('4. when the publisher fails and recovers, the outbox row is published exactly once', async () => {
    let failures = 2;
    const sent: string[] = [];
    const { relay, registry, consumer } = await setup((real) => ({
      publish: async (envelope) => {
        if (failures-- > 0) throw new Error('sns down');
        sent.push(envelope.id);
        await real.publish(envelope);
      },
    }));
    const handler = jest.fn().mockResolvedValue(undefined);
    registry.register(TYPE, handler);
    const event = await emit();

    expect(await relay.relayOnce()).toBe(0);
    let [row] = await outboxRows();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('sns down');
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now()); // backed off
    expect(await relay.relayOnce()).toBe(0); // not due yet: nothing is attempted
    expect(failures).toBe(1);

    // time passes: the row is due again
    await dataSource.query(
      `UPDATE "${schema}"."outbox_event" SET "next_attempt_at" = now()`,
    );
    expect(await relay.relayOnce()).toBe(0);
    await dataSource.query(
      `UPDATE "${schema}"."outbox_event" SET "next_attempt_at" = now()`,
    );
    expect(await relay.relayOnce()).toBe(1);
    expect(await relay.relayOnce()).toBe(0); // already published

    [row] = await outboxRows();
    expect(row.publishedAt).not.toBeNull();
    expect(sent).toEqual([event.id]);
    await consumer.pollOnce(3);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps a row that keeps failing instead of dropping it', async () => {
    const tight = new OutboxRelay(
      dataSource,
      { publish: async () => Promise.reject(new Error('still down')) },
      readEventsConfig({ EVENTS_MAX_ATTEMPTS: '2' }),
      { service: 'it', produces: true },
    );
    await emit();

    await tight.relayOnce();
    await dataSource.query(
      `UPDATE "${schema}"."outbox_event" SET "next_attempt_at" = now()`,
    );
    await tight.relayOnce();

    const [row] = await outboxRows();
    expect(row.attempts).toBe(2);
    expect(row.failedAt).not.toBeNull();
    expect(row.publishedAt).toBeNull();
    // parked rows are no longer picked up
    expect(await tight.relayOnce()).toBe(0);
  });

  it('cleanup deletes old published rows and keeps everything else', async () => {
    const { relay } = await setup();
    const old = await emit();
    const recent = await emit();
    const unpublished = await emit();
    const table = `"${schema}"."outbox_event"`;
    await dataSource.query(
      `UPDATE ${table} SET "published_at" = now() - interval '8 days' WHERE "id" = $1`,
      [old.id],
    );
    await dataSource.query(
      `UPDATE ${table} SET "published_at" = now() - interval '1 day' WHERE "id" = $1`,
      [recent.id],
    );
    await dataSource.query(
      `UPDATE ${table} SET "created_at" = now() - interval '30 days' WHERE "id" = $1`,
      [unpublished.id],
    );

    expect(await relay.cleanup()).toBe(1);

    const left = (await outboxRows()).map((r) => r.id).sort();
    expect(left).toEqual([recent.id, unpublished.id].sort());
  });

  it('two relays at once never publish the same row twice (SKIP LOCKED)', async () => {
    const sent: string[] = [];
    const publisher: EventPublisher = {
      publish: async (envelope) => {
        await sleep(30);
        sent.push(envelope.id);
      },
    };
    const options = { service: 'it', produces: true };
    // a batch of 3 makes the two relays share the 6 rows instead of one taking all
    const small = readEventsConfig({ EVENTS_RELAY_BATCH: '3' });
    const a = new OutboxRelay(dataSource, publisher, small, options);
    const b = new OutboxRelay(dataSource, publisher, small, options);
    for (let i = 0; i < 6; i++) await emit({ id: `b${i}` });

    const [fromA, fromB] = await Promise.all([a.relayOnce(), b.relayOnce()]);

    expect(fromA + fromB).toBe(6);
    expect(new Set(sent).size).toBe(6);
    expect(sent).toHaveLength(6);
  });
});
