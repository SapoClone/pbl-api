import { PasswordField, StringField } from '@/decorators/field.decorators';

export class ChangePasswordReqDto {
  @StringField({ minLength: 1, maxLength: 128 })
  currentPassword!: string;

  @PasswordField({ maxLength: 128 })
  newPassword!: string;
}
