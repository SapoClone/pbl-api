import {
  escapeLike,
  paginate,
  splitScopes,
  toConnectionDetail,
  toSyncHistoryItem,
  toWebhookEventItem,
} from './admin-integration.mapper';

describe('admin integration mapper', () => {
  it('lowercases enums and nests tenant and branch, with null names when no projection row', () => {
    const detail = toConnectionDetail({
      id: 'c1',
      code: 'CON1',
      tenant_id: 't1',
      tenant_name: null,
      branch_id: 'b1',
      branch_name: 'CN1',
      provider: 'SHOPEE',
      external_shop_id: 'S1',
      shop_name: 'Shop',
      status: 'REAUTH_REQUIRED',
      last_sync_at: null,
      last_order_sync_at: null,
      last_inventory_sync_at: null,
      last_error_code: 'E',
      last_error_message: 'm',
      consecutive_failures: 2,
      safety_stock_buffer: 1,
      stock_allocation_percent: 90,
      created_at: '2026-01-01T00:00:00.000Z',
      scopes: 'order, product;inventory',
      access_token_expires_at: '2026-02-01T00:00:00.000Z',
      refresh_token_expires_at: null,
      mapped_skus: '48',
      total_skus: '50',
      jobs_today: '299',
      jobs_failed_today: '3',
    });
    expect(detail).toMatchObject({
      provider: 'shopee',
      status: 'reauth_required',
      tenant: { id: 't1', name: null },
      branch: { id: 'b1', name: 'CN1' },
      shopId: 'S1',
      externalShopId: 'S1',
      scopes: ['order', 'product', 'inventory'],
      tokenExpiresAt: '2026-02-01T00:00:00.000Z',
      refreshTokenExpiresAt: null,
      connectedAt: '2026-01-01T00:00:00.000Z',
      stats: {
        mappedSkus: 48,
        totalSkus: 50,
        jobsToday: 299,
        jobsFailedToday: 3,
      },
    });
    expect(detail).not.toHaveProperty('environment');
  });

  it('maps jobs and webhooks without payload fields', () => {
    const job = toSyncHistoryItem({
      id: 'j',
      code: null,
      connection_id: 'c',
      job_type: 'ORDER_POLL',
      status: 'DEAD_LETTERED',
      attempt_count: 5,
      last_error_code: 'X',
      last_error_message: 'boom',
      started_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      completed_at: null,
    });
    expect(job).toMatchObject({
      jobType: 'order_poll',
      status: 'dead_lettered',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(job).not.toHaveProperty('code');
    const hook = toWebhookEventItem({
      id: 'w',
      connection_id: 'c',
      provider: 'LAZADA',
      event_type: 'order.created',
      external_event_id: 'e',
      processing_status: 'NEEDS_REVIEW',
      last_error: null,
      received_at: '2026-01-01T00:00:00.000Z',
      encrypted_payload: 'SECRET',
    } as never);
    expect(hook.status).toBe('needs_review');
    expect(JSON.stringify(hook)).not.toContain('SECRET');
  });

  it('paginates like the other admin lists', () => {
    expect(paginate([], 2, 20, 45).pagination).toEqual({
      limit: 20,
      currentPage: 2,
      nextPage: 3,
      previousPage: 1,
      totalRecords: 45,
      totalPages: 3,
    });
    expect(paginate([], 1, 20, 0).pagination).toEqual({
      limit: 20,
      currentPage: 1,
      totalRecords: 0,
      totalPages: 1,
    });
  });

  it('splits scopes and escapes LIKE wildcards', () => {
    expect(splitScopes(null)).toEqual([]);
    expect(splitScopes('a b')).toEqual(['a', 'b']);
    expect(escapeLike('50%_x')).toBe('50\\%\\_x');
  });
});
