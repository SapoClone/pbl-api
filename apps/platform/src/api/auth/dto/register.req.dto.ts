import {
  EmailField,
  PasswordField,
  StringFieldOptional,
} from '@/decorators/field.decorators';

export class RegisterReqDto {
  @EmailField()
  email!: string;

  @PasswordField()
  password!: string;

  @StringFieldOptional({ maxLength: 100 })
  name?: string;
}
