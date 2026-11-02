import {
  ClassField,
  NumberField,
  StringField,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { AdminResDto } from './admin.res.dto';

@Exclude()
export class AdminLoginResDto {
  @Expose()
  @StringField()
  accessToken!: string;

  @Expose()
  @StringField()
  refreshToken!: string;

  @Expose()
  @NumberField()
  tokenExpires!: number;

  @Expose()
  @ClassField(() => AdminResDto)
  admin!: AdminResDto;
}
