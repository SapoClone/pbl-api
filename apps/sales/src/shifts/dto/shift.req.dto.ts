import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CurrentShiftReqDto {
  @IsUUID()
  registerId!: string;
}

export class OpenShiftReqDto {
  @IsUUID()
  registerId!: string;

  /** Integer VND counted in the drawer */
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000)
  openingCash!: number;
}

export class CloseShiftReqDto {
  /** Optimistic lock: refused with 409 when the shift changed since it was read */
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  /** Integer VND counted at the end of the shift */
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000)
  closingCashActual!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
