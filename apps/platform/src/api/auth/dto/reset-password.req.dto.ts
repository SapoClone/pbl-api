import { PasswordField, StringField } from '@/decorators/field.decorators';

export class ResetPasswordReqDto {
  /** The token from the emailed link (43 URL-safe characters); the cap only bounds junk input */
  @StringField({ maxLength: 256 })
  token!: string;

  @PasswordField()
  password!: string;
}
