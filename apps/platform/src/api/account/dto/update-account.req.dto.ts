import { StringFieldOptional } from '@/decorators/field.decorators';
import { Matches } from 'class-validator';

export class UpdateAccountReqDto {
  @StringFieldOptional({ maxLength: 100 })
  name?: string;

  @StringFieldOptional({ maxLength: 20 })
  @Matches(/^\+?[0-9]{8,15}$/)
  phone?: string;
}
