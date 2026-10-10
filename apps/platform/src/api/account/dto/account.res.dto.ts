import {
  ClassField,
  EnumField,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { AccountStatus } from '../entities/account.entity';

@Exclude()
export class AccountResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() email: string;
  @StringField() @Expose() name: string;
  @StringFieldOptional({ nullable: true }) @Expose() phone: string | null;
  @EnumField(() => AccountStatus) @Expose() status: AccountStatus;
  @ClassField(() => Date) @Expose() createdAt: Date;
}
