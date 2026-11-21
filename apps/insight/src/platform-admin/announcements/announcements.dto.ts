import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  registerDecorator,
} from 'class-validator';
import { Audience, audienceProblem } from './audience';

export const ANNOUNCEMENT_TYPES = ['maintenance', 'update', 'guide'] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];
export const ANNOUNCEMENT_STATUSES = ['draft', 'scheduled', 'sent'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

/** The value is an audience (`all`, `plan`, `integration_provider`, `tenants`) with a valid list where it needs one */
function IsAudience() {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isAudience',
      target: target.constructor,
      propertyName,
      validator: {
        validate: (value: unknown) => audienceProblem(value) === null,
        defaultMessage: ({ value }) =>
          audienceProblem(value) ?? 'audience is not valid',
      },
    });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListAnnouncementsReqDto {
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
  limit: number = 20;

  /** Part of the title */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_TYPES)
  type?: AnnouncementType;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_STATUSES)
  status?: AnnouncementStatus;

  /** Created from this Vietnam day (YYYY-MM-DD), inclusive */
  @IsOptional()
  @Matches(DATE)
  from?: string;

  /** Created up to this Vietnam day (YYYY-MM-DD), inclusive */
  @IsOptional()
  @Matches(DATE)
  to?: string;

  /** Newest first by default */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';
}

export class CreateAnnouncementReqDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content!: string;

  @IsIn(ANNOUNCEMENT_TYPES)
  type!: AnnouncementType;

  @IsAudience()
  audience!: Audience;

  /** A time to remember on the draft; it is the send call that schedules. Must be in the future when given */
  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledAt?: string | null;
}

export class UpdateAnnouncementReqDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_TYPES)
  type?: AnnouncementType;

  @IsOptional()
  @IsAudience()
  audience?: Audience;

  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledAt?: string | null;
}

export class AudiencePreviewReqDto {
  @IsAudience()
  audience!: Audience;
}

export class SendAnnouncementReqDto {
  /** Null or missing: send now. A time in the future: send then */
  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledAt?: string | null;
}

export class WatchlistReqDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 5;
}

export class OverviewReqDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  to?: string;
}
