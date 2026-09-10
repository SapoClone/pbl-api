import cloudTasksConfig from './cloud-tasks.config';

describe('CloudTasksConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  beforeAll(() => {
    jest.spyOn(console, 'info').mockImplementation();
  });

  it('should return the cloud tasks configuration', async () => {
    process.env.GCP_PROJECT_ID = 'test-project';
    process.env.CLOUD_TASKS_LOCATION = 'asia-southeast1';
    process.env.CLOUD_TASKS_QUEUE_NAME =
      'projects/test-project/locations/asia-southeast1/queues/email-verification';
    process.env.CLOUD_TASKS_MAIL_SERVICE_URL =
      'https://pbl-mail-service.example.run.app';
    process.env.CLOUD_TASKS_INVOKER_SA_EMAIL =
      'pbl-tasks-invoker@test-project.iam.gserviceaccount.com';

    const config = await cloudTasksConfig();

    expect(config.projectId).toBe('test-project');
    expect(config.location).toBe('asia-southeast1');
    expect(config.mailServiceUrl).toBe(
      'https://pbl-mail-service.example.run.app',
    );
  });

  it('should throw if CLOUD_TASKS_MAIL_SERVICE_URL is not a valid URL', async () => {
    process.env.GCP_PROJECT_ID = 'test-project';
    process.env.CLOUD_TASKS_LOCATION = 'asia-southeast1';
    process.env.CLOUD_TASKS_QUEUE_NAME = 'queue';
    process.env.CLOUD_TASKS_MAIL_SERVICE_URL = 'not-a-url';
    process.env.CLOUD_TASKS_INVOKER_SA_EMAIL = 'a@b.iam.gserviceaccount.com';
    await expect(async () => await cloudTasksConfig()).rejects.toThrow(Error);
  });
});
