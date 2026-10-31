import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddMemberReqDto } from './add-member.req.dto';
import { UpdateMemberReqDto } from './update-member.req.dto';

const ID = '55555555-5555-4555-8555-555555555555';
const failing = async (cls: new () => object, body: object) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('member request DTOs', () => {
  describe('UpdateMemberReqDto', () => {
    it('accepts an empty body, a role id, a legacy role and branch ids', async () => {
      for (const body of [
        {},
        { roleId: ID },
        { role: 'cashier' },
        { role: 'manager', branchIds: [ID] },
        { branchIds: [] },
      ]) {
        expect(await failing(UpdateMemberReqDto, body)).toEqual([]);
      }
    });

    it.each([
      ['null role id', { roleId: null }, 'roleId'],
      ['non-UUID role id', { roleId: 'x' }, 'roleId'],
      ['owner role name', { role: 'owner' }, 'role'],
      ['null branches', { branchIds: null }, 'branchIds'],
      ['non-UUID branch id', { branchIds: ['x'] }, 'branchIds'],
      ['duplicate branch ids', { branchIds: [ID, ID] }, 'branchIds'],
      ['branches as a string', { branchIds: ID }, 'branchIds'],
    ])('rejects %s', async (_what, body, field) => {
      expect(await failing(UpdateMemberReqDto, body)).toContain(field);
    });
  });

  describe('AddMemberReqDto', () => {
    it('lower-cases the email and accepts roleId or the legacy and seeded role names', async () => {
      const dto = plainToInstance(AddMemberReqDto, {
        email: ' A@X.vn ',
        role: 'warehouse_staff',
      });
      expect(dto.email).toBe('a@x.vn');
      for (const body of [
        { email: 'a@x.vn', roleId: ID },
        { email: 'a@x.vn', role: 'cashier' },
        { email: 'a@x.vn', role: 'accountant', branchIds: [ID] },
      ]) {
        expect(await failing(AddMemberReqDto, body)).toEqual([]);
      }
    });

    it('rejects a bad email, the owner role and a role name outside the seeded set', async () => {
      expect(await failing(AddMemberReqDto, { email: 'nope' })).toContain(
        'email',
      );
      expect(
        await failing(AddMemberReqDto, { email: 'a@x.vn', role: 'owner' }),
      ).toContain('role');
      expect(
        await failing(AddMemberReqDto, { email: 'a@x.vn', role: 'janitor' }),
      ).toContain('role');
    });
  });
});
