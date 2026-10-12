import {
  BooleanField,
  ClassField,
  EnumField,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { BranchStatus } from '../entities/branch.entity';

@Exclude()
export class BranchResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() name: string;
  @StringField() @Expose() code: string;
  @StringFieldOptional({ nullable: true }) @Expose() address: string | null;
  @StringFieldOptional({ nullable: true }) @Expose() phone: string | null;
  @BooleanField() @Expose() isWarehouse: boolean;
  @EnumField(() => BranchStatus) @Expose() status: BranchStatus;
  @ClassField(() => Date) @Expose() createdAt: Date;
}
