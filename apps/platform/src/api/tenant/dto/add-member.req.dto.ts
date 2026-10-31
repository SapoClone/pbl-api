import {
  EmailField,
  EnumFieldOptional,
  UUIDFieldOptional,
} from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray } from 'class-validator';
import { AssignableRole } from './member-role-input';

export class AddMemberReqDto {
  /** The account to add; it must already have registered */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @EmailField()
  email!: string;

  /** The role to give (`GET /roles`); one of `roleId` and `role` is required */
  @UUIDFieldOptional()
  roleId?: string;

  /** Legacy name of the role (`manager`, `cashier`, ...); `roleId` wins when both are sent */
  @EnumFieldOptional(() => AssignableRole)
  role?: AssignableRole;

  /** Branches the member may act in; omit or send none for every branch */
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @UUIDFieldOptional({ each: true })
  branchIds?: string[];
}
