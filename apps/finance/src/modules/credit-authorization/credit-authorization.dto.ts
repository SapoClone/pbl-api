import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCreditAuthorizationDto {
  @IsUUID()
  customerId!: string;

  @IsInt()
  amount!: number;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  callerService?: string;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(86400)
  ttlSeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  overrideApprovedBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CommitCreditAuthorizationDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  actorId?: string;
}

export class ReleaseCreditAuthorizationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  actorId?: string;
}

export class UpdateCustomerCreditLimitDto {
  @IsInt()
  creditLimit!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
