import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountResDto } from './dto/account.res.dto';
import { UpdateAccountReqDto } from './dto/update-account.req.dto';
import { AccountEntity } from './entities/account.entity';

@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(AccountEntity)
    private readonly repository: Repository<AccountEntity>,
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
}
