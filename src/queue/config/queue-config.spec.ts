import queueConfig from './queue.config';

describe('QueueConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  beforeAll(() => {
    jest.spyOn(console, 'info').mockImplementation();
  });

  it('should return the queue configuration', async () => {
    process.env.SQS_QUEUE_URL =
      'https://sqs.ap-southeast-1.amazonaws.com/123456789012/email-verification';
    process.env.AWS_REGION = 'ap-southeast-1';

    const config = await queueConfig();

    expect(config.queueUrl).toBe(
      'https://sqs.ap-southeast-1.amazonaws.com/123456789012/email-verification',
    );
    expect(config.region).toBe('ap-southeast-1');
  });

  describe('queueUrl', () => {
    it('should throw an error if SQS_QUEUE_URL is not a valid URL', async () => {
      process.env.SQS_QUEUE_URL = 'not-a-url';
      process.env.AWS_REGION = 'ap-southeast-1';
      await expect(async () => await queueConfig()).rejects.toThrow(Error);
    });

    it('should throw an error if SQS_QUEUE_URL is not set', async () => {
      delete process.env.SQS_QUEUE_URL;
      process.env.AWS_REGION = 'ap-southeast-1';
      await expect(async () => await queueConfig()).rejects.toThrow(Error);
    });
  });

  describe('region', () => {
    it('should throw an error if AWS_REGION is not set', async () => {
      process.env.SQS_QUEUE_URL =
        'https://sqs.ap-southeast-1.amazonaws.com/123456789012/email-verification';
      delete process.env.AWS_REGION;
      await expect(async () => await queueConfig()).rejects.toThrow(Error);
    });
  });
});
