import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CloudTasksService } from './cloud-tasks.service';

const createTaskMock = jest.fn();

jest.mock('@google-cloud/tasks', () => ({
  CloudTasksClient: jest.fn().mockImplementation(() => ({
    queuePath: (project: string, location: string, queue: string) =>
      `projects/${project}/locations/${location}/queues/${queue}`,
    createTask: createTaskMock,
  })),
}));

describe('CloudTasksService', () => {
  let service: CloudTasksService;

  beforeEach(async () => {
    createTaskMock.mockReset();
    createTaskMock.mockResolvedValue([{ name: 'task-1' }]);

    const configValues: Record<string, string> = {
      'cloudTasks.projectId': 'test-project',
      'cloudTasks.location': 'asia-southeast1',
      'cloudTasks.queueName': 'email-verification',
      'cloudTasks.mailServiceUrl': 'https://pbl-mail-service.example.run.app',
      'cloudTasks.invokerServiceAccountEmail':
        'pbl-tasks-invoker@test-project.iam.gserviceaccount.com',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudTasksService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: string) => configValues[key] },
        },
      ],
    }).compile();

    service = module.get<CloudTasksService>(CloudTasksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should enqueue a task targeting the mail service with an OIDC token', async () => {
    await service.enqueueEmailVerification('user@example.com', 'tok123');

    expect(createTaskMock).toHaveBeenCalledWith({
      parent:
        'projects/test-project/locations/asia-southeast1/queues/email-verification',
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url: 'https://pbl-mail-service.example.run.app/tasks/email-verification',
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(
            JSON.stringify({ email: 'user@example.com', token: 'tok123' }),
          ).toString('base64'),
          oidcToken: {
            serviceAccountEmail:
              'pbl-tasks-invoker@test-project.iam.gserviceaccount.com',
          },
        },
      },
    });
  });
});
