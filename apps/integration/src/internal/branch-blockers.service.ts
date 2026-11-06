import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { BLOCKERS_SAMPLE_LIMIT, BranchBlockersResponse } from '@pbl/contracts';
import { DataSource, In } from 'typeorm';
import { ConnectionStatus } from '../domain/integration-domain';
import { ChannelConnectionEntity } from '../infrastructure/persistence/integration.entities';

/**
 * A connection in one of these states is still bound to the branch: it can pull
 * orders or push stock for it, or is paused/awaiting re-authorisation and can be
 * resumed. `PENDING_AUTH` (never authorised) and `DISCONNECTED` are not live.
 */
export const LIVE_CONNECTION_STATUSES: ConnectionStatus[] = [
  'CONNECTED',
  'DEGRADED',
  'TOKEN_EXPIRED',
  'REAUTH_REQUIRED',
  'PAUSED',
];

/** D4: live channel connections bound to the branch block deactivation and deletion */
@Injectable()
export class BranchBlockersService {
  constructor(private readonly dataSource: DataSource) {}

  async forBranch(branchId: string): Promise<BranchBlockersResponse> {
    const tenantId = TenantContext.require();
    const rows = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return em.find(ChannelConnectionEntity, {
        where: {
          tenantId,
          branchId,
          status: In(LIVE_CONNECTION_STATUSES),
        },
        select: { id: true, code: true, shopName: true },
      });
    });
    if (rows.length === 0) return { reasons: [] };
    return {
      reasons: [
        {
          code: 'INTEGRATION_LIVE_CONNECTIONS',
          message: `Chi nhánh còn ${rows.length} kết nối sàn thương mại điện tử đang hoạt động`,
          count: rows.length,
          samples: rows
            .slice(0, BLOCKERS_SAMPLE_LIMIT)
            .map((r) => `${r.code} (${r.shopName})`),
        },
      ],
    };
  }
}
