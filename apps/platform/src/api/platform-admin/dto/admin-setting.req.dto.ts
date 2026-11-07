import {
  BooleanFieldOptional,
  ClassFieldOptional,
  EmailFieldOptional,
  NumberFieldOptional,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { IsIn } from 'class-validator';

/** The IANA zones the runtime knows, plus UTC (some runtimes leave it out of the list) */
const TIME_ZONES = [...Intl.supportedValuesOf('timeZone'), 'UTC'];
export const DATE_FORMATS = ['dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd'];
export const LOCALES = ['vi', 'en', 'jp'];

export class GeneralSettingsReqDto {
  @StringFieldOptional({ minLength: 1, maxLength: 100 })
  platformName?: string;

  @EmailFieldOptional()
  supportEmail?: string;

  @StringFieldOptional()
  @IsIn(TIME_ZONES)
  timezone?: string;

  @StringFieldOptional()
  @IsIn(DATE_FORMATS)
  dateFormat?: string;

  /** The platform bills in dong only */
  @StringFieldOptional()
  @IsIn(['VND'])
  currency?: string;

  @StringFieldOptional()
  @IsIn(LOCALES)
  defaultLocale?: string;
}

export class SecuritySettingsReqDto {
  @NumberFieldOptional({ int: true, min: 3, max: 20 })
  lockoutMaxAttempts?: number;

  @NumberFieldOptional({ int: true, min: 1, max: 1440 })
  lockoutWindowMinutes?: number;

  @NumberFieldOptional({ int: true, min: 5, max: 1440 })
  resetLinkTtlMinutes?: number;

  @BooleanFieldOptional()
  resetLinkSingleUse?: boolean;

  @NumberFieldOptional({ int: true, min: 12, max: 120 })
  auditRetentionMonths?: number;
}

export class EmailSettingsReqDto {
  @StringFieldOptional({ minLength: 1, maxLength: 100 })
  senderName?: string;

  @EmailFieldOptional()
  senderEmail?: string;
}

export class BillingSettingsReqDto {
  /** Days a paid plan keeps its limits after it ended, before it falls back to `free` (0 = no grace) */
  @NumberFieldOptional({ int: true, min: 0, max: 60 })
  graceDays?: number;
}

/** Any subset of the settings: a group or a key that is left out is not touched */
export class UpdateSettingsReqDto {
  @ClassFieldOptional(() => GeneralSettingsReqDto)
  general?: GeneralSettingsReqDto;

  @ClassFieldOptional(() => SecuritySettingsReqDto)
  security?: SecuritySettingsReqDto;

  @ClassFieldOptional(() => EmailSettingsReqDto)
  email?: EmailSettingsReqDto;

  @ClassFieldOptional(() => BillingSettingsReqDto)
  billing?: BillingSettingsReqDto;
}
