import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authServiceValue: Partial<Record<keyof AuthService, jest.Mock>>;

  beforeAll(async () => {
    authServiceValue = {
      signIn: jest.fn(),
      register: jest.fn(),
      logout: jest.fn(),
      logoutAll: jest.fn(),
      refreshToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authServiceValue,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the caller to logout-all and the client to sign-in', async () => {
    const user = { id: 'u1', sessionId: 's1', subjectType: 'account', exp: 1 };
    const client = { userAgent: 'UA', ip: '1.1.1.1' };
    const dto = { email: 'a@b.vn', password: 'secret1' };

    await controller.logoutAll(user as never);
    await controller.signIn(dto, client);

    expect(authServiceValue.logoutAll).toHaveBeenCalledWith(user);
    expect(authServiceValue.signIn).toHaveBeenCalledWith(dto, client);
  });
});
