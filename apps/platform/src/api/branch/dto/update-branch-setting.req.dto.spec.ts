import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateBranchSettingReqDto } from './update-branch-setting.req.dto';

const failing = async (body: object) =>
  (await validate(plainToInstance(UpdateBranchSettingReqDto, body))).map(
    (e) => e.property,
  );

describe('UpdateBranchSettingReqDto', () => {
  it('accepts an empty body and every valid field', async () => {
    expect(await failing({})).toEqual([]);
    expect(
      await failing({
        invoicePrefix: 'q3-',
        invoiceTemplateCode: 'receipt_58mm',
        defaultTaxRate: 8.5,
        allowedPaymentMethods: ['cash', 'e_wallet'],
      }),
    ).toEqual([]);
  });

  it('upper-cases the prefix', () => {
    expect(
      plainToInstance(UpdateBranchSettingReqDto, { invoicePrefix: ' q3 ' })
        .invoicePrefix,
    ).toBe('Q3');
  });

  it('accepts null only for the template code', async () => {
    expect(await failing({ invoiceTemplateCode: null })).toEqual([]);
    expect(await failing({ invoicePrefix: null })).toContain('invoicePrefix');
    expect(await failing({ defaultTaxRate: null })).toContain('defaultTaxRate');
    expect(await failing({ allowedPaymentMethods: null })).toContain(
      'allowedPaymentMethods',
    );
  });

  it.each([
    [
      'an unknown template',
      { invoiceTemplateCode: 'a4' },
      'invoiceTemplateCode',
    ],
    ['a tax rate above 100', { defaultTaxRate: 101 }, 'defaultTaxRate'],
    ['a negative tax rate', { defaultTaxRate: -1 }, 'defaultTaxRate'],
    ['a bad prefix', { invoicePrefix: 'a b' }, 'invoicePrefix'],
    [
      'no payment method',
      { allowedPaymentMethods: [] },
      'allowedPaymentMethods',
    ],
    [
      'an unknown payment method',
      { allowedPaymentMethods: ['bitcoin'] },
      'allowedPaymentMethods',
    ],
    [
      'a repeated payment method',
      { allowedPaymentMethods: ['cash', 'cash'] },
      'allowedPaymentMethods',
    ],
  ])('rejects %s', async (_label, body, property) => {
    expect(await failing(body)).toContain(property);
  });
});
