import {
  BooleanField,
  ClassField,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';

/** One login of the caller (a refresh-token family). */
@Exclude()
export class SessionResDto {
  @StringField() @Expose() id: string;
  @StringFieldOptional({ nullable: true }) @Expose() device: string | null;
  @StringFieldOptional({ nullable: true }) @Expose() ip: string | null;
  @ClassField(() => Date) @Expose() lastUsedAt: Date;
  @BooleanField() @Expose() isCurrent: boolean;
}
