import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg'] as const;
export const IMPORT_TYPES = ['text/csv'] as const;

class UploadReqBase {
  @ApiProperty({ example: 'binh-xanh.jpg', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ example: 812345, description: 'Bytes, 1 to 5 MB' })
  @IsInt()
  @Min(1)
  @Max(MAX_UPLOAD_BYTES)
  size!: number;
}

export class CreateImageUploadReqDto extends UploadReqBase {
  @ApiProperty({ enum: IMAGE_TYPES })
  @IsIn(IMAGE_TYPES)
  contentType!: (typeof IMAGE_TYPES)[number];
}

export class CreateImportUploadReqDto extends UploadReqBase {
  @ApiProperty({ enum: IMPORT_TYPES })
  @IsIn(IMPORT_TYPES)
  contentType!: (typeof IMPORT_TYPES)[number];
}

export interface ImageUploadRes {
  imageId: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  publicUrl: string;
  expiresAt: string;
}

export interface ImportUploadRes {
  uploadId: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresAt: string;
}

export interface UploadedRes {
  id: string;
  status: string;
  size: number;
}
