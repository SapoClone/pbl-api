import { NotFoundException } from '@nestjs/common';
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
  let settings: { findOne: jest.Mock; save: jest.Mock };
  let service: BranchSettingService;

  beforeEach(() => {
    branches = { exists: jest.fn().mockResolvedValue(true) };
    settings = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (row) => row),
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
});
