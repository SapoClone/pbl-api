import {
  DateFieldOptional,
  EnumFieldOptional,
  NumberFieldOptional,
  UUIDFieldOptional,
} from '@/decorators/field.decorators';
import { StaffDuty } from '../staff-duty';

export class ListStaffScheduleReqDto {
  @UUIDFieldOptional()
  branchId?: string;

  @UUIDFieldOptional()
  accountId?: string;

  /** ISO weekday: 1 = Monday ... 7 = Sunday */
  @NumberFieldOptional({ int: true, min: 1, max: 7 })
  weekday?: number;

  @EnumFieldOptional(() => StaffDuty)
  duty?: StaffDuty;
}

/** `at` is an ISO 8601 moment; the shifts running then are answered. Now when left out. */
export class OnDutyReqDto {
  @UUIDFieldOptional()
  branchId?: string;

  @DateFieldOptional()
  at?: Date;
}
