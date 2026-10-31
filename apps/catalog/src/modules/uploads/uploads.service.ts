import { Inject, Injectable } from '@nestjs/common';
import {
  TenantContext,
  TenantScopedRepository,
  runInTenantTransaction,
} from '@pbl/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  CatalogDomainError,
  CatalogErrorCode,
} from '../../domain/catalog-domain';
import {
  UploadEntity,
  UploadKind,
} from '../../infrastructure/persistence/catalog.entities';
import { toCatalogHttpException } from '../../presentation/catalog-http-error';
import { FILE_STORAGE, FileStorage, publicUrlFor } from './file-storage';
import {
  CreateImageUploadReqDto,
  CreateImportUploadReqDto,
  ImageUploadRes,
  ImportUploadRes,
  UploadedRes,
} from './uploads.dto';

export const UPLOAD_TTL_MS = 15 * 60 * 1000;
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'text/csv': 'csv',
};

@Injectable()
export class UploadsService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  private async create(
    kind: UploadKind,
    dto: { fileName: string; contentType: string; size: number },
  ): Promise<{ row: UploadEntity; uploadUrl: string }> {
    const tenantId = TenantContext.require();
    const id = randomUUID();
    const ext = EXT[dto.contentType];
    const row = await runInTenantTransaction(this.dataSource, async (em) =>
      TenantScopedRepository.forEntity(em, UploadEntity).save({
        id,
        kind,
        fileName: dto.fileName.trim(),
        contentType: dto.contentType,
        declaredSize: dto.size,
        storageKey: `t/${tenantId}/${kind.toLowerCase()}/${id}.${ext}`,
        publicUrl: kind === 'IMAGE' ? publicUrlFor(tenantId, id, ext) : null,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
      }),
    );
    return { row, uploadUrl: `/catalog/api/v1/uploads/${row.id}/content` };
  }

  async createImageUpload(
    dto: CreateImageUploadReqDto,
  ): Promise<ImageUploadRes> {
    try {
      const { row, uploadUrl } = await this.create('IMAGE', dto);
      return {
        imageId: row.id,
        uploadUrl,
        uploadHeaders: { 'Content-Type': row.contentType },
        publicUrl: row.publicUrl as string,
        expiresAt: row.expiresAt.toISOString(),
      };
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async createImportUpload(
    dto: CreateImportUploadReqDto,
  ): Promise<ImportUploadRes> {
    try {
      const { row, uploadUrl } = await this.create('IMPORT', dto);
      return {
        uploadId: row.id,
        uploadUrl,
        uploadHeaders: { 'Content-Type': row.contentType },
        expiresAt: row.expiresAt.toISOString(),
      };
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  /** Receives the bytes the client PUTs to `uploadUrl`. */
  async storeContent(
    id: string,
    contentType: string | undefined,
    data: Buffer,
  ): Promise<UploadedRes> {
    try {
      const row = await runInTenantTransaction(this.dataSource, async (em) => {
        const scoped = TenantScopedRepository.forEntity(em, UploadEntity);
        const upload = await scoped.findOne({ where: { id } });
        if (!upload) {
          throw new CatalogDomainError(
            CatalogErrorCode.UPLOAD_NOT_FOUND,
            'Upload not found',
            'NOT_FOUND',
          );
        }
        if (upload.status !== 'PENDING') {
          throw new CatalogDomainError(
            CatalogErrorCode.UPLOAD_INVALID,
            'This upload already received its content',
            'CONFLICT',
          );
        }
        if (upload.expiresAt.getTime() < Date.now()) {
          throw new CatalogDomainError(
            CatalogErrorCode.UPLOAD_INVALID,
            'The upload URL has expired',
            'BAD_REQUEST',
          );
        }
        const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
        if (type !== upload.contentType) {
          throw new CatalogDomainError(
            CatalogErrorCode.UPLOAD_INVALID,
            `Content-Type must be ${upload.contentType}`,
            'UNPROCESSABLE',
          );
        }
        if (data.length === 0 || data.length > upload.declaredSize) {
          throw new CatalogDomainError(
            CatalogErrorCode.UPLOAD_INVALID,
            `Body must be 1 to ${upload.declaredSize} bytes (the declared size)`,
            'UNPROCESSABLE',
          );
        }
        await this.storage.put(upload.storageKey, data, upload.contentType);
        upload.status = 'UPLOADED';
        upload.storedSize = data.length;
        return scoped.save(upload);
      });
      return { id: row.id, status: 'uploaded', size: row.storedSize ?? 0 };
    } catch (error) {
      toCatalogHttpException(error);
    }
  }
}
