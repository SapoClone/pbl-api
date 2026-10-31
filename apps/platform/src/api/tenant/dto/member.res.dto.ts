import {
  BooleanField,
  ClassField,
  EnumField,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { MemberStatus } from '../entities/account-tenant.entity';

/** A member of the selected store. */
@Exclude()
export class MemberResDto {
  @StringField() @Expose() accountId: string;
  @StringField() @Expose() email: string;
  @StringField() @Expose() name: string;
  /** The role code (`owner`, `branch_manager`, ...); same as `roleCode` */
  @StringField() @Expose() role: string;
  @ClassField(() => Date) @Expose() createdAt: Date;

  /** Readable per-store code, NV001-style */
  @StringField() @Expose() code: string;
  @EnumField(() => MemberStatus) @Expose() status: MemberStatus;
  /** Masked (090•••••45) */
  @StringFieldOptional({ nullable: true }) @Expose() phone: string | null;
  @StringField() @Expose() roleId: string;
  @StringField() @Expose() roleName: string;
  @StringField() @Expose() roleCode: string;
  /** Branches the member may act in; empty means every branch */
  @StringField({ each: true }) @Expose() branchIds: string[];
  @BooleanField() @Expose() isOwner: boolean;
  @ClassField(() => Date, { nullable: true })
  @Expose()
  lastLoginAt: Date | null;
  @BooleanField() @Expose() isOnShift: boolean;
  /** Today's shifts, e.g. "08:00–16:00", or null */
  @StringFieldOptional({ nullable: true })
  @Expose()
  scheduleLabel: string | null;
}
