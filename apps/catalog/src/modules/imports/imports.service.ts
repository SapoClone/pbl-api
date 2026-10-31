import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { TenantScopedRepository, runInTenantTransaction } from '@pbl/common';
import { DataSource, IsNull } from 'typeorm';
import {
  CatalogDomainError,
  CatalogErrorCode,
  normalizeName,
  normalizeSku,
} from '../../domain/catalog-domain';
import {
  CategoryEntity,
  ProductImportEntity,
  ProductImportRowError,
  ProductVariantEntity,
  UploadEntity,
} from '../../infrastructure/persistence/catalog.entities';
import { toCatalogHttpException } from '../../presentation/catalog-http-error';
import { parseCsv } from '../products/csv';
import { ProductsService } from '../products/products.service';
import { FILE_STORAGE, FileStorage } from '../uploads/file-storage';
import { CreateProductImportReqDto, ProductImportRes } from './imports.dto';

export const MAX_IMPORT_ROWS = 1000;
const REQUIRED = ['name', 'skucode', 'price'];

function must<T>(value: T | null): T {
  if (!value) throw new Error('Record not found');
  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'string') return body;
    const m = (body as { message?: unknown }).message;
    return Array.isArray(m) ? m.join('; ') : String(m ?? error.message);
  }
  return error instanceof Error ? error.message : 'Unexpected error';
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly products: ProductsService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  private toRes(row: ProductImportEntity): ProductImportRes {
    return {
      id: row.id,
      status: row.status.toLowerCase() as ProductImportRes['status'],
      created: row.createdCount,
      updated: row.updatedCount,
      errors: row.errors,
    };
  }

  /** Creates the import and processes it in the background of this process (no queue yet). */
  async start(dto: CreateProductImportReqDto): Promise<ProductImportRes> {
    try {
      const row = await runInTenantTransaction(this.dataSource, async (em) => {
        const upload = await TenantScopedRepository.forEntity(
          em,
          UploadEntity,
        ).findOne({ where: { id: dto.uploadId, kind: 'IMPORT' } });
        if (!upload) {
          throw new CatalogDomainError(
            CatalogErrorCode.UPLOAD_NOT_FOUND,
            'Upload not found',
            'NOT_FOUND',
          );
        }
        if (upload.status !== 'UPLOADED') {
          throw new CatalogDomainError(
            CatalogErrorCode.UPLOAD_INVALID,
            upload.status === 'PENDING'
              ? 'The file has not been uploaded yet'
              : 'This upload was already imported',
            'BAD_REQUEST',
          );
        }
        const scoped = TenantScopedRepository.forEntity(
          em,
          ProductImportEntity,
        );
        upload.status = 'ATTACHED';
        await TenantScopedRepository.forEntity(em, UploadEntity).save(upload);
        return scoped.save({ uploadId: upload.id, status: 'PROCESSING' });
      });
      // Started inside the request, so the tenant context travels with the promise.
      void this.process(row.id).catch((error) =>
        this.logger.error(`Import ${row.id} crashed: ${errorMessage(error)}`),
      );
      return this.toRes(row);
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async get(id: string): Promise<ProductImportRes> {
    try {
      const row = await runInTenantTransaction(this.dataSource, (em) =>
        TenantScopedRepository.forEntity(em, ProductImportEntity).findOne({
          where: { id },
        }),
      );
      if (!row) {
        throw new CatalogDomainError(
          CatalogErrorCode.IMPORT_NOT_FOUND,
          'Import not found',
          'NOT_FOUND',
        );
      }
      return this.toRes(row);
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  private async finish(
    id: string,
    patch: Partial<ProductImportEntity>,
  ): Promise<ProductImportEntity> {
    return runInTenantTransaction(this.dataSource, async (em) => {
      const scoped = TenantScopedRepository.forEntity(em, ProductImportEntity);
      const row = await must(await scoped.findOne({ where: { id } }));
      return scoped.save(Object.assign(row, patch));
    });
  }

  /** Runs one import to completion; resolves with the final row (used by tests). */
  async process(id: string): Promise<ProductImportEntity> {
    const errors: ProductImportRowError[] = [];
    let created = 0;
    let updated = 0;
    try {
      const { upload } = await runInTenantTransaction(
        this.dataSource,
        async (em) => {
          const imp = must(
            await TenantScopedRepository.forEntity(
              em,
              ProductImportEntity,
            ).findOne({ where: { id } }),
          );
          return {
            upload: must(
              await TenantScopedRepository.forEntity(em, UploadEntity).findOne({
                where: { id: imp.uploadId },
              }),
            ),
          };
        },
      );
      const data = await this.storage.get(upload.storageKey);
      if (!data) {
        throw new Error('The uploaded file is missing from storage');
      }
      const table = parseCsv(data.toString('utf8'));
      const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
      const missing = REQUIRED.filter((c) => !header.includes(c));
      if (missing.length > 0) {
        throw new Error(`Missing column(s): ${missing.join(', ')}`);
      }
      if (table.length - 1 > MAX_IMPORT_ROWS) {
        throw new Error(`At most ${MAX_IMPORT_ROWS} rows per import`);
      }
      const col = (cells: string[], name: string) =>
        (cells[header.indexOf(name)] ?? '').trim();

      for (let i = 1; i < table.length; i++) {
        const rowNo = i + 1; // spreadsheet row number, header is row 1
        try {
          const cells = table[i];
          const name = col(cells, 'name');
          const priceText = col(cells, 'price');
          if (!name) throw new Error('name is required');
          if (!col(cells, 'skucode')) throw new Error('skuCode is required');
          if (!/^\d+$/.test(priceText)) {
            throw new Error('price must be a whole number of VND');
          }
          const price = Number(priceText);
          if (!Number.isSafeInteger(price)) throw new Error('price too large');
          const barcode = header.includes('barcode')
            ? col(cells, 'barcode') || undefined
            : undefined;
          const sku = normalizeSku(col(cells, 'skucode'));

          const existing = await runInTenantTransaction(this.dataSource, (em) =>
            TenantScopedRepository.forEntity(em, ProductVariantEntity).findOne({
              where: { skuCode: sku, deletedAt: IsNull() },
            }),
          );
          if (existing) {
            await this.products.updateVariant(existing.id, {
              basePrice: price,
              ...(barcode !== undefined ? { barcode } : {}),
            });
            updated++;
            continue;
          }

          let categoryId: string | undefined;
          const categoryName = header.includes('category')
            ? col(cells, 'category')
            : '';
          if (categoryName) {
            const normalized = normalizeName(categoryName);
            const found = await runInTenantTransaction(this.dataSource, (em) =>
              TenantScopedRepository.forEntity(em, CategoryEntity).findOne({
                where: { normalizedName: normalized },
              }),
            );
            if (!found) throw new Error(`Unknown category: ${categoryName}`);
            categoryId = found.id;
          }
          await this.products.createProduct({
            name,
            categoryId,
            baseUnit: header.includes('baseunit')
              ? col(cells, 'baseunit') || undefined
              : undefined,
            defaultSkuCode: sku,
            defaultBarcode: barcode,
            defaultBasePrice: price,
          });
          created++;
        } catch (error) {
          errors.push({ row: rowNo, message: errorMessage(error) });
        }
      }
      return await this.finish(id, {
        status: 'COMPLETED',
        createdCount: created,
        updatedCount: updated,
        errors,
      });
    } catch (error) {
      return await this.finish(id, {
        status: 'FAILED',
        createdCount: created,
        updatedCount: updated,
        errors: [...errors, { row: 0, message: errorMessage(error) }],
      });
    }
  }
}
