import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBranchReqDto } from './create-branch.req.dto';

const build = (code: string) =>
  plainToInstance(CreateBranchReqDto, { name: 'Kho', code });

describe('CreateBranchReqDto code', () => {
  it('trims and uppercases the code, and accepts it', async () => {
    const dto = build(' kho-2 ');

    expect(dto.code).toBe('KHO-2');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    ['contains a space', 'KHO 2'],
    ['contains a dot', 'KHO.2'],
    ['is 21 characters long', 'A'.repeat(21)],
  ])('rejects a code that %s', async (_label, code) => {
    const errors = await validate(build(code));

    expect(errors.map((e) => e.property)).toContain('code');
  });
});
