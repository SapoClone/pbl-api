import {
  BooleanField,
  ClassField,
  EnumField,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { MemberStatus, TenantRole } from '../entities/account-tenant.entity';

/** A member of the selected store. */
@Exclude()
export class MemberResDto {
  @StringField() @Expose() accountId: string;
  @StringField() @Expose() email: string;
  @StringField() @Expose() name: string;
  @EnumField(() => TenantRole) @Expose() role: TenantRole;
  @ClassField(() => Date) @Expose() createdAt: Date;

  /** Readable per-store code, NV001-style */
  @StringField() @Expose() code: string;
  @EnumField(() => MemberStatus) @Expose() status: MemberStatus;
  /** Masked (090•••••45) */
  @StringFieldOptional({ nullable: true }) @Expose() phone: string | null;
  /** Always null until roles are rows (RBAC is deferred); use `role` */
  @StringFieldOptional({ nullable: true }) @Expose() roleId: string | null;
  @StringField() @Expose() roleName: string;
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
