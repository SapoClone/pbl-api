import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateBranchReqDto } from './update-branch.req.dto';

describe('UpdateBranchReqDto', () => {
  it.each(['name', 'code', 'isWarehouse', 'status'])(
    'rejects %s: null',
    async (field) => {
      const errors = await validate(
        plainToInstance(UpdateBranchReqDto, { [field]: null }),
      );

      expect(errors.map((e) => e.property)).toContain(field);
    },
  );

  it('accepts address: null and phone: null', async () => {
    const dto = plainToInstance(UpdateBranchReqDto, {
      address: null,
      phone: null,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
