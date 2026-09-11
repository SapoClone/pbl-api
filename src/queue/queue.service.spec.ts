import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from './queue.service';

const sendMock = jest.fn();

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({
    send: sendMock,
  })),
  SendMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(async () => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ MessageId: 'msg-test-123' });

    const configValues: Record<string, string> = {
      'queue.queueUrl':
        'https://sqs.ap-southeast-1.amazonaws.com/123456789012/email-verification',
      'queue.region': 'ap-southeast-1',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: string) => configValues[key] },
        },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should send an email-verification message to the SQS queue', async () => {
    await service.enqueueEmailVerification('user@example.com', 'tok123');

    expect(sendMock).toHaveBeenCalledWith({
      input: {
        QueueUrl:
          'https://sqs.ap-southeast-1.amazonaws.com/123456789012/email-verification',
        MessageBody: JSON.stringify({
          email: 'user@example.com',
          token: 'tok123',
        }),
      },
    });
  });
});
