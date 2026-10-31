import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext } from '@pbl/common';
import { qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import {
  Page,
  Where,
  conflict,
  iso,
  likePattern,
  nextCode,
  notFound,
  num,
  pageOf,
} from '../common/sql';
import { InventoryErrorCode } from '../stock/stock.service';
import {
  CreateSupplierReqDto,
  ListSuppliersReqDto,
  UpdateSupplierReqDto,
} from './supplier.dto';

export interface SupplierRes {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxCode: string | null;
  note: string | null;
  openPurchaseOrderCount: number;
  totalPaid: number;
  debtBalance: number;
  version: number;
  createdAt: string;
}

/** Open = not yet received in full and not cancelled */
export const OPEN_PO_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'partially_received',
];

/** `028 ••• •• 36`: lists show a masked phone, the detail the full number */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 5) return '•••';
  return `${digits.slice(0, 3)} ••• •• ${digits.slice(-2)}`;
}

const SORTS: Record<string, string> = {
  createdAt: 's."created_at"',
  code: 's."code"',
  name: 's."name"',
  debtBalance: 's."debt_balance"',
};

@Injectable()
export class SuppliersService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private t(name: string) {
    return qualifiedTable(this.dataSource, name);
  }

  private map(row: Record<string, unknown>, mask: boolean): SupplierRes {
    return {
      id: row.id as string,
      code: row.code as string,
      name: row.name as string,
      phone: mask
        ? maskPhone(row.phone as string | null)
        : ((row.phone as string) ?? null),
      email: (row.email as string) ?? null,
      address: (row.address as string) ?? null,
      taxCode: (row.tax_code as string) ?? null,
      note: (row.note as string) ?? null,
      openPurchaseOrderCount: num(row.open_count),
      totalPaid: num(row.total_paid),
      debtBalance: num(row.debt_balance),
      version: num(row.version),
      createdAt: iso(row.created_at as Date) as string,
    };
  }

  private select(where: string) {
    return `SELECT s.*, (SELECT count(*) FROM ${this.t('purchase_order')} p
              WHERE p."supplier_id" = s."id" AND p."status" IN (${OPEN_PO_STATUSES.map((s) => `'${s}'`).join(',')})) AS open_count
            FROM ${this.t('supplier')} s ${where}`;
  }

  async create(dto: CreateSupplierReqDto): Promise<SupplierRes> {
    const tenantId = TenantContext.require();
    const id = randomUUID();
    await this.translateDuplicate(() =>
      this.dataSource.transaction(async (em) => {
        const code = await nextCode(
          em,
          tenantId,
          this.t('code_sequence'),
          'supplier',
          'NCC',
          4,
        );
        await em.query(
          `INSERT INTO ${this.t('supplier')} ("id","tenant_id","code","name","phone","email","address","tax_code","note")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            tenantId,
            code,
            dto.name,
            dto.phone ?? null,
            dto.email ?? null,
            dto.address ?? null,
            dto.taxCode ?? null,
            dto.note ?? null,
          ],
        );
      }),
    );
    return this.get(id);
  }

  async get(id: string): Promise<SupplierRes> {
    const rows = await this.dataSource.query(
      this.select(
        `WHERE s."tenant_id" = $1 AND s."id" = $2 AND s."deleted_at" IS NULL`,
      ),
      [TenantContext.require(), id],
    );
    if (!rows.length) throw notFound('Supplier');
    return this.map(rows[0], false);
  }

  async list(query: ListSuppliersReqDto): Promise<Page<SupplierRes>> {
    const where = new Where()
      .add('s."tenant_id" = ?', TenantContext.require())
      .add('s."deleted_at" IS NULL');
    if (query.q) {
      const like = where.param(likePattern(query.q));
      where.add(
        `(s."name" ILIKE ${like} OR s."code" ILIKE ${like} OR s."phone" ILIKE ${like})`,
      );
    }
    const [{ count }] = await this.dataSource.query(
      `SELECT count(*) AS count FROM ${this.t('supplier')} s ${where.sql}`,
      where.params,
    );
    const rows = await this.dataSource.query(
      `${this.select(where.sql)} ORDER BY ${SORTS[query.sort ?? 'createdAt']} ${query.order ?? 'DESC'}, s."id"
       LIMIT ${where.param(query.limit)} OFFSET ${where.param((query.page - 1) * query.limit)}`,
      where.params,
    );
    return pageOf(
      rows.map((r: Record<string, unknown>) => this.map(r, true)),
      Number(count),
      query.page,
      query.limit,
    );
  }

  async update(id: string, dto: UpdateSupplierReqDto): Promise<SupplierRes> {
    const tenantId = TenantContext.require();
    await this.translateDuplicate(() =>
      this.dataSource.transaction(async (em) => {
        const [row] = await em.query(
          `SELECT "version" FROM ${this.t('supplier')} WHERE "tenant_id" = $1 AND "id" = $2 AND "deleted_at" IS NULL FOR UPDATE`,
          [tenantId, id],
        );
        if (!row) throw notFound('Supplier');
        if (dto.version !== undefined && dto.version !== row.version) {
          throw conflict(
            InventoryErrorCode.VERSION_CONFLICT,
            'The supplier was changed by someone else',
          );
        }
        const columns: [keyof UpdateSupplierReqDto, string][] = [
          ['name', 'name'],
          ['phone', 'phone'],
          ['email', 'email'],
          ['address', 'address'],
          ['taxCode', 'tax_code'],
          ['note', 'note'],
        ];
        const sets: string[] = [];
        const params: unknown[] = [tenantId, id];
        for (const [field, column] of columns) {
          if (dto[field] !== undefined) {
            params.push(dto[field]);
            sets.push(`"${column}" = $${params.length}`);
          }
        }
        await em.query(
          `UPDATE ${this.t('supplier')} SET ${[...sets, '"version" = "version" + 1', '"updated_at" = now()'].join(', ')}
           WHERE "tenant_id" = $1 AND "id" = $2`,
          params,
        );
      }),
    );
    return this.get(id);
  }

  /** Soft delete; blocked (409 I011) while the supplier has open orders or debt */
  async remove(id: string): Promise<void> {
    const tenantId = TenantContext.require();
    await this.dataSource.transaction(async (em: EntityManager) => {
      const [row] = await em.query(
        `SELECT "debt_balance" FROM ${this.t('supplier')} WHERE "tenant_id" = $1 AND "id" = $2 AND "deleted_at" IS NULL FOR UPDATE`,
        [tenantId, id],
      );
      if (!row) throw notFound('Supplier');
      const [{ count }] = await em.query(
        `SELECT count(*) AS count FROM ${this.t('purchase_order')}
         WHERE "tenant_id" = $1 AND "supplier_id" = $2 AND "status" IN (${OPEN_PO_STATUSES.map((s) => `'${s}'`).join(',')})`,
        [tenantId, id],
      );
      if (Number(count) > 0 || Number(row.debt_balance) > 0) {
        throw conflict(
          InventoryErrorCode.SUPPLIER_IN_USE,
          'The supplier still has open purchase orders or debt',
        );
      }
      await em.query(
        `UPDATE ${this.t('supplier')} SET "deleted_at" = now(), "updated_at" = now() WHERE "tenant_id" = $1 AND "id" = $2`,
        [tenantId, id],
      );
    });
  }

  private async translateDuplicate<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const driver =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string; constraint?: string })
          : undefined;
      if (
        driver?.code === '23505' &&
        driver.constraint === 'UQ_supplier_tenant_phone'
      ) {
        throw conflict(
          InventoryErrorCode.DUPLICATE_SUPPLIER_PHONE,
          'A supplier with this phone number already exists',
        );
      }
      throw error;
    }
  }
}
