import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext } from '@pbl/common';
import { qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

/** Push tokens of an account's devices (sending pushes is deferred) */
@Injectable()
export class DeviceTokensService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Upsert per account and token: registering again only updates the platform */
  async register(accountId: string, token: string, platform: string) {
    const [row] = await this.dataSource.query(
      `INSERT INTO ${qualifiedTable(this.dataSource, 'device_token')}
         ("id", "tenant_id", "account_id", "token", "platform")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("tenant_id", "account_id", "token")
       DO UPDATE SET "platform" = EXCLUDED."platform", "updated_at" = now()
       RETURNING "created_at"`,
      [randomUUID(), TenantContext.require(), accountId, token, platform],
    );
    return {
      token,
      platform,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  /** Idempotent: removing an unknown token succeeds */
  async remove(accountId: string, token: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM ${qualifiedTable(this.dataSource, 'device_token')}
        WHERE "tenant_id" = $1 AND "account_id" = $2 AND "token" = $3`,
      [TenantContext.require(), accountId, token],
    );
  }
}
