import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authServiceValue: Partial<Record<keyof AuthService, jest.Mock>>;

  let resetValue: { requestReset: jest.Mock; resetPassword: jest.Mock };

  beforeAll(async () => {
    resetValue = { requestReset: jest.fn(), resetPassword: jest.fn() };
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
        { provide: PasswordResetService, useValue: resetValue },
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

  it('forgot-password answers the same JSON body for any email', async () => {
    const a = await controller.forgotPassword({ email: 'known@b.vn' });
    const b = await controller.forgotPassword({ email: 'unknown@b.vn' });

    expect(resetValue.requestReset).toHaveBeenCalledWith('known@b.vn');
    expect(resetValue.requestReset).toHaveBeenCalledWith('unknown@b.vn');
    expect(a).toEqual(b);
    expect(typeof a.message).toBe('string');
  });

  it('reset-password passes token and password and answers a message', async () => {
    const res = await controller.resetPassword({
      token: 'tok',
      password: 'Passw0rd!x',
    });

    expect(resetValue.resetPassword).toHaveBeenCalledWith('tok', 'Passw0rd!x');
    expect(typeof res.message).toBe('string');
  });

  it('reset-password lets the A-code error of an invalid token through', async () => {
    resetValue.resetPassword.mockRejectedValueOnce(new Error('E014'));

    await expect(
      controller.resetPassword({ token: 'bad', password: 'Passw0rd!x' }),
    ).rejects.toThrow('E014');
  });
});
