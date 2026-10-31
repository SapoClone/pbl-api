import { StaffScheduleResDto } from '@/api/staff-schedule/dto/staff-schedule.res.dto';
import { ClassField } from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { MemberResDto } from './member.res.dto';

/** The list item plus the member's weekly shifts. */
@Exclude()
export class MemberDetailResDto extends MemberResDto {
  @ClassField(() => StaffScheduleResDto, { each: true, isArray: true })
  @Expose()
  schedules: StaffScheduleResDto[];
}
