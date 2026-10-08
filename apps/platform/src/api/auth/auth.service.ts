import { Branded } from '@/common/types/types';
import { AllConfigType } from '@/config/config.type';
import { SYSTEM_USER_ID } from '@/constants/app.constant';
import { CacheKey } from '@/constants/cache.constant';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { QueueService } from '@/queue/queue.service';
import { createCacheKey } from '@/utils/cache.util';
import { verifyPassword } from '@/utils/password.util';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { AuthUser } from '@pbl/auth';
import { Cache } from 'cache-manager';
import { plainToInstance } from 'class-transformer';
import ms from 'ms';
import { Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { AccessTokenService } from './access-token.service';
import { LoginReqDto } from './dto/login.req.dto';
import { LoginResDto } from './dto/login.res.dto';
import { RefreshReqDto } from './dto/refresh.req.dto';
import { RefreshResDto } from './dto/refresh.res.dto';
import { RegisterReqDto } from './dto/register.req.dto';
import { RegisterResDto } from './dto/register.res.dto';
import {
  RefreshTokenReuseError,
  RefreshTokenService,
} from './refresh-token.service';

type Token = Branded<
  {
    accessToken: string;
    refreshToken: string;
    tokenExpires: number;
  },
  'token'
>;

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService<AllConfigType>,
    private readonly jwtService: JwtService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly queueService: QueueService,
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshTokenService: RefreshTokenService,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Sign in user
   * @param dto LoginReqDto
   * @returns LoginResDto
   */
  async signIn(dto: LoginReqDto): Promise<LoginResDto> {
    const { email, password } = dto;
    const user = await this.userRepository.findOne({
      where: { email },
      select: ['id', 'email', 'password'],
    });

    const isPasswordValid =
      user && (await verifyPassword(password, user.password));

    if (!isPasswordValid) {
      throw new UnauthorizedException();
    }

    // One refresh-token family per login; its id is the access token's sid
    const { token: refreshToken, familyId } =
      await this.refreshTokenService.issue(user.id);
    const token = await this.createToken({
      id: user.id,
      sessionId: familyId,
      refreshToken,
    });

    return plainToInstance(LoginResDto, {
      userId: user.id,
      ...token,
    });
  }

  async register(dto: RegisterReqDto): Promise<RegisterResDto> {
    // Check if the user already exists
    const isExistUser = await UserEntity.exists({
      where: { email: dto.email },
    });

    if (isExistUser) {
      throw new ValidationException(ErrorCode.E003);
    }

    // Register user
    const user = new UserEntity({
      email: dto.email,
      password: dto.password,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await user.save();

    // Send email verification
    const token = await this.createVerificationToken({ id: user.id });
    const tokenExpiresIn = this.configService.getOrThrow(
      'auth.confirmEmailExpires',
      {
        infer: true,
      },
    );
    await this.cacheManager.set(
      createCacheKey(CacheKey.EMAIL_VERIFICATION, user.id),
      token,
      ms(tokenExpiresIn),
    );
    await this.queueService.enqueueEmailVerification(dto.email, token);

    return plainToInstance(RegisterResDto, {
      userId: user.id,
    });
  }

  async logout(userToken: AuthUser): Promise<void> {
    await this.revokeSession(
      userToken.sessionId,
      userToken.exp * 1000 - Date.now(),
    );
  }

  async refreshToken(dto: RefreshReqDto): Promise<RefreshResDto> {
    let rotated: Awaited<ReturnType<RefreshTokenService['rotate']>>;
    try {
      rotated = await this.refreshTokenService.rotate(dto.refreshToken);
    } catch (err) {
      if (err instanceof RefreshTokenReuseError) {
        // The family is already revoked; also kill its live access tokens
        const accessTokenLifetime: string = this.configService.getOrThrow(
          'auth.expires',
          { infer: true },
        );
        await this.revokeSession(err.familyId, ms(accessTokenLifetime));
      }
      throw err;
    }

    const user = await this.userRepository.findOne({
      where: { id: rotated.subjectId },
      select: ['id'],
    });
    if (!user) {
      await this.refreshTokenService.revokeFamily(rotated.familyId);
      throw new UnauthorizedException();
    }

    return await this.createToken({
      id: user.id,
      sessionId: rotated.familyId,
      refreshToken: rotated.token,
    });
  }

  /**
   * End a login: revoke its refresh tokens and deny its access tokens until
   * they expire (instant revocation, ADR-0004 §7).
   */
  private async revokeSession(sessionId: string, ttlMs: number): Promise<void> {
    if (ttlMs > 0) {
      await this.cacheManager.store.set<boolean>(
        createCacheKey(CacheKey.SESSION_BLACKLIST, sessionId),
        true,
        ttlMs,
      );
    }
    await this.refreshTokenService.revokeFamily(sessionId);
  }

  private async createVerificationToken(data: { id: string }): Promise<string> {
    return await this.jwtService.signAsync(
      {
        id: data.id,
      },
      {
        secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
          infer: true,
        }),
        expiresIn: this.configService.getOrThrow('auth.confirmEmailExpires', {
          infer: true,
        }),
      },
    );
  }

  private async createToken(data: {
    id: string;
    sessionId: string;
    refreshToken: string;
  }): Promise<Token> {
    const tokenExpiresIn = this.configService.getOrThrow('auth.expires', {
      infer: true,
    });
    const tokenExpires = Date.now() + ms(tokenExpiresIn);

    const accessToken = await this.accessTokenService.sign({
      userId: data.id,
      sessionId: data.sessionId,
    });
    return {
      accessToken,
      refreshToken: data.refreshToken,
      tokenExpires,
    } as Token;
  }
}
