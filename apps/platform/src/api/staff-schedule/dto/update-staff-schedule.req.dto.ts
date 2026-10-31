import { ApiPropertyOptional } from '@nestjs/swagger';
import { Matches, ValidateIf } from 'class-validator';
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
}
