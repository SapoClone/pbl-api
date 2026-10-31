import {
  EnumFieldOptional,
  UUIDFieldOptional,
} from '@/decorators/field.decorators';
import { ArrayMaxSize, ArrayUnique, IsArray } from 'class-validator';
import { AssignableRole } from './member-role-input';

export class UpdateMemberReqDto {
  @UUIDFieldOptional()
  roleId?: string;

  /** Legacy name of the role (`manager`, `cashier`, ...); `roleId` wins when both are sent */
  @EnumFieldOptional(() => AssignableRole)
  role?: AssignableRole;

  /** The full set of branches: it replaces the old one; an empty list means every branch */
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @UUIDFieldOptional({ each: true })
  branchIds?: string[];
}
