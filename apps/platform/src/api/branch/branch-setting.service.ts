import { ErrorCode } from '@/constants/error-code.constant';
import { ConflictCodeException } from '@/exceptions/coded.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantContext,
  TenantScopedRepository,
} from '@pbl/common';
import { plainToInstance } from 'class-transformer';
import { BranchSettingResDto } from './dto/branch-setting.res.dto';
import { UpdateBranchSettingReqDto } from './dto/update-branch-setting.req.dto';
import {
  BRANCH_SETTING_DEFAULTS,
  BranchSettingEntity,
} from './entities/branch-setting.entity';
import { BranchEntity } from './entities/branch.entity';

/**
 * Per-branch invoice and payment settings. The row is created with the
 * defaults the first time it is read, so a branch always has settings.
 */
@Injectable()
export class BranchSettingService {
  constructor(
    @InjectTenantScopedRepository(BranchEntity)
    private readonly branches: TenantScopedRepository<BranchEntity>,
    @InjectTenantScopedRepository(BranchSettingEntity)
    private readonly settings: TenantScopedRepository<BranchSettingEntity>,
  ) {}

  async get(accountId: string, branchId: string): Promise<BranchSettingResDto> {
    return this.present(await this.findOrCreate(accountId, branchId));
  }

  async update(
    accountId: string,
    branchId: string,
    dto: UpdateBranchSettingReqDto,
  ): Promise<BranchSettingResDto> {
    const setting = await this.findOrCreate(accountId, branchId);
    Object.assign(
      setting,
      Object.fromEntries(
        Object.entries(dto).filter(([, value]) => value !== undefined),
      ),
    );
    setting.updatedBy = accountId;
    if (dto.invoicePrefix === undefined) {
      return this.present(await this.settings.save(setting));
    }
    // D12: an invoice prefix belongs to one branch of the store. The advisory
    // lock makes two branches claiming the same prefix queue up.
    return this.settings.transaction(async (settings, em) => {
      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `invoice-prefix:${TenantContext.require()}`,
      ]);
      const taken = await settings
        .createQueryBuilder('setting')
        .where('UPPER(setting.invoicePrefix) = UPPER(:prefix)', {
          prefix: dto.invoicePrefix,
        })
        .andWhere('setting.branchId <> :branchId', { branchId })
        .getExists();
      if (taken) {
        throw new ConflictCodeException(ErrorCode.B006);
      }
      return this.present(await settings.save(setting));
    });
  }

  private async findOrCreate(
    accountId: string,
    branchId: string,
  ): Promise<BranchSettingEntity> {
    // a branch of another store (or a deleted one) is a 404
    if (!(await this.branches.exists({ where: { id: branchId as never } }))) {
      throw new NotFoundException();
    }
    const existing = await this.settings.findOne({ where: { branchId } });
    if (existing) {
      return existing;
    }
    try {
      return await this.settings.save(
        new BranchSettingEntity({
          branchId,
          invoicePrefix: BRANCH_SETTING_DEFAULTS.invoicePrefix,
          invoiceTemplateCode: BRANCH_SETTING_DEFAULTS.invoiceTemplateCode,
          defaultTaxRate: BRANCH_SETTING_DEFAULTS.defaultTaxRate,
          allowedPaymentMethods: [
            ...BRANCH_SETTING_DEFAULTS.allowedPaymentMethods,
          ],
          createdBy: accountId,
          updatedBy: accountId,
        }),
      );
    } catch (error) {
      // two first reads raced; the unique index on branch_id decided
      if (isUniqueViolation(error, 'UQ_branch_setting_branch_id')) {
        return (await this.settings.findOne({ where: { branchId } }))!;
      }
      throw error;
    }
  }

  private present(setting: BranchSettingEntity): BranchSettingResDto {
    return plainToInstance(BranchSettingResDto, setting);
  }
}
