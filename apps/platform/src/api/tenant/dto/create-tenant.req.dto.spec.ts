import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTenantReqDto } from './create-tenant.req.dto';

const build = (subdomain: unknown) =>
  plainToInstance(CreateTenantReqDto, { name: 'My Shop', subdomain });

describe('CreateTenantReqDto', () => {
  it('trims and lowercases the subdomain', async () => {
    const dto = build('  My-Shop ');

    expect(dto.subdomain).toBe('my-shop');
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    'ab',
    'a'.repeat(31),
    '-shop',
    'shop-',
    'my_shop',
    'my shop',
    'cửa-hàng',
  ])('rejects the invalid subdomain %p', async (subdomain) => {
    const errors = await validate(build(subdomain));
    expect(errors.map((e) => e.property)).toContain('subdomain');
  });

  it.each([
    'www',
    'api',
    'admin',
    'app',
    'static',
    'platform',
    'catalog',
    'commerce',
    'finance',
    'insight',
    'integration',
  ])('rejects the reserved subdomain %p', async (subdomain) => {
    const errors = await validate(build(subdomain));
    expect(errors.map((e) => e.property)).toContain('subdomain');
  });
});
