import { Injectable } from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantScopedRepository,
} from '@pbl/common';
import { randomUUID } from 'crypto';
import { SalesChannelEntity } from './sales-channel.entity';
import { ShippingProviderEntity } from './shipping-provider.entity';

/** `code` doubles as `type` for the built-in channels; marketplaces add their own later */
export const DEFAULT_CHANNELS = [
  { code: 'pos', name: 'POS tại quầy' },
  { code: 'manual', name: 'Đơn thủ công' },
  { code: 'website', name: 'Website / API' },
  { code: 'facebook', name: 'Facebook' },
  { code: 'zalo', name: 'Zalo' },
  { code: 'phone', name: 'Điện thoại' },
] as const;

export const DEFAULT_PROVIDERS = [
  { code: 'ghn', name: 'Giao hàng nhanh' },
  { code: 'ghtk', name: 'Giao hàng tiết kiệm' },
  { code: 'viettel_post', name: 'Viettel Post' },
  { code: 'jt_express', name: 'J&T Express' },
  { code: 'self_delivery', name: 'Tự giao hàng' },
] as const;

export interface ReferenceRes {
  id: string;
  code: string;
  type: string;
  name: string;
  status: string;
}

const isUnique = (error: unknown) =>
  (error as { driverError?: { code?: string } })?.driverError?.code === '23505';

/**
 * Sales channels and shipping providers: read-only for now, created for a
 * tenant on its first read (a concurrent first read loses the unique index and
 * simply reads what the winner wrote).
 */
@Injectable()
export class ReferenceService {
  constructor(
    @InjectTenantScopedRepository(SalesChannelEntity)
    private readonly channels: TenantScopedRepository<SalesChannelEntity>,
    @InjectTenantScopedRepository(ShippingProviderEntity)
    private readonly providers: TenantScopedRepository<ShippingProviderEntity>,
  ) {}

  async listChannels(): Promise<{ data: ReferenceRes[] }> {
    const rows = await this.seeded(this.channels, DEFAULT_CHANNELS, (row) =>
      Object.assign(new SalesChannelEntity(), row),
    );
    return { data: rows.map(toRes) };
  }

  async listProviders(): Promise<{ data: ReferenceRes[] }> {
    const rows = await this.seeded(this.providers, DEFAULT_PROVIDERS, (row) =>
      Object.assign(new ShippingProviderEntity(), row),
    );
    return { data: rows.map(toRes) };
  }

  private async seeded<T extends SalesChannelEntity | ShippingProviderEntity>(
    repo: TenantScopedRepository<T>,
    defaults: readonly { code: string; name: string }[],
    build: (row: Partial<T>) => T,
  ): Promise<T[]> {
    let rows = await repo.find();
    const have = new Set(rows.map((r) => r.code));
    const missing = defaults.filter((d) => !have.has(d.code));
    if (missing.length > 0) {
      try {
        await repo.save(
          missing.map((d) =>
            build({
              id: randomUUID(),
              code: d.code,
              type: d.code,
              name: d.name,
              status: 'active',
            } as unknown as Partial<T>),
          ),
        );
      } catch (error) {
        if (!isUnique(error)) throw error;
      }
      rows = await repo.find();
    }
    const rank = (code: string) => {
      const i = defaults.findIndex((d) => d.code === code);
      return i < 0 ? defaults.length : i;
    };
    return rows.sort((a, b) => rank(a.code) - rank(b.code));
  }
}

function toRes(row: SalesChannelEntity | ShippingProviderEntity): ReferenceRes {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    name: row.name,
    status: row.status,
  };
}
