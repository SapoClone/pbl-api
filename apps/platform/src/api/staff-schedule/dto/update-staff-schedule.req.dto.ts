import {
  EnumFieldOptional,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Matches, ValidateIf } from 'class-validator';
import { StaffDuty } from '../staff-duty';
import { TIME_PATTERN } from './create-staff-schedule.req.dto';

export class UpdateStaffScheduleReqDto {
  @ApiPropertyOptional({ example: '14:00' })
  @ValidateIf((_object, value) => value !== undefined)
  @Matches(TIME_PATTERN)
  startTime?: string;

  @ApiPropertyOptional({ example: '22:00' })
  @ValidateIf((_object, value) => value !== undefined)
  @Matches(TIME_PATTERN)
  endTime?: string;

  @StringFieldOptional({ maxLength: 50, nullable: true })
  name?: string | null;

  @EnumFieldOptional(() => StaffDuty)
  duty?: StaffDuty;

  @StringFieldOptional({ maxLength: 200, nullable: true })
  note?: string | null;
}
