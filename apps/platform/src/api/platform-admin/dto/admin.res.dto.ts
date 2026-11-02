import { EnumField, StringField } from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { PlatformAdminRole } from '../entities/platform-admin.entity';

@Exclude()
export class AdminResDto {
  @Expose()
  @StringField()
  id!: string;

  @Expose()
  @StringField()
  name!: string;

  @Expose()
  @StringField()
  email!: string;

  @Expose()
  @EnumField(() => PlatformAdminRole)
  role!: PlatformAdminRole;
}

/** `GET /admin/me`: the signed-in admin and the environment badge of the admin top bar */
@Exclude()
export class AdminMeResDto extends AdminResDto {
  @Expose()
  @StringField()
  environment!: string;
}
