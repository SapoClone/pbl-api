import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { firstRow, inTenantTx } from '../../common/tenant-tx';
import {
  SalesDomainError,
  SalesDomainErrorCode,
} from '../../domain/sales-domain';
import { getSchemaPrefix } from '../../infrastructure/persistence/sales-code.generator';
import {
  BranchScope,
  assertBranchAllowed,
  branchFilter,
} from '../../presentation/access';
import {
  CreateRegisterDto,
  CreateSalesChannelDto,
  UpdateRegisterDto,
  UpdateSalesChannelDto,
} from './reference.dto';

/** Channels every store starts with (screen contract, `sales-channels`) */
export const SEEDED_CHANNELS: readonly { type: string; name: string }[] = [
  { type: 'pos', name: 'Bán tại quầy (POS)' },
  { type: 'manual', name: 'Tạo đơn thủ công' },
  { type: 'website', name: 'Website' },
  { type: 'facebook', name: 'Facebook' },
  { type: 'zalo', name: 'Zalo' },
  { type: 'phone', name: 'Điện thoại' },
];

/**
 * Providers shown until finance publishes its own (sales only keeps a
 * projection of finance's `ShippingProvider`; nothing feeds it yet).
 */
export const SEEDED_PROVIDERS: readonly {
  code: string;
  name: string;
  type: string;
}[] = [
  { code: 'ghn', name: 'Giao hàng nhanh', type: 'ghn' },
  { type: 'ghtk', code: 'ghtk', name: 'Giao hàng tiết kiệm' },
  { code: 'viettel_post', name: 'Viettel Post', type: 'viettel_post' },
  { code: 'self', name: 'Tự giao hàng', type: 'self' },
];

const DEFAULT_REGISTER = { code: 'Q01', name: 'Quầy 01' };

export interface SalesChannelView {
  id: string;
  type: string;
  name: string;
  status: string;
  environment: string | null;
}

export interface RegisterView {
  id: string;
  branchId: string;
  code: string;
  name: string;
  status: string;
  openShiftId: string | null;
}

function channelView(row: Record<string, unknown>): SalesChannelView {
  return {
    id: String(row.id),
    type: String(row.type),
    name: String(row.name),
    status: String(row.status),
    environment: row.environment ? String(row.environment) : null,
  };
}

/** Inserts the seeded channels when the tenant has none (idempotent) */
export async function ensureChannelsSeeded(
  em: EntityManager,
  tenantId: string,
): Promise<void> {
  const prefix = getSchemaPrefix(em);
  const any = await em.query(
    `SELECT 1 FROM ${prefix}"sales_channels" WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (any.length > 0) return;
  for (const channel of SEEDED_CHANNELS) {
    await em.query(
      `INSERT INTO ${prefix}"sales_channels" (id, tenant_id, type, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, type) WHERE connection_id IS NULL DO NOTHING`,
      [randomUUID(), tenantId, channel.type, channel.name],
    );
  }
}

@Injectable()
export class ReferenceService {
  constructor(private readonly dataSource: DataSource) {}

  async listChannels(): Promise<{ data: SalesChannelView[] }> {
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      await ensureChannelsSeeded(em, tenantId);
      const rows = await em.query(
        `SELECT * FROM ${getSchemaPrefix(em)}"sales_channels"
         WHERE tenant_id = $1 ORDER BY created_at ASC, name ASC`,
        [tenantId],
      );
      return { data: rows.map(channelView) };
    });
  }

  /** A manual channel (no marketplace connection); `type` is unique per store */
  async createChannel(dto: CreateSalesChannelDto): Promise<SalesChannelView> {
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      await ensureChannelsSeeded(em, tenantId);
      try {
        const rows = await em.query(
          `INSERT INTO ${getSchemaPrefix(em)}"sales_channels" (id, tenant_id, type, name)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [randomUUID(), tenantId, dto.type.trim().toLowerCase(), dto.name],
        );
        return channelView(firstRow(rows) as Record<string, unknown>);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new SalesDomainError(
            SalesDomainErrorCode.VALIDATION_ERROR,
            `A channel of type ${dto.type} already exists`,
            409,
          );
        }
        throw error;
      }
    });
  }

  async updateChannel(
    id: string,
    dto: UpdateSalesChannelDto,
  ): Promise<SalesChannelView> {
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      const rows = await em.query(
        `UPDATE ${getSchemaPrefix(em)}"sales_channels"
         SET name = COALESCE($3, name), status = COALESCE($4, status), updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, id, dto.name ?? null, dto.status ?? null],
      );
      const row = firstRow(rows);
      if (!row) {
        throw new SalesDomainError(
          SalesDomainErrorCode.CHANNEL_NOT_FOUND,
          `Sales channel ${id} not found`,
          404,
        );
      }
      return channelView(row);
    });
  }

  async listShippingProviders() {
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      const prefix = getSchemaPrefix(em);
      const any = await em.query(
        `SELECT 1 FROM ${prefix}"shipping_providers" WHERE tenant_id = $1 LIMIT 1`,
        [tenantId],
      );
      if (any.length === 0) {
        for (const p of SEEDED_PROVIDERS) {
          await em.query(
            `INSERT INTO ${prefix}"shipping_providers" (id, tenant_id, code, name, type)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, code) DO NOTHING`,
            [randomUUID(), tenantId, p.code, p.name, p.type],
          );
        }
      }
      const rows = await em.query(
        `SELECT id, name, type, status FROM ${prefix}"shipping_providers"
         WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );
      return {
        data: rows.map((r: Record<string, unknown>) => ({
          id: String(r.id),
          name: String(r.name),
          type: String(r.type),
          status: String(r.status),
        })),
      };
    });
  }

  /** Registers of a branch (404 outside the caller's scope); a branch with none gets `Q01` */
  async listRegisters(
    branchId: string,
    scope: BranchScope,
  ): Promise<{ data: RegisterView[] }> {
    branchFilter(scope, branchId, 'REGISTER_NOT_FOUND', 'Branch not found');
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      const prefix = getSchemaPrefix(em);
      const exists = await em.query(
        `SELECT 1 FROM ${prefix}"registers" WHERE tenant_id = $1 AND branch_id = $2 LIMIT 1`,
        [tenantId, branchId],
      );
      if (exists.length === 0) {
        const branch = await em.query(
          `SELECT 1 FROM ${prefix}"branch_projection"
           WHERE tenant_id = $1 AND branch_id = $2 AND status = 'active' LIMIT 1`,
          [tenantId, branchId],
        );
        if (branch.length === 0) {
          throw new SalesDomainError(
            SalesDomainErrorCode.UNKNOWN_BRANCH,
            `Branch ${branchId} does not exist or is not active`,
            404,
          );
        }
        await em.query(
          `INSERT INTO ${prefix}"registers" (id, tenant_id, branch_id, code, name)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [
            randomUUID(),
            tenantId,
            branchId,
            DEFAULT_REGISTER.code,
            DEFAULT_REGISTER.name,
          ],
        );
      }
      const rows = await em.query(
        `SELECT r.*, (
           SELECT s.id FROM ${prefix}"pos_shifts" s
           WHERE s.tenant_id = r.tenant_id AND s.register_id = r.id AND s.status = 'OPEN'
           ORDER BY s.opened_at DESC LIMIT 1
         ) AS open_shift_id
         FROM ${prefix}"registers" r
         WHERE r.tenant_id = $1 AND r.branch_id = $2 ORDER BY r.code ASC`,
        [tenantId, branchId],
      );
      return { data: rows.map(registerView) };
    });
  }

  async createRegister(
    scope: BranchScope,
    dto: CreateRegisterDto,
  ): Promise<RegisterView> {
    assertBranchAllowed(
      scope,
      dto.branchId,
      'REGISTER_NOT_FOUND',
      'Branch not found',
    );
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      const prefix = getSchemaPrefix(em);
      const branch = await em.query(
        `SELECT 1 FROM ${prefix}"branch_projection"
         WHERE tenant_id = $1 AND branch_id = $2 AND status = 'active' LIMIT 1`,
        [tenantId, dto.branchId],
      );
      if (branch.length === 0) {
        throw new SalesDomainError(
          SalesDomainErrorCode.UNKNOWN_BRANCH,
          `Branch ${dto.branchId} does not exist or is not active`,
          404,
        );
      }
      try {
        const rows = await em.query(
          `INSERT INTO ${prefix}"registers" (id, tenant_id, branch_id, code, name)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [
            randomUUID(),
            tenantId,
            dto.branchId,
            dto.code.trim().toUpperCase(),
            dto.name,
          ],
        );
        return registerView({
          ...(firstRow(rows) as Record<string, unknown>),
          open_shift_id: null,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new SalesDomainError(
            SalesDomainErrorCode.REGISTER_EXISTS,
            `Register ${dto.code} already exists in this branch`,
            409,
          );
        }
        throw error;
      }
    });
  }

  async updateRegister(
    id: string,
    scope: BranchScope,
    dto: UpdateRegisterDto,
  ): Promise<RegisterView> {
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      const prefix = getSchemaPrefix(em);
      const current = await em.query(
        `SELECT branch_id FROM ${prefix}"registers" WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      if (
        current.length === 0 ||
        !scopeAllows(scope, current[0].branch_id as string)
      ) {
        throw new SalesDomainError(
          SalesDomainErrorCode.REGISTER_NOT_FOUND,
          `Register ${id} not found`,
          404,
        );
      }
      const rows = await em.query(
        `UPDATE ${prefix}"registers"
         SET name = COALESCE($3, name), status = COALESCE($4, status), updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, id, dto.name ?? null, dto.status ?? null],
      );
      const open = await em.query(
        `SELECT id FROM ${prefix}"pos_shifts"
         WHERE tenant_id = $1 AND register_id = $2 AND status = 'OPEN'
         ORDER BY opened_at DESC LIMIT 1`,
        [tenantId, id],
      );
      return registerView({
        ...(firstRow(rows) as Record<string, unknown>),
        open_shift_id: open[0]?.id ?? null,
      });
    });
  }
}

function scopeAllows(scope: BranchScope, branchId: string): boolean {
  return scope === null || scope.includes(branchId);
}

function registerView(row: Record<string, unknown>): RegisterView {
  return {
    id: String(row.id),
    branchId: String(row.branch_id),
    code: String(row.code),
    name: String(row.name),
    status: String(row.status),
    openShiftId: row.open_shift_id ? String(row.open_shift_id) : null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string })?.code === '23505'
  );
}
