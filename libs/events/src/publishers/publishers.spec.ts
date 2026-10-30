import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { subscribersOf } from '@pbl/contracts';
import { QueueProvisioner } from '../sqs-queues';
import { SnsEventPublisher } from './sns-event.publisher';
import { SqsDirectPublisher } from './sqs-direct.publisher';

const event = (type: string) =>
  ({
    id: 'e1',
    type,
    version: 1,
    occurredAt: '2026-10-18T00:00:00.000Z',
    tenantId: 't',
    actor: null,
    traceId: 'tr',
    payload: {},
  }) as any;

describe('SnsEventPublisher', () => {
  it('publishes the envelope to the topic with the type as an attribute', async () => {
    const send = jest.fn().mockResolvedValue({});
    const publisher = new SnsEventPublisher(
      { send } as unknown as SNSClient,
      'arn:topic',
    );
    await publisher.publish(event('platform.branch.created'));

    const command = send.mock.calls[0][0] as PublishCommand;
    expect(command).toBeInstanceOf(PublishCommand);
    expect(command.input.TopicArn).toBe('arn:topic');
    expect(JSON.parse(command.input.Message!)).toMatchObject({ id: 'e1' });
    expect(command.input.MessageAttributes!.type.StringValue).toBe(
      'platform.branch.created',
    );
  });

  it('lets a publish failure escape so the relay retries', async () => {
    const send = jest.fn().mockRejectedValue(new Error('sns down'));
    const publisher = new SnsEventPublisher(
      { send } as unknown as SNSClient,
      'arn:topic',
    );
    await expect(publisher.publish(event('x'))).rejects.toThrow('sns down');
  });
});

describe('SqsDirectPublisher', () => {
  const queues = {
    ensureQueue: jest.fn(async (s: string) => `http://q/${s}-events`),
  } as unknown as QueueProvisioner;

  it('sends the event to the queue of every subscriber in the topology', async () => {
    const send = jest.fn().mockResolvedValue({});
    const publisher = new SqsDirectPublisher(
      { send } as unknown as SQSClient,
      queues,
    );
    await publisher.publish(event('platform.branch.updated'));

    const expectedSubscribers = subscribersOf('platform.branch.updated');
    expect(send).toHaveBeenCalledTimes(expectedSubscribers.length);
    const urls = send.mock.calls.map(
      ([command]) => (command as SendMessageCommand).input.QueueUrl,
    );
    expect(urls).toEqual(
      expectedSubscribers.map((service) => `http://q/${service}-events`),
    );
  });

  it('sends nothing when nobody subscribes', async () => {
    const send = jest.fn();
    const publisher = new SqsDirectPublisher(
      { send } as unknown as SQSClient,
      queues,
    );
    await publisher.publish(event('nobody.listens'));
    expect(send).not.toHaveBeenCalled();
  });
});
