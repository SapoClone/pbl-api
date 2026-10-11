import {
  EmailField,
  PasswordField,
  UUIDFieldOptional,
} from '@/decorators/field.decorators';

export class LoginReqDto {
  @EmailField()
  email!: string;

  @PasswordField()
  password!: string;

  /** Store to select; omitted -> the only store, or none */
  @UUIDFieldOptional({ nullable: true })
  tenantId?: string | null;
}
