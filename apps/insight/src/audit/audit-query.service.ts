import { Injectable } from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantScopedRepository,
} from '@pbl/common';
import { ListAuditLogsReqDto } from '../insight.dto';
import { AuditLogEntity } from './audit-log.entity';

/** The audit log of the token's store (ADR-0008); it has no branch, so it stays tenant-wide */
@Injectable()
export class AuditQueryService {
  constructor(
    @InjectTenantScopedRepository(AuditLogEntity)
    private readonly audit: TenantScopedRepository<AuditLogEntity>,
  ) {}

  async auditLogs(query: ListAuditLogsReqDto) {
    const [rows, total] = await this.audit.findAndCount({
      where: query.type ? { type: query.type } : {},
      order: { occurredAt: 'DESC' },
      take: query.limit,
      skip: (query.page - 1) * query.limit,
    });
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    return {
      data: rows.map((row) => ({
        id: row.id,
        type: row.type,
        actorId: row.actorId,
        summary: row.summary,
        data: row.data,
        occurredAt: row.occurredAt.toISOString(),
      })),
      pagination: {
        limit: query.limit,
        currentPage: query.page,
        ...(query.page < totalPages ? { nextPage: query.page + 1 } : {}),
        totalRecords: total,
        totalPages,
      },
    };
  }
}
