import { ErrorCode } from '@/constants/error-code.constant';
import { NotFoundException } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { QueryFailedError } from 'typeorm';
import { BranchSettingService } from './branch-setting.service';
import {
  BRANCH_SETTING_DEFAULTS,
  BranchSettingEntity,
  InvoiceTemplateCode,
  PaymentMethod,
} from './entities/branch-setting.entity';

describe('BranchSettingService', () => {
  let branches: { exists: jest.Mock };
  let settings: {
    findOne: jest.Mock;
    save: jest.Mock;
    transaction: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let prefixQuery: Record<string, jest.Mock>;
  let em: { query: jest.Mock };
  let service: BranchSettingService;

  beforeEach(() => {
    branches = { exists: jest.fn().mockResolvedValue(true) };
    prefixQuery = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(false),
    };
    em = { query: jest.fn().mockResolvedValue([]) };
    settings = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (row) => row),
      transaction: jest.fn((work) => work(settings, em)),
      createQueryBuilder: jest.fn(() => prefixQuery),
    };
    service = new BranchSettingService(branches as never, settings as never);
  });

  it('creates the row with the defaults on first read', async () => {
    const res = await service.get('a1', 'b1');

    expect(settings.save.mock.calls[0][0]).toBeInstanceOf(BranchSettingEntity);
    expect(res).toEqual({
      branchId: 'b1',
      invoicePrefix: 'HD',
      invoiceTemplateCode: null,
      defaultTaxRate: 0,
      allowedPaymentMethods: ['cash', 'transfer', 'card'],
    });
    expect(BRANCH_SETTING_DEFAULTS.allowedPaymentMethods).toHaveLength(3);
  });

  it('returns the existing row without creating another', async () => {
    settings.findOne.mockResolvedValue(
      new BranchSettingEntity({
        branchId: 'b1',
        invoicePrefix: 'Q3',
        invoiceTemplateCode: InvoiceTemplateCode.RECEIPT_80MM,
        defaultTaxRate: 8,
        allowedPaymentMethods: [PaymentMethod.CASH],
      }),
    );

    const res = await service.get('a1', 'b1');

    expect(settings.save).not.toHaveBeenCalled();
    expect(res).toMatchObject({ invoicePrefix: 'Q3', defaultTaxRate: 8 });
  });

  it('answers 404 for a branch outside the store (or a deleted one)', async () => {
    branches.exists.mockResolvedValue(false);

    await expect(service.get('a1', 'b9')).rejects.toThrow(NotFoundException);
    await expect(service.update('a1', 'b9', {})).rejects.toThrow(
      NotFoundException,
    );
    expect(settings.save).not.toHaveBeenCalled();
  });

  it('patches only the given fields and clears the template with null', async () => {
    settings.findOne.mockResolvedValue(
      new BranchSettingEntity({
        branchId: 'b1',
        invoicePrefix: 'HD',
        invoiceTemplateCode: InvoiceTemplateCode.RECEIPT_58MM,
        defaultTaxRate: 0,
        allowedPaymentMethods: [PaymentMethod.CASH],
      }),
    );

    const res = await service.update('a1', 'b1', {
      invoiceTemplateCode: null,
      defaultTaxRate: 10,
      invoicePrefix: undefined,
    });

    expect(res).toMatchObject({
      invoicePrefix: 'HD',
      invoiceTemplateCode: null,
      defaultTaxRate: 10,
      allowedPaymentMethods: ['cash'],
    });
    expect(settings.save.mock.calls[0][0].updatedBy).toBe('a1');
  });

  it('re-reads the row when two first reads race on the unique branch_id', async () => {
    const winner = new BranchSettingEntity({
      branchId: 'b1',
      invoicePrefix: 'HD',
    });
    settings.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    settings.save.mockRejectedValue(
      new QueryFailedError(
        'q',
        [],
        Object.assign(new Error('dup'), {
          code: '23505',
          constraint: 'UQ_branch_setting_branch_id',
        }),
      ),
    );

    await expect(service.get('a1', 'b1')).resolves.toMatchObject({
      branchId: 'b1',
    });
  });

  describe('invoice prefix (D12)', () => {
    const existing = () =>
      new BranchSettingEntity({
        branchId: 'b1',
        invoicePrefix: 'HD',
        defaultTaxRate: 0,
        allowedPaymentMethods: [PaymentMethod.CASH],
      });
    const update = (dto: { invoicePrefix?: string }) =>
      TenantContext.run('t1', () => service.update('a1', 'b1', dto));

    it('refuses a prefix another branch of the store already uses with B006 (409)', async () => {
      settings.findOne.mockResolvedValue(existing());
      prefixQuery.getExists.mockResolvedValue(true);

      const error = await update({ invoicePrefix: 'Q3' }).catch((e) => e);

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse().errorCode).toBe(ErrorCode.B006);
      expect(settings.save).not.toHaveBeenCalled();
      expect(prefixQuery.where).toHaveBeenCalledWith(
        'UPPER(setting.invoicePrefix) = UPPER(:prefix)',
        { prefix: 'Q3' },
      );
      expect(prefixQuery.andWhere).toHaveBeenCalledWith(
        'setting.branchId <> :branchId',
        { branchId: 'b1' },
      );
    });

    it('saves a free prefix, after taking the store-wide advisory lock', async () => {
      settings.findOne.mockResolvedValue(existing());

      const res = await update({ invoicePrefix: 'Q3' });

      expect(res.invoicePrefix).toBe('Q3');
      expect(em.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        ['invoice-prefix:t1'],
      );
    });

    it('checks nothing when the prefix is not part of the patch', async () => {
      settings.findOne.mockResolvedValue(existing());

      await service.update('a1', 'b1', { defaultTaxRate: 5 });

      expect(settings.transaction).not.toHaveBeenCalled();
    });
  });
});
