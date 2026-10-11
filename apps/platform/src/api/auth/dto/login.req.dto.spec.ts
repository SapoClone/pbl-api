import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginReqDto } from './login.req.dto';

const base = { email: 'a@example.com', password: 'Passw0rd!x' };

describe('LoginReqDto', () => {
  it('accepts tenantId: null, as echoed from a login response', async () => {
    const dto = plainToInstance(LoginReqDto, { ...base, tenantId: null });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a tenantId that is not a UUID', async () => {
    const errors = await validate(
      plainToInstance(LoginReqDto, { ...base, tenantId: 'nope' }),
    );

    expect(errors.map((e) => e.property)).toContain('tenantId');
  });
});
