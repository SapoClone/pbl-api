import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateProductImportReqDto {
  @ApiProperty({
    format: 'uuid',
    description: 'uploadId from POST /uploads/imports, content already PUT',
  })
  @IsUUID()
  uploadId!: string;
}

export interface ProductImportRes {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}
