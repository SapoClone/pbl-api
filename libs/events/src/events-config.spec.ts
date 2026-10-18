import { readEventsConfig } from './events-config';

describe('readEventsConfig', () => {
  it('defaults to the local transport and the documented intervals', () => {
    expect(readEventsConfig({})).toMatchObject({
      transport: 'sqs-direct',
      relayIntervalMs: 500,
      relayBatch: 50,
      maxAttempts: 10,
      maxReceiveCount: 3,
      outboxRetentionDays: 7,
    });
  });

  it('reads overrides and ignores garbage', () => {
    const config = readEventsConfig({
      EVENTS_RELAY_INTERVAL_MS: '100',
      EVENTS_RELAY_BATCH: 'many',
      EVENTS_MAX_RECEIVE_COUNT: '5',
    });
    expect(config.relayIntervalMs).toBe(100);
    expect(config.relayBatch).toBe(50);
    expect(config.maxReceiveCount).toBe(5);
  });

  it('requires a topic for the sns transport', () => {
    expect(() => readEventsConfig({ EVENTS_TRANSPORT: 'sns' })).toThrow(
      'EVENTS_TOPIC_ARN',
    );
    expect(
      readEventsConfig({
        EVENTS_TRANSPORT: 'sns',
        EVENTS_TOPIC_ARN: 'arn:aws:sns:ap-southeast-1:1:pbl-platform-events',
      }).transport,
    ).toBe('sns');
  });

  it('rejects an unknown transport', () => {
    expect(() => readEventsConfig({ EVENTS_TRANSPORT: 'kafka' })).toThrow(
      'EVENTS_TRANSPORT',
    );
  });
});
