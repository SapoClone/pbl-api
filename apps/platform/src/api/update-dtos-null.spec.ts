import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAccountReqDto } from './account/dto/update-account.req.dto';
import { UpdateBranchReqDto } from './branch/dto/update-branch.req.dto';
import { UpdateRoleReqDto } from './role/dto/update-role.req.dto';
import { UpdateTenantReqDto } from './tenant/dto/update-tenant.req.dto';

const failing = async (cls: new () => object, body: object) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('PATCH bodies and null', () => {
  describe.each([
    ['UpdateAccountReqDto', UpdateAccountReqDto, ['name'], ['phone']],
    [
      'UpdateTenantReqDto',
      UpdateTenantReqDto,
      ['name'],
      ['phone', 'email', 'address'],
    ],
    [
      'UpdateBranchReqDto',
      UpdateBranchReqDto,
      ['name', 'code', 'isWarehouse', 'status'],
      ['phone', 'address'],
    ],
    [
      'UpdateRoleReqDto',
      UpdateRoleReqDto,
      ['name', 'permissions'],
      ['description'],
    ],
  ] as const)('%s', (_n, cls, required, nullable) => {
    it.each(required)('rejects null for %s', async (field) => {
      expect(await failing(cls, { [field]: null })).toContain(field);
    });

    it.each(nullable)('accepts null for %s', async (field) => {
      expect(await failing(cls, { [field]: null })).toHaveLength(0);
    });

    it('accepts an empty body', async () => {
      expect(await failing(cls, {})).toHaveLength(0);
    });
  });
});
