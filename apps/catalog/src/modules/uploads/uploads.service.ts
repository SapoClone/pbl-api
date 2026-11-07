import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  TenantContext,
  TenantScopedRepository,
  runInTenantTransaction,
} from '@pbl/common';
import { qualifiedTable } from '@pbl/events';
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
import { PlanQuotaService } from '../../quota/plan-quota.service';
import { FILE_STORAGE, FileStorage } from './file-storage';
import {
  CreateImageUploadReqDto,
  CreateImportUploadReqDto,
  IMAGE_TYPES,
  IMPORT_TYPES,
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
const ALLOWED: Record<UploadKind, readonly string[]> = {
  IMAGE: IMAGE_TYPES,
  IMPORT: IMPORT_TYPES,
};

interface UnusedUpload {
  id: string;
  tenantId: string;
  storageKey: string;
  status: string;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly quota: PlanQuotaService,
  ) {}

  private async create(
    kind: UploadKind,
    dto: { fileName: string; contentType: string; size: number },
  ): Promise<{
    row: UploadEntity;
    uploadUrl: string;
    headers: Record<string, string>;
  }> {
    const tenantId = TenantContext.require();
    const ext = EXT[dto.contentType];
    if (!ext || !ALLOWED[kind].includes(dto.contentType)) {
      throw new CatalogDomainError(
        CatalogErrorCode.UPLOAD_INVALID,
        `Content type ${dto.contentType} is not allowed here`,
        'UNPROCESSABLE',
      );
    }
    const id = randomUUID();
    // keys are built here from uuids, never taken from the client
    const key =
      kind === 'IMAGE'
        ? `t/${tenantId}/p/${id}.${ext}`
        : `t/${tenantId}/imports/${id}.${ext}`;
    const row = await runInTenantTransaction(this.dataSource, async (em) => {
      // 409 Q001 before a URL is issued when the file cannot fit
      await this.quota.assertCanStore(em, dto.size);
      return TenantScopedRepository.forEntity(em, UploadEntity).save({
        id,
        kind,
        fileName: dto.fileName.trim(),
        contentType: dto.contentType,
        declaredSize: dto.size,
        storageKey: key,
        publicUrl: kind === 'IMAGE' ? this.storage.publicUrl(key) : null,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
      });
    });
    const presigned = await this.storage.presignPut(
      key,
      dto.contentType,
      dto.size,
      UPLOAD_TTL_MS / 1000,
    );
    return { row, uploadUrl: presigned.url, headers: presigned.headers };
  }

  async createImageUpload(
    dto: CreateImageUploadReqDto,
  ): Promise<ImageUploadRes> {
    try {
      const { row, uploadUrl, headers } = await this.create('IMAGE', dto);
      return {
        imageId: row.id,
        uploadUrl,
        uploadHeaders: headers,
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
      const { row, uploadUrl, headers } = await this.create('IMPORT', dto);
      return {
        uploadId: row.id,
        uploadUrl,
        uploadHeaders: headers,
        expiresAt: row.expiresAt.toISOString(),
      };
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  /**
   * The client says it PUT the file to `uploadUrl`. The API HEADs the object: it must exist with the declared content
   * type and 1 to the declared bytes; then the upload is UPLOADED and counts toward the plan. Idempotent.
   */
  async complete(id: string): Promise<UploadedRes> {
    try {
      const row = await runInTenantTransaction(this.dataSource, async (em) => {
        const scoped = TenantScopedRepository.forEntity(em, UploadEntity);
        const upload = await scoped.findOne({ where: { id } });
        if (!upload) throw this.notFound();
        if (upload.status !== 'PENDING') return upload;
        const info = await this.storage.head(upload.storageKey);
        if (!info) {
          throw new CatalogDomainError(
            CatalogErrorCode.UPLOAD_INVALID,
            'The file was not uploaded to the upload URL yet',
            'BAD_REQUEST',
          );
        }
        const typeOk =
          info.contentType === null || info.contentType === upload.contentType;
        if (!typeOk || info.size < 1 || info.size > upload.declaredSize) {
          // the object breaks what was declared: drop it so it cannot be used
          await this.discardObject(upload.storageKey);
          throw new CatalogDomainError(
            CatalogErrorCode.UPLOAD_INVALID,
            !typeOk
              ? `The stored file is ${info.contentType}, expected ${upload.contentType}`
              : `The stored file is ${info.size} bytes, expected 1 to ${upload.declaredSize}`,
            'BAD_REQUEST',
          );
        }
        await this.quota.assertCanStore(em, info.size);
        upload.status = 'UPLOADED';
        upload.storedSize = info.size;
        const saved = await scoped.save(upload);
        await this.quota.announceUsage(em);
        return saved;
      });
      return this.toUploaded(row);
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  /** Local driver only: receives the bytes the client PUTs to `uploadUrl` (closed when the store is S3). */
  async storeContent(
    id: string,
    contentType: string | undefined,
    data: Buffer,
  ): Promise<UploadedRes> {
    try {
      if (this.storage.direct) throw this.notFound();
      const row = await runInTenantTransaction(this.dataSource, async (em) => {
        const scoped = TenantScopedRepository.forEntity(em, UploadEntity);
        const upload = await scoped.findOne({ where: { id } });
        if (!upload) throw this.notFound();
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
        await this.quota.assertCanStore(em, data.length);
        await this.storage.put(upload.storageKey, data, upload.contentType);
        upload.status = 'UPLOADED';
        upload.storedSize = data.length;
        const saved = await scoped.save(upload);
        await this.quota.announceUsage(em);
        return saved;
      });
      return this.toUploaded(row);
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  /**
   * Removes uploads nobody will use: PENDING past `expires_at`, and UPLOADED images never attached for 24 hours.
   * The object goes first, then the row (a failed delete keeps the row, so the next run retries). Several replicas are
   * fine: a transaction advisory lock lets one claim run at a time. Returns how many uploads were removed.
   */
  async cleanupUnused(limit = 200): Promise<number> {
    const due = await this.dataSource.transaction(
      async (em): Promise<UnusedUpload[]> => {
        const [{ locked }] = await em.query(
          `SELECT pg_try_advisory_xact_lock(hashtext('catalog:uploads-cleanup')) AS locked`,
        );
        if (!locked) return [];
        await em.query(
          `SELECT set_config('app.uploads_cleanup_scheduler', 'on', true)`,
        );
        return em.query(
          `SELECT id, tenant_id AS "tenantId", storage_key AS "storageKey", status
             FROM ${qualifiedTable(this.dataSource, 'uploads')}
            WHERE (status = 'PENDING' AND expires_at < now())
               OR (status = 'UPLOADED' AND kind = 'IMAGE' AND updated_at < now() - interval '24 hours')
            ORDER BY expires_at ASC
            LIMIT $1`,
          [limit],
        );
      },
    );
    let removed = 0;
    for (const u of due) {
      try {
        await this.storage.delete(u.storageKey);
        // the tenant comes from the row, not from a request
        await TenantContext.run(u.tenantId, () =>
          runInTenantTransaction(this.dataSource, async (em) => {
            await TenantScopedRepository.forEntity(em, UploadEntity).delete({
              id: u.id,
              status: u.status as UploadEntity['status'],
            });
            if (u.status === 'UPLOADED') await this.quota.announceUsage(em);
          }),
        );
        removed += 1;
      } catch (error) {
        this.logger.error(
          `Could not clean up upload ${u.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    if (removed > 0) this.logger.log(`Removed ${removed} unused upload(s)`);
    return removed;
  }

  private toUploaded(row: UploadEntity): UploadedRes {
    return {
      id: row.id,
      status: row.status.toLowerCase(),
      size: row.storedSize ?? 0,
      ...(row.publicUrl ? { publicUrl: row.publicUrl } : {}),
    };
  }

  private notFound(): CatalogDomainError {
    return new CatalogDomainError(
      CatalogErrorCode.UPLOAD_NOT_FOUND,
      'Upload not found',
      'NOT_FOUND',
    );
  }

  private async discardObject(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(
        `Could not delete ${key}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
