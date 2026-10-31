import { UUIDField } from '@/decorators/field.decorators';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateStaffScheduleReqDto {
  @UUIDField()
  accountId!: string;

  @UUIDField()
  branchId!: string;

  /** ISO weekdays, 1 = Monday ... 7 = Sunday; one row is created per day */
  @ApiProperty({ type: [Number], example: [1, 2, 3, 4, 5] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays!: number[];

  @ApiProperty({ example: '08:00' })
  @Matches(TIME_PATTERN)
  startTime!: string;

  @ApiProperty({ example: '16:00' })
  @Matches(TIME_PATTERN)
  endTime!: string;
}
