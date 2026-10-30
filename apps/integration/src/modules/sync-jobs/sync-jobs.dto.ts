import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class TriggerConnectionSyncDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalOrderId?: string;

  @IsOptional()
  @IsBoolean()
  executeImmediately?: boolean;
}

export class RetrySyncJobDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  executeImmediately?: boolean;
}
