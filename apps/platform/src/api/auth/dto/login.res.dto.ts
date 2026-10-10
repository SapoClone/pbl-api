import {
  ClassField,
  NumberField,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { MembershipResDto } from '../../tenant/dto/membership.res.dto';

@Exclude()
export class LoginResDto {
  @Expose()
  @StringField()
  userId!: string;

  @Expose()
  @StringField()
  accessToken!: string;

  @Expose()
  @StringField()
  refreshToken!: string;

  @Expose()
  @NumberField()
  tokenExpires!: number;

  /** Selected store, or null when the caller must pick or create one */
  @Expose()
  @StringFieldOptional({ nullable: true })
  tenantId!: string | null;

  @Expose()
  @ClassField(() => MembershipResDto, { each: true, isArray: true })
  tenants!: MembershipResDto[];
}
