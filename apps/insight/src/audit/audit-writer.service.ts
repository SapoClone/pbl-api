import { Injectable } from '@nestjs/common';

export interface AuditEntry {
  occurredAt?: Date;
  scope: 'platform' | 'tenant';
  tenantId?: string | null;
  actor: {
    type: 'platform_admin' | 'member' | 'system';
    id?: string | null;
    name?: string | null;
  };
  action: string;
  target?: { type: string; id?: string | null; name?: string | null };
  result: 'success' | 'failed';
  errorCode?: string | null;
  errorMessage?: string | null;
  data?: Record<string, unknown>;
}

/**
 * STUB: replaced by the file of feat/admin-audit-log at merge. The interface is the one agreed between the two
 * branches; this version records nothing.
 */
@Injectable()
export class AuditWriter {
  // TODO: replaced by feat/admin-audit-log
  async record(entry: AuditEntry): Promise<void> {
    void entry;
  }
}
