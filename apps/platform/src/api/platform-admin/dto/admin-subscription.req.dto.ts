import { PageOptionsDto } from '@/common/dto/offset-pagination/page-options.dto';
import {
  BooleanFieldOptional,
  DateFieldOptional,
  EnumField,
  EnumFieldOptional,
  NumberField,
  StringField,
  StringFieldOptional,
  UUIDField,
  UUIDFieldOptional,
} from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { PaymentMethod } from '../../subscription/entities/subscription-payment.entity';
import { SubscriptionStatus } from '../../subscription/entities/subscription.entity';

/** `q` searches the store's name and the subscription code */
export class ListAdminSubscriptionsReqDto extends PageOptionsDto {
  @StringFieldOptional({ maxLength: 30 })
  readonly planCode?: string;

  @EnumFieldOptional(() => SubscriptionStatus)
  readonly status?: SubscriptionStatus;

  @Transform(({ value }) => value === 'true' || value === true)
  @BooleanFieldOptional()
  readonly isExpiringSoon?: boolean;

  /** With a store, its closed subscriptions are listed too */
  @UUIDFieldOptional()
  readonly tenantId?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A payment recorded by hand; the period is days, `YYYY-MM-DD` */
export class RecordPaymentReqDto {
  @NumberField({ int: true, min: 0 })
  amount!: number;

  @EnumField(() => PaymentMethod)
  method!: PaymentMethod;

  @StringField({ maxLength: 10 })
  @Matches(DATE)
  periodStart!: string;

  @StringField({ maxLength: 10 })
  @Matches(DATE)
  periodEnd!: string;

  @DateFieldOptional()
  paidAt?: Date;

  @StringFieldOptional({ maxLength: 500 })
  note?: string;
}

export class ChangePlanCheckReqDto {
  @UUIDField()
  tenantId!: string;

  @StringField({ maxLength: 30 })
  planCode!: string;

  @StringField({ maxLength: 10 })
  @Matches(DATE)
  effectiveFrom!: string;

  @StringField({ maxLength: 10 })
  @Matches(DATE)
  expiresAt!: string;
}

export class ChangePlanReqDto extends ChangePlanCheckReqDto {
  @StringFieldOptional({ maxLength: 500 })
  note?: string;
}

export class ListSubscriptionEventsReqDto extends PageOptionsDto {}
