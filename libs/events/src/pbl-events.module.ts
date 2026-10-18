import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamicModule, Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { TOPOLOGY } from '@pbl/contracts';
import { EventConsumer } from './event-consumer.service';
import { EventHandlerRegistry } from './event-handler.registry';
import { EventOutbox } from './event-outbox.service';
import { EventsConfig, readEventsConfig } from './events-config';
import { OutboxRelay } from './outbox-relay.service';
import {
  EVENT_PUBLISHER,
  EventPublisher,
  SnsEventPublisher,
  SqsDirectPublisher,
} from './publishers';
import { QueueProvisioner } from './sqs-queues';
import {
  EVENTS_CONFIG,
  EVENTS_OPTIONS,
  PblEventsOptions,
  SQS_CLIENT,
} from './tokens';

const region = () => process.env.AWS_REGION || 'ap-southeast-1';

/**
 * Events for one service (ADR-0007): the outbox and its relay when the service
 * produces events, the consumer when it has `@OnEvent` handlers. Needs a
 * TypeORM DataSource in the app (see PblDatabaseModule) with the outbox and/or
 * inbox entities and migrations. Import it once per app:
 *
 *   PblEventsModule.forRoot({ service: 'sales' })
 */
@Global()
@Module({})
export class PblEventsModule {
  static forRoot(options: { service: string }): DynamicModule {
    const resolved: PblEventsOptions = {
      service: options.service,
      produces: options.service in TOPOLOGY.producers,
    };
    return {
      module: PblEventsModule,
      imports: [DiscoveryModule],
      providers: [
        { provide: EVENTS_OPTIONS, useValue: resolved },
        { provide: EVENTS_CONFIG, useFactory: () => readEventsConfig() },
        {
          provide: SQS_CLIENT,
          useFactory: () => new SQSClient({ region: region() }),
        },
        {
          provide: QueueProvisioner,
          inject: [SQS_CLIENT, EVENTS_CONFIG],
          useFactory: (sqs: SQSClient, config: EventsConfig) =>
            new QueueProvisioner(sqs, config),
        },
        {
          provide: EVENT_PUBLISHER,
          inject: [SQS_CLIENT, QueueProvisioner, EVENTS_CONFIG],
          useFactory: (
            sqs: SQSClient,
            queues: QueueProvisioner,
            config: EventsConfig,
          ): EventPublisher =>
            config.transport === 'sns'
              ? new SnsEventPublisher(
                  new SNSClient({ region: region() }),
                  config.topicArn!,
                )
              : new SqsDirectPublisher(sqs, queues),
        },
        EventOutbox,
        EventHandlerRegistry,
        OutboxRelay,
        EventConsumer,
      ],
      exports: [EventOutbox, OutboxRelay, EventConsumer, EventHandlerRegistry],
    };
  }
}
