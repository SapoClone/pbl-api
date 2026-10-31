import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ResolveSyncConflictDto {
  @IsIn(['RESOLVED', 'IGNORED'])
  resolutionStatus!: 'RESOLVED' | 'IGNORED';

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  resolutionAction!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolutionNotes?: string;

  @IsOptional()
  @IsUUID()
  internalVariantId?: string;

  @IsOptional()
  @IsBoolean()
  retryAfterResolve?: boolean;
}

export class RetrySyncConflictDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
