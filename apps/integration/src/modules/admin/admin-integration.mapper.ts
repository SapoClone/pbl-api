/**
 * Pure mapping of stored rows to the admin API shapes (lowercase snake_case enums, never a secret). The store-side API
 * keeps its upper-case codes; the admin API follows the convention for new enums.
 */

export const CONNECTION_STATUSES = [
  'pending_auth',
  'connected',
  'degraded',
  'token_expired',
  'reauth_required',
  'paused',
  'disconnected',
] as const;
export type AdminConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const PROVIDERS = ['shopee', 'lazada'] as const;

export const JOB_STATUSES = [
  'pending',
  'running',
  'retry_scheduled',
  'completed',
  'failed_permanent',
  'cancelled',
  'needs_review',
  'dead_lettered',
] as const;

export const JOB_TYPES = [
  'order_import',
  'order_poll',
  'order_status_sync',
  'inventory_publication',
  'product_mapping_sync',
  'product_publication',
  'connection_token_refresh',
  'full_reconciliation',
  'incremental_reconciliation',
] as const;

export const WEBHOOK_STATUSES = [
  'received',
  'validated',
  'processing',
  'processed',
  'needs_review',
  'retry_pending',
  'dead_lettered',
] as const;

/** job statuses that count as a failure in `jobsFailedToday` */
export const FAILED_JOB_STATUSES = ['FAILED_PERMANENT', 'DEAD_LETTERED'];

export const lower = (value: string): string => value.toLowerCase();
export const upper = (value: string): string => value.toUpperCase();

const iso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

/** `scopes` is stored as one string; accept comma, space or semicolon separated */
export function splitScopes(scopes: string | null | undefined): string[] {
  if (!scopes) return [];
  return scopes
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface ConnectionRow {
  id: string;
  code: string;
  tenant_id: string;
  tenant_name: string | null;
  branch_id: string;
  branch_name: string | null;
  provider: string;
  external_shop_id: string;
  shop_name: string;
  status: string;
  last_sync_at: Date | string | null;
}

export function toConnectionItem(row: ConnectionRow) {
  return {
    id: row.id,
    code: row.code,
    tenant: { id: row.tenant_id, name: row.tenant_name },
    branch: { id: row.branch_id, name: row.branch_name },
    provider: lower(row.provider),
    shopId: row.external_shop_id,
    shopName: row.shop_name,
    status: lower(row.status),
    lastSyncAt: iso(row.last_sync_at),
  };
}

export interface ConnectionDetailRow extends ConnectionRow {
  last_order_sync_at: Date | string | null;
  last_inventory_sync_at: Date | string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  consecutive_failures: number;
  safety_stock_buffer: number;
  stock_allocation_percent: number;
  created_at: Date | string;
  scopes: string | null;
  access_token_expires_at: Date | string | null;
  refresh_token_expires_at: Date | string | null;
  mapped_skus: string | number;
  total_skus: string | number;
  jobs_today: string | number;
  jobs_failed_today: string | number;
}

export function toConnectionDetail(row: ConnectionDetailRow) {
  return {
    ...toConnectionItem(row),
    externalShopId: row.external_shop_id,
    scopes: splitScopes(row.scopes),
    tokenExpiresAt: iso(row.access_token_expires_at),
    refreshTokenExpiresAt: iso(row.refresh_token_expires_at),
    lastOrderSyncAt: iso(row.last_order_sync_at),
    lastInventorySyncAt: iso(row.last_inventory_sync_at),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    consecutiveFailures: row.consecutive_failures,
    safetyStockBuffer: row.safety_stock_buffer,
    stockAllocationPercent: row.stock_allocation_percent,
    connectedAt: iso(row.created_at),
    stats: {
      mappedSkus: Number(row.mapped_skus),
      totalSkus: Number(row.total_skus),
      jobsToday: Number(row.jobs_today),
      jobsFailedToday: Number(row.jobs_failed_today),
    },
  };
}

export interface SyncJobRow {
  id: string;
  code: string | null;
  connection_id: string | null;
  job_type: string;
  status: string;
  attempt_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  started_at: Date | string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
}

export function toSyncHistoryItem(row: SyncJobRow) {
  return {
    id: row.id,
    ...(row.code ? { code: row.code } : {}),
    connectionId: row.connection_id,
    jobType: lower(row.job_type),
    status: lower(row.status),
    attemptCount: row.attempt_count,
    errorCode: row.last_error_code,
    errorMessage: row.last_error_message,
    startedAt: iso(row.started_at) ?? iso(row.created_at),
    createdAt: iso(row.created_at),
    finishedAt: iso(row.completed_at),
  };
}

export interface WebhookRow {
  id: string;
  connection_id: string;
  provider: string;
  event_type: string;
  external_event_id: string;
  processing_status: string;
  last_error: string | null;
  received_at: Date | string;
}

export function toWebhookEventItem(row: WebhookRow) {
  return {
    id: row.id,
    connectionId: row.connection_id,
    provider: lower(row.provider),
    eventType: row.event_type,
    externalEventId: row.external_event_id,
    status: lower(row.processing_status),
    errorMessage: row.last_error,
    receivedAt: iso(row.received_at),
  };
}

/** The list envelope of the platform admin API */
export function paginate<T>(
  data: T[],
  page: number,
  limit: number,
  totalRecords: number,
) {
  const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
  return {
    data,
    pagination: {
      limit,
      currentPage: page,
      ...(page < totalPages ? { nextPage: page + 1 } : {}),
      ...(page > 1 ? { previousPage: page - 1 } : {}),
      totalRecords,
      totalPages,
    },
  };
}

/** `%` and `_` typed by the admin match literally in a LIKE */
export const escapeLike = (value: string): string =>
  value.replace(/[\\%_]/g, (c) => `\\${c}`);
