import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStaffScheduleReqDto } from './create-staff-schedule.req.dto';
import { UpdateStaffScheduleReqDto } from './update-staff-schedule.req.dto';

const ID = '6f1c1c4e-2a8b-4a43-9f0e-1d2c3b4a5e6f';
const failing = async (cls: new () => object, body: object) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('staff schedule DTOs', () => {
  const valid = {
    accountId: ID,
    branchId: ID,
    weekdays: [1, 2, 3],
    startTime: '08:00',
    endTime: '16:00',
  };

  it('accepts a valid create body', async () => {
    expect(await failing(CreateStaffScheduleReqDto, valid)).toEqual([]);
  });

  it.each([
    ['no weekday', { weekdays: [] }, 'weekdays'],
    ['weekday 0', { weekdays: [0] }, 'weekdays'],
    ['weekday 8', { weekdays: [8] }, 'weekdays'],
    ['a non-array weekdays', { weekdays: 1 }, 'weekdays'],
    ['a bad time', { startTime: '8:00' }, 'startTime'],
    ['an hour of 24', { endTime: '24:00' }, 'endTime'],
    ['a bad member id', { accountId: 'x' }, 'accountId'],
  ])('rejects %s', async (_label, patch, property) => {
    expect(
      await failing(CreateStaffScheduleReqDto, { ...valid, ...patch }),
    ).toContain(property);
  });

  it('patches either time, rejects null and bad times', async () => {
    expect(await failing(UpdateStaffScheduleReqDto, {})).toEqual([]);
    expect(
      await failing(UpdateStaffScheduleReqDto, { startTime: '14:00' }),
    ).toEqual([]);
    expect(
      await failing(UpdateStaffScheduleReqDto, { startTime: null }),
    ).toContain('startTime');
    expect(
      await failing(UpdateStaffScheduleReqDto, { endTime: '25:00' }),
    ).toContain('endTime');
  });
});
