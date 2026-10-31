import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@pbl/auth';
import type { Request } from 'express';
import {
  CreateImageUploadReqDto,
  CreateImportUploadReqDto,
  ImageUploadRes,
  ImportUploadRes,
  MAX_UPLOAD_BYTES,
  UploadedRes,
} from './uploads.dto';
import { UploadsService } from './uploads.service';

async function readBody(req: Request, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > limit) {
      throw new BadRequestException({
        errorCode: 'UPLOAD_INVALID',
        message: `Body is larger than ${limit} bytes`,
      });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('api/v1/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('images')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create', 'products.update')
  @ApiOperation({
    summary: 'Register an image upload (png/jpeg, up to 5 MB)',
    description:
      'Returns an imageId, the URL to PUT the bytes to and the public URL. Send imageId in POST/PATCH /products (imageIds).',
  })
  createImage(@Body() dto: CreateImageUploadReqDto): Promise<ImageUploadRes> {
    return this.uploads.createImageUpload(dto);
  }

  @Post('imports')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  @ApiOperation({ summary: 'Register a CSV upload for POST /product-imports' })
  createImport(
    @Body() dto: CreateImportUploadReqDto,
  ): Promise<ImportUploadRes> {
    return this.uploads.createImportUpload(dto);
  }

  @Put(':id/content')
  @RequirePermission('products.create', 'products.update')
  @ApiOperation({
    summary: 'Upload the file bytes (raw body, declared Content-Type)',
  })
  async content(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<UploadedRes> {
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    return this.uploads.storeContent(id, req.headers['content-type'], body);
  }
}
