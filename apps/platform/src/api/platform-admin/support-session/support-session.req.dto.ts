import { PageOptionsDto } from '@/common/dto/offset-pagination/page-options.dto';
import { Order } from '@/constants/app.constant';
import {
  EnumFieldOptional,
  StringField,
  UUIDField,
  UUIDFieldOptional,
} from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';

export enum SupportSessionStatus {
  ACTIVE = 'active',
  ENDED = 'ended',
  EXPIRED = 'expired',
}

export class StartSupportSessionReqDto {
  @UUIDField()
  tenantId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @StringField({ minLength: 1, maxLength: 500 })
  reason!: string;
}

/** `q` searches the session code, the store's name and code, and the admin's name */
export class ListSupportSessionsReqDto extends PageOptionsDto {
  @UUIDFieldOptional()
  readonly tenantId?: string;

  @UUIDFieldOptional()
  readonly adminId?: string;

  /** Newest first unless asked otherwise */
  @EnumFieldOptional(() => Order, { default: Order.DESC })
  readonly order?: Order = Order.DESC;

  @EnumFieldOptional(() => SupportSessionStatus)
  readonly status?: SupportSessionStatus;
}
