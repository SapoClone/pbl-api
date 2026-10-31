import {
  NumberFieldOptional,
  UUIDFieldOptional,
} from '@/decorators/field.decorators';

export class ListStaffScheduleReqDto {
  @UUIDFieldOptional()
  branchId?: string;

  @UUIDFieldOptional()
  accountId?: string;

  /** ISO weekday: 1 = Monday ... 7 = Sunday */
  @NumberFieldOptional({ int: true, min: 1, max: 7 })
  weekday?: number;
}
