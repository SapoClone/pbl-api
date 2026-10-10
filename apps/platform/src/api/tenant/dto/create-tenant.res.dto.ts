import { ClassField } from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { LoginResDto } from '../../auth/dto/login.res.dto';
import { TenantResDto } from './tenant.res.dto';

/** The new store, and a token pair already bound to it. */
@Exclude()
export class CreateTenantResDto {
  @ClassField(() => TenantResDto) @Expose() tenant: TenantResDto;
  @ClassField(() => LoginResDto) @Expose() auth: LoginResDto;
}
