import {
  BooleanField,
  ClassField,
  EnumField,
  NumberField,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { TenantStatus } from '../entities/tenant.entity';

@Exclude()
export class ContextTenantResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() name: string;
  @StringField() @Expose() subdomain: string;
  @EnumField(() => TenantStatus) @Expose() status: TenantStatus;
}

/** A free placeholder until subscriptions exist. */
@Exclude()
export class ContextPlanResDto {
  @StringField() @Expose() code: string;
  @StringField() @Expose() name: string;
  @BooleanField() @Expose() isExpiringSoon: boolean;
  @ClassField(() => Date, { nullable: true })
  @Expose()
  expiresAt: Date | null;
}

@Exclude()
export class ContextMeResDto {
  @StringField() @Expose() accountId: string;
  @StringField() @Expose() name: string;
  @StringField() @Expose() initials: string;
  @StringField() @Expose() email: string;
  @StringField() @Expose() role: string;
  /** Null until roles are rows (RBAC is deferred) */
  @StringFieldOptional({ nullable: true }) @Expose() roleId: string | null;
  @StringField() @Expose() roleName: string;
  @BooleanField() @Expose() isOwner: boolean;
}

@Exclude()
export class ContextBranchResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() name: string;
  @StringField() @Expose() code: string;
  @StringFieldOptional({ nullable: true }) @Expose() address: string | null;
  @BooleanField() @Expose() isWarehouse: boolean;
}

@Exclude()
export class TenantContextResDto {
  @ClassField(() => ContextTenantResDto) @Expose() tenant: ContextTenantResDto;
  @ClassField(() => ContextPlanResDto) @Expose() plan: ContextPlanResDto;
  @NumberField({ int: true }) @Expose() branchCount: number;
  @ClassField(() => ContextMeResDto) @Expose() me: ContextMeResDto;
  @ClassField(() => ContextBranchResDto, { each: true, isArray: true })
  @Expose()
  branches: ContextBranchResDto[];
  /** Empty until permissions exist (RBAC is deferred) */
  @StringField({ each: true, isArray: true })
  @Expose()
  permissions: string[];
  @StringField() @Expose() timezone: string;
}
