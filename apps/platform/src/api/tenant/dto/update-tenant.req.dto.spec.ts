import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTenantReqDto } from './update-tenant.req.dto';

describe('UpdateTenantReqDto', () => {
  it('keeps email: null so the email can be cleared', async () => {
    const dto = plainToInstance(UpdateTenantReqDto, { email: null });

    expect(dto.email).toBeNull();
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('lowercases a given email', () => {
    expect(
      plainToInstance(UpdateTenantReqDto, { email: 'A@Example.com' }).email,
    ).toBe('a@example.com');
  });
});
