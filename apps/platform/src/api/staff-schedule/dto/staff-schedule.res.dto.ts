import {
  NumberField,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class StaffScheduleResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() accountId: string;
  @StringField() @Expose() staffName: string;
  @StringField() @Expose() branchId: string;
  @StringFieldOptional({ nullable: true }) @Expose() branchName: string | null;
  @NumberField({ int: true, min: 1, max: 7 }) @Expose() weekday: number;
  @StringField() @Expose() startTime: string;
  @StringField() @Expose() endTime: string;
}
