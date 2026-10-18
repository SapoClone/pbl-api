import { EnumField } from '@/decorators/field.decorators';
import { GrantableRole } from './add-member.req.dto';

export class ChangeMemberRoleReqDto {
  @EnumField(() => GrantableRole)
  role!: GrantableRole;
}
