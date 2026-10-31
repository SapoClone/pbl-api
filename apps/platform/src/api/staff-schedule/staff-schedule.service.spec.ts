import { ErrorCode } from '@/constants/error-code.constant';
import { NotFoundException } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { StaffScheduleEntity } from './entities/staff-schedule.entity';
import { StaffScheduleService } from './staff-schedule.service';

const shift = (overrides: Partial<StaffScheduleEntity> = {}) =>
  new StaffScheduleEntity({
    id: 's1' as StaffScheduleEntity['id'],
    tenantId: 't1',
    accountId: 'a1',
    branchId: 'b1',
    weekday: 1,
    startTime: '08:00:00',
    endTime: '16:00:00',
    ...overrides,
  });

describe('StaffScheduleService', () => {
  let schedules: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    transaction: jest.Mock;
  };
  let branches: { exists: jest.Mock; find: jest.Mock };
  let members: { exists: jest.Mock };
  let accounts: { find: jest.Mock };
  let service: StaffScheduleService;
  const errorCodeOf = (promise: Promise<unknown>) =>
    promise.catch((e) => e.getResponse().errorCode);
  const inTenant = <T>(work: () => Promise<T>) => TenantContext.run('t1', work);

  beforeEach(() => {
    schedules = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      save: jest.fn(async (rows) => rows),
      delete: jest.fn().mockResolvedValue(undefined),
      transaction: jest.fn((work) => work(schedules)),
    };
    branches = {
      exists: jest.fn().mockResolvedValue(true),
      find: jest.fn().mockResolvedValue([{ id: 'b1', name: 'Quận 3' }]),
    };
    members = { exists: jest.fn().mockResolvedValue(true) };
    accounts = {
      find: jest.fn().mockResolvedValue([{ id: 'a1', name: 'Trần Bảo Linh' }]),
    };
    const dataSource = {
      getRepository: jest.fn((entity: { name: string }) =>
        entity.name === 'AccountTenantEntity' ? members : accounts,
      ),
    };
    service = new StaffScheduleService(
      schedules as never,
      branches as never,
      dataSource as never,
    );
  });

  describe('create', () => {
    const dto = {
      accountId: 'a1',
      branchId: 'b1',
      weekdays: [3, 1, 3, 2],
      startTime: '08:00',
      endTime: '16:00',
    };

    it('creates one row per distinct weekday, in order, and names the staff and branch', async () => {
      const rows = await inTenant(() => service.create('owner-1', dto));

      const saved: StaffScheduleEntity[] = schedules.save.mock.calls[0][0];
      expect(saved.map((r) => r.weekday)).toEqual([1, 2, 3]);
      expect(saved[0]).toMatchObject({
        accountId: 'a1',
        branchId: 'b1',
        startTime: '08:00',
        endTime: '16:00',
        createdBy: 'owner-1',
      });
      expect(rows[0]).toMatchObject({
        staffName: 'Trần Bảo Linh',
        branchName: 'Quận 3',
        weekday: 1,
        startTime: '08:00',
        endTime: '16:00',
      });
    });

    it('refuses a member who is not in the store (404), so another store’s staff cannot be scheduled', async () => {
      members.exists.mockResolvedValue(false);

      await expect(inTenant(() => service.create('o', dto))).rejects.toThrow(
        NotFoundException,
      );
      expect(members.exists.mock.calls[0][0].where).toEqual({
        accountId: 'a1',
        tenantId: 't1',
      });
      expect(schedules.save).not.toHaveBeenCalled();
    });

    it('refuses a branch outside the store with T023', async () => {
      branches.exists.mockResolvedValue(false);

      await expect(
        errorCodeOf(inTenant(() => service.create('o', dto))),
      ).resolves.toBe(ErrorCode.T023);
      expect(schedules.save).not.toHaveBeenCalled();
    });

    it.each([
      ['overlaps', '15:00', '20:00'],
      ['is inside', '09:00', '10:00'],
      ['contains', '07:00', '17:00'],
    ])(
      'rejects a shift that %s an existing one with S001',
      async (_n, start, end) => {
        schedules.find.mockResolvedValue([shift({ weekday: 2 })]);

        await expect(
          errorCodeOf(
            inTenant(() =>
              service.create('o', { ...dto, startTime: start, endTime: end }),
            ),
          ),
        ).resolves.toBe(ErrorCode.S001);
        expect(schedules.save).not.toHaveBeenCalled();
      },
    );

    it('allows a shift that only touches an existing one', async () => {
      schedules.find.mockResolvedValue([shift({ weekday: 2 })]);

      await expect(
        inTenant(() =>
          service.create('o', { ...dto, startTime: '16:00', endTime: '22:00' }),
        ),
      ).resolves.toHaveLength(3);
    });

    it('rejects an end that is not after the start', async () => {
      await expect(
        errorCodeOf(
          inTenant(() =>
            service.create('o', {
              ...dto,
              startTime: '16:00',
              endTime: '16:00',
            }),
          ),
        ),
      ).resolves.toBe(ErrorCode.V000);
    });
  });

  describe('update and remove', () => {
    it('changes the times, ignoring the shift itself when checking overlap', async () => {
      schedules.findOne.mockResolvedValue(shift());
      schedules.find.mockResolvedValue([shift()]);

      const res = await inTenant(() =>
        service.update('o', 's1', { startTime: '09:00' }),
      );

      expect(res).toMatchObject({ startTime: '09:00', endTime: '16:00' });
    });

    it('rejects a change that overlaps another shift of the person with S001', async () => {
      schedules.findOne.mockResolvedValue(shift());
      schedules.find.mockResolvedValue([
        shift(),
        shift({
          id: 's2' as StaffScheduleEntity['id'],
          startTime: '18:00:00',
          endTime: '22:00:00',
        }),
      ]);

      await expect(
        errorCodeOf(
          inTenant(() => service.update('o', 's1', { endTime: '19:00' })),
        ),
      ).resolves.toBe(ErrorCode.S001);
    });

    it('answers 404 for a shift of another store (the scoped repository finds nothing)', async () => {
      schedules.findOne.mockResolvedValue(null);

      await expect(
        inTenant(() => service.update('o', 's9', {})),
      ).rejects.toThrow(NotFoundException);
      await expect(inTenant(() => service.remove('s9'))).rejects.toThrow(
        NotFoundException,
      );
      expect(schedules.delete).not.toHaveBeenCalled();
    });

    it('deletes a shift', async () => {
      schedules.findOne.mockResolvedValue(shift());

      await inTenant(() => service.remove('s1'));

      expect(schedules.delete).toHaveBeenCalledWith({ id: 's1' });
    });
  });

  describe('list and today', () => {
    it('filters by branch, member and weekday only when given', async () => {
      await inTenant(() => service.list({}));
      await inTenant(() =>
        service.list({ branchId: 'b1', accountId: 'a1', weekday: 2 }),
      );

      expect(schedules.find.mock.calls[0][0].where).toEqual({});
      expect(schedules.find.mock.calls[1][0].where).toEqual({
        branchId: 'b1',
        accountId: 'a1',
        weekday: 2,
      });
    });

    it('groups today’s shifts per member and flags the one running now', async () => {
      // Monday 2026-10-26, 10:00 in Ho Chi Minh
      schedules.find.mockResolvedValue([
        shift({ startTime: '08:00:00', endTime: '12:00:00' }),
        shift({
          id: 's2' as StaffScheduleEntity['id'],
          startTime: '13:00:00',
          endTime: '17:00:00',
        }),
        shift({
          id: 's3' as StaffScheduleEntity['id'],
          accountId: 'a2',
          startTime: '10:30:00',
          endTime: '18:00:00',
        }),
      ]);

      const today = await inTenant(() =>
        service.today(new Date('2026-10-26T03:00:00Z')),
      );

      expect(schedules.find.mock.calls[0][0].where).toEqual({ weekday: 1 });
      expect(today.get('a1')).toEqual([
        { branchId: 'b1', label: '08:00–12:00', isOnShift: true },
        { branchId: 'b1', label: '13:00–17:00', isOnShift: false },
      ]);
      expect(today.get('a2')?.[0].isOnShift).toBe(false);
    });
  });
});
