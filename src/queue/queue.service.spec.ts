import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from './queue.service';

const publishJSONMock = jest.fn();

jest.mock('@upstash/qstash', () => ({
  Client: jest.fn().mockImplementation(() => ({
    publishJSON: publishJSONMock,
  })),
}));

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(async () => {
    publishJSONMock.mockReset();
    publishJSONMock.mockResolvedValue({ messageId: 'msg_test123' });

    const configValues: Record<string, string> = {
      'queue.qstashToken': 'qstash-test-token',
      'queue.mailServiceUrl': 'https://pbl-mail-service.example.com',
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

  it('should publish an email-verification message to the mail service', async () => {
    await service.enqueueEmailVerification('user@example.com', 'tok123');

    expect(publishJSONMock).toHaveBeenCalledWith({
      url: 'https://pbl-mail-service.example.com/tasks/email-verification',
      body: { email: 'user@example.com', token: 'tok123' },
    });
  });
});
