import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListNotificationsReqDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  /** `unread=true`: only what the caller has not read */
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unread?: boolean;

  /** One type or several, comma-separated: `order,staff` */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[a-z_]+(,[a-z_]+)*$/)
  type?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;

export class RegisterDeviceTokenReqDto {
  @IsString()
  @MaxLength(512)
  token!: string;

  @IsIn(DEVICE_PLATFORMS)
  platform!: (typeof DEVICE_PLATFORMS)[number];
}
