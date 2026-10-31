import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { verifyPassword } from '@/utils/password.util';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionResDto } from '../auth/dto/session.res.dto';
import { SessionService } from '../auth/session.service';
import { AccountResDto } from './dto/account.res.dto';
import { ChangePasswordReqDto } from './dto/change-password.req.dto';
import { UpdateAccountReqDto } from './dto/update-account.req.dto';
import { AccountEntity } from './entities/account.entity';

@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(AccountEntity)
    private readonly repository: Repository<AccountEntity>,
    private readonly sessions: SessionService,
  ) {}

  async getMe(accountId: string): Promise<AccountResDto> {
    const account = await this.repository.findOneByOrFail({
      id: accountId as AccountEntity['id'],
    });
    return account.toDto(AccountResDto);
  }

  async updateMe(
    accountId: string,
    dto: UpdateAccountReqDto,
  ): Promise<AccountResDto> {
    const account = await this.repository.findOneByOrFail({
      id: accountId as AccountEntity['id'],
    });
    if (dto.name !== undefined) account.name = dto.name;
    if (dto.phone !== undefined) account.phone = dto.phone; // null clears it
    account.updatedBy = accountId;
    const saved = await this.repository.save(account);
    return saved.toDto(AccountResDto);
  }

  /**
   * Verifies the current password, sets the new one and ends every other
   * session of the account (the caller stays signed in).
   */
  async changePassword(
    accountId: string,
    currentSessionId: string,
    dto: ChangePasswordReqDto,
  ): Promise<void> {
    const account = await this.repository.findOneOrFail({
      where: { id: accountId as AccountEntity['id'] },
      select: ['id', 'password'],
    });
    if (!(await verifyPassword(dto.currentPassword, account.password))) {
      throw new ValidationException(ErrorCode.E015);
    }
    // hashed by the entity's BeforeUpdate hook
    account.password = dto.newPassword;
    account.updatedBy = accountId;
    await this.repository.save(account);
    await this.sessions.revokeAll(accountId, {
      exceptSessionId: currentSessionId,
    });
  }

  listSessions(
    accountId: string,
    currentSessionId: string,
  ): Promise<SessionResDto[]> {
    return this.sessions.list(accountId, currentSessionId);
  }

  revokeSession(accountId: string, sessionId: string): Promise<void> {
    return this.sessions.revokeOne(accountId, sessionId);
  }
}
