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
    process.env.QSTASH_TOKEN = 'qstash-test-token';
    process.env.MAIL_SERVICE_URL = 'https://pbl-mail-service.example.com';

    const config = await queueConfig();

    expect(config.qstashToken).toBe('qstash-test-token');
    expect(config.mailServiceUrl).toBe('https://pbl-mail-service.example.com');
  });

  describe('qstashToken', () => {
    it('should throw an error if QSTASH_TOKEN is not set', async () => {
      delete process.env.QSTASH_TOKEN;
      process.env.MAIL_SERVICE_URL = 'https://pbl-mail-service.example.com';
      await expect(async () => await queueConfig()).rejects.toThrow(Error);
    });
  });

  describe('mailServiceUrl', () => {
    it('should throw an error if MAIL_SERVICE_URL is not a valid URL', async () => {
      process.env.QSTASH_TOKEN = 'qstash-test-token';
      process.env.MAIL_SERVICE_URL = 'not-a-url';
      await expect(async () => await queueConfig()).rejects.toThrow(Error);
    });

    it('should throw an error if MAIL_SERVICE_URL is not set', async () => {
      process.env.QSTASH_TOKEN = 'qstash-test-token';
      delete process.env.MAIL_SERVICE_URL;
      await expect(async () => await queueConfig()).rejects.toThrow(Error);
    });
  });
});
