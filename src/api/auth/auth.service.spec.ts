import { QueueService } from '@/queue/queue.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { AuthService } from './auth.service';
import { RegisterReqDto } from './dto/register.req.dto';

describe('AuthService', () => {
  let service: AuthService;
  let configServiceValue: Partial<Record<keyof ConfigService, jest.Mock>>;
  let jwtServiceValue: Partial<Record<keyof JwtService, jest.Mock>>;
  let userRepositoryValue: Partial<
    Record<keyof Repository<UserEntity>, jest.Mock>
  >;
  let queueServiceValue: Partial<Record<keyof QueueService, jest.Mock>>;
  let cacheManagerValue: { set: jest.Mock };

  beforeAll(async () => {
    configServiceValue = {
      get: jest.fn(),
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          'auth.confirmEmailExpires': '1d',
          'auth.confirmEmailSecret': 'secret_for_confirm_email',
        };
        return values[key];
      }),
    };

    jwtServiceValue = {
      sign: jest.fn(),
      verify: jest.fn(),
      signAsync: jest.fn(),
    };

    userRepositoryValue = {
      findOne: jest.fn(),
    };

    queueServiceValue = {
      enqueueEmailVerification: jest.fn(),
    };

    cacheManagerValue = {
      set: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: ConfigService,
          useValue: configServiceValue,
        },
        {
          provide: JwtService,
          useValue: jwtServiceValue,
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: userRepositoryValue,
        },
        {
          provide: QueueService,
          useValue: queueServiceValue,
        },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManagerValue,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should enqueue an email-verification Cloud Task with the registered email and generated token', async () => {
      const dto: RegisterReqDto = {
        email: 'newuser@example.com',
        password: 'Password123!',
      };
      const verificationToken = 'signed.jwt.token';

      jest.spyOn(UserEntity, 'exists').mockResolvedValue(false);
      jest
        .spyOn(UserEntity.prototype, 'save')
        .mockImplementation(async function (this: UserEntity) {
          this.id = 'user-id-1' as UserEntity['id'];
          return this;
        });
      (jwtServiceValue.signAsync as jest.Mock).mockResolvedValue(
        verificationToken,
      );

      const result = await service.register(dto);

      expect(UserEntity.exists).toHaveBeenCalledWith({
        where: { email: dto.email },
      });
      expect(UserEntity.prototype.save).toHaveBeenCalled();
      expect(cacheManagerValue.set).toHaveBeenCalledWith(
        expect.any(String),
        verificationToken,
        expect.any(Number),
      );
      expect(queueServiceValue.enqueueEmailVerification).toHaveBeenCalledWith(
        dto.email,
        verificationToken,
      );
      expect(result.userId).toBe('user-id-1');

      (UserEntity.exists as jest.Mock).mockRestore();
      (UserEntity.prototype.save as jest.Mock).mockRestore();
    });
  });
});
