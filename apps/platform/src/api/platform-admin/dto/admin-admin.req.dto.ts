import { PageOptionsDto } from '@/common/dto/offset-pagination/page-options.dto';
import {
  EmailField,
  EnumField,
  EnumFieldOptional,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { PASSWORD_PATTERN } from '@/decorators/validators/is-password.decorator';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { MIN_ADMIN_PASSWORD_LENGTH } from '../create-first-super-admin';
import {
  PlatformAdminRole,
  PlatformAdminStatus,
} from '../entities/platform-admin.entity';

/** `q` searches name and email */
export class ListAdminsReqDto extends PageOptionsDto {
  @EnumFieldOptional(() => PlatformAdminRole)
  readonly role?: PlatformAdminRole;

  @EnumFieldOptional(() => PlatformAdminStatus)
  readonly status?: PlatformAdminStatus;
}

export class CreateAdminReqDto {
  @StringField({ maxLength: 100 })
  name!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @EmailField()
  email!: string;

  @EnumField(() => PlatformAdminRole)
  role!: PlatformAdminRole;

  /**
   * Not in contract 04, which queues a set-password email: there is no email flow for admins, so without a password
   * the new admin cannot sign in. Same policy as the bootstrap command.
   */
  @StringFieldOptional({ minLength: MIN_ADMIN_PASSWORD_LENGTH, maxLength: 128 })
  @Matches(PASSWORD_PATTERN)
  password?: string;
}

export class UpdateAdminReqDto {
  @EnumFieldOptional(() => PlatformAdminRole)
  role?: PlatformAdminRole;

  @EnumFieldOptional(() => PlatformAdminStatus)
  status?: PlatformAdminStatus;
}
