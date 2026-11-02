import { OffsetPaginationDto } from '@/common/dto/offset-pagination/offset-pagination.dto';
import {
  ClassField,
  ClassFieldOptional,
  EnumField,
  NumberField,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { TenantStatus } from '../../tenant/entities/tenant.entity';

@Exclude()
export class AdminTenantOwnerResDto {
  @Expose() @StringField() accountId!: string;
  @Expose() @StringField() name!: string;
  @Expose() @StringField() email!: string;
  /** 090•••••45: the admin sees who to call, not the number */
  @Expose() @StringFieldOptional({ nullable: true }) phoneMasked!:
    | string
    | null;
}

@Exclude()
export class AdminTenantBranchesResDto {
  @Expose() @NumberField() used!: number;
}

@Exclude()
export class AdminTenantResDto {
  @Expose() @StringField() id!: string;
  @Expose() @StringField() code!: string;
  @Expose() @StringField() name!: string;
  @Expose() @StringField() subdomain!: string;
  @Expose() @EnumField(() => TenantStatus) status!: TenantStatus;
  @Expose()
  @ClassFieldOptional(() => AdminTenantOwnerResDto, { nullable: true })
  owner!: AdminTenantOwnerResDto | null;
  @Expose()
  @ClassField(() => AdminTenantBranchesResDto)
  branches!: AdminTenantBranchesResDto;
  @Expose() @ClassField(() => Date) createdAt!: Date;
}

@Exclude()
export class AdminTenantDetailResDto extends AdminTenantResDto {
  @Expose() @StringFieldOptional({ nullable: true }) address!: string | null;
  @Expose() @StringFieldOptional({ nullable: true }) email!: string | null;
  @Expose() @StringFieldOptional({ nullable: true }) phone!: string | null;
  @Expose() @StringFieldOptional({ nullable: true }) suspendedReason!:
    | string
    | null;
  @Expose()
  @ClassFieldOptional(() => Date, { nullable: true })
  suspendedAt!: Date | null;
}

/** Tab labels: the stores matching the search, whatever their status */
@Exclude()
export class AdminTenantCountsResDto {
  @Expose() @NumberField() all!: number;
  @Expose() @NumberField() active!: number;
  @Expose() @NumberField() suspended!: number;
}

@Exclude()
export class AdminTenantListResDto {
  @Expose()
  @ClassField(() => AdminTenantResDto, { each: true, isArray: true })
  data!: AdminTenantResDto[];

  @Expose()
  @ClassField(() => OffsetPaginationDto)
  pagination!: OffsetPaginationDto;

  @Expose()
  @ClassField(() => AdminTenantCountsResDto)
  counts!: AdminTenantCountsResDto;
}
