import { StringField } from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';

/** A store the caller belongs to, with the caller's role in it. */
@Exclude()
export class MembershipResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() name: string;
  @StringField() @Expose() subdomain: string;
  /** The role code (`owner`, `branch_manager`, ...) */
  @StringField() @Expose() role: string;
  @StringField() @Expose() roleId: string;
  @StringField() @Expose() roleName: string;
}
