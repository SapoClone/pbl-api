import { EmailField, PasswordField } from '@/decorators/field.decorators';

export class AdminLoginReqDto {
  @EmailField()
  email!: string;

  @PasswordField()
  password!: string;
}
