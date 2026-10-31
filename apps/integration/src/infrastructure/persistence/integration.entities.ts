import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { moneyTransformer } from '../../common/money';
import type {
  ChannelOrderSyncStatus,
  ConnectionStatus,
  ListingSyncStatus,
  MarketplaceProvider,
  NormalizedExternalOrderStatus,
  SkuMappingStatus,
  SyncConflictType,
  SyncJobStatus,
  SyncJobType,
  WebhookProcessingStatus,
} from '../../domain/integration-domain';

@Entity('integration_code_sequence')
export class IntegrationCodeSequenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'seq_key', type: 'varchar', length: 64 })
  seqKey!: string;

  @Column({ name: 'last_value', type: 'bigint', default: 0 })
  lastValue!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('integration_catalog_variants')
export class IntegrationCatalogVariantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'variant_id', type: 'uuid' })
  variantId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'sku_code', type: 'varchar', length: 64 })
  skuCode!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  barcode!: string | null;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({
    name: 'base_price',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  basePrice!: number;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

  @Column({ name: 'aggregate_version', type: 'int', default: 1 })
  aggregateVersion!: number;

  @Column({
    name: 'source_updated_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  sourceUpdatedAt!: Date;

  @Column({ name: 'synced_at', type: 'timestamptz', default: () => 'now()' })
  syncedAt!: Date;
}

@Entity('integration_stock_projections')
export class IntegrationStockProjectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ name: 'sku_id', type: 'varchar', length: 128 })
  skuId!: string;

  @Column({
    name: 'on_hand_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: 0,
  })
  onHandQty!: string;

  @Column({
    name: 'reserved_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: 0,
  })
  reservedQty!: string;

  @Column({ name: 'available_qty', type: 'int', default: 0 })
  availableQty!: number;

  @Column({ name: 'stock_version', type: 'bigint', default: 1 })
  stockVersion!: string;

  @Column({
    name: 'source_occurred_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  sourceOccurredAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('channel_connections')
export class ChannelConnectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ type: 'varchar', length: 24 })
  provider!: MarketplaceProvider;

  @Column({ name: 'connection_key', type: 'varchar', length: 64 })
  connectionKey!: string;

  @Column({ name: 'external_shop_id', type: 'varchar', length: 128 })
  externalShopId!: string;

  @Column({ name: 'shop_name', type: 'varchar', length: 160 })
  shopName!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'PENDING_AUTH' })
  status!: ConnectionStatus;

  @Column({ name: 'safety_stock_buffer', type: 'int', default: 0 })
  safetyStockBuffer!: number;

  @Column({ name: 'stock_allocation_percent', type: 'int', default: 100 })
  stockAllocationPercent!: number;

  @Column({
    name: 'oauth_state_nonce',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  oauthStateNonce!: string | null;

  @Column({
    name: 'oauth_redirect_uri',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  oauthRedirectUri!: string | null;

  @Column({
    name: 'oauth_initiated_by',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  oauthInitiatedBy!: string | null;

  @Column({ name: 'last_sync_at', type: 'timestamptz', nullable: true })
  lastSyncAt!: Date | null;

  @Column({ name: 'last_order_sync_at', type: 'timestamptz', nullable: true })
  lastOrderSyncAt!: Date | null;

  @Column({
    name: 'last_inventory_sync_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastInventorySyncAt!: Date | null;

  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  lastErrorCode!: string | null;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  consecutiveFailures!: number;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'created_by', type: 'varchar', length: 64 })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('connection_credentials')
export class ConnectionCredentialEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ name: 'credential_version', type: 'int', default: 1 })
  credentialVersion!: number;

  @Column({ name: 'encrypted_access_token', type: 'text', nullable: true })
  encryptedAccessToken!: string | null;

  @Column({ name: 'encrypted_refresh_token', type: 'text', nullable: true })
  encryptedRefreshToken!: string | null;

  @Column({ name: 'encrypted_webhook_secret', type: 'text' })
  encryptedWebhookSecret!: string;

  @Column({ name: 'partner_id', type: 'varchar', length: 128, nullable: true })
  partnerId!: string | null;

  @Column({ name: 'key_version', type: 'int', default: 1 })
  keyVersion!: number;

  @Column({
    name: 'access_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  accessTokenExpiresAt!: Date | null;

  @Column({
    name: 'refresh_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  refreshTokenExpiresAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  scopes!: string | null;

  @Column({
    name: 'refresh_lease_owner',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  refreshLeaseOwner!: string | null;

  @Column({
    name: 'refresh_lease_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  refreshLeaseExpiresAt!: Date | null;

  @Column({ name: 'last_refreshed_at', type: 'timestamptz', nullable: true })
  lastRefreshedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('webhook_inbox_events')
export class WebhookInboxEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 24 })
  provider!: MarketplaceProvider;

  @Column({ name: 'external_event_id', type: 'varchar', length: 128 })
  externalEventId!: string;

  @Column({ name: 'deduplication_key', type: 'varchar', length: 190 })
  deduplicationKey!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType!: string;

  @Column({ name: 'external_shop_id', type: 'varchar', length: 128 })
  externalShopId!: string;

  @Column({
    name: 'external_order_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  externalOrderId!: string | null;

  @Column({ name: 'payload_hash', type: 'varchar', length: 64 })
  payloadHash!: string;

  @Column({ name: 'encrypted_payload', type: 'text' })
  encryptedPayload!: string;

  @Column({ name: 'provider_event_time', type: 'timestamptz' })
  providerEventTime!: Date;

  @Column({
    name: 'processing_status',
    type: 'varchar',
    length: 24,
    default: 'RECEIVED',
  })
  processingStatus!: WebhookProcessingStatus;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({
    name: 'last_error_category',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  lastErrorCategory!: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}

@Entity('sku_mappings')
export class SkuMappingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 24 })
  provider!: MarketplaceProvider;

  @Column({ name: 'external_item_id', type: 'varchar', length: 128 })
  externalItemId!: string;

  @Column({ name: 'external_sku_id', type: 'varchar', length: 128 })
  externalSkuId!: string;

  @Column({
    name: 'external_sku_code',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  externalSkuCode!: string | null;

  @Column({
    name: 'external_product_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  externalProductName!: string | null;

  @Column({ name: 'internal_product_id', type: 'uuid', nullable: true })
  internalProductId!: string | null;

  @Column({ name: 'internal_variant_id', type: 'uuid' })
  internalVariantId!: string;

  @Column({ name: 'internal_sku_code', type: 'varchar', length: 64 })
  internalSkuCode!: string;

  @Column({
    name: 'mapping_mode',
    type: 'varchar',
    length: 24,
    default: 'MANUAL',
  })
  mappingMode!: 'MANUAL' | 'EXACT_SKU_AUTO';

  @Column({ name: 'mapping_version', type: 'int', default: 1 })
  mappingVersion!: number;

  @Column({ type: 'varchar', length: 24, default: 'ACTIVE' })
  status!: SkuMappingStatus;

  @Column({
    name: 'listing_sync_status',
    type: 'varchar',
    length: 24,
    default: 'MAPPED',
  })
  listingSyncStatus!: ListingSyncStatus;

  @Column({
    name: 'external_price',
    type: 'bigint',
    nullable: true,
    transformer: moneyTransformer,
  })
  externalPrice!: number | null;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64 })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'varchar', length: 64 })
  updatedBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('channel_order_refs')
export class ChannelOrderRefEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 24 })
  provider!: MarketplaceProvider;

  @Column({ name: 'external_shop_id', type: 'varchar', length: 128 })
  externalShopId!: string;

  @Column({ name: 'external_order_id', type: 'varchar', length: 128 })
  externalOrderId!: string;

  @Column({ name: 'internal_order_id', type: 'uuid', nullable: true })
  internalOrderId!: string | null;

  @Column({
    name: 'internal_order_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  internalOrderCode!: string | null;

  @Column({
    name: 'sync_status',
    type: 'varchar',
    length: 24,
    default: 'RECEIVED',
  })
  syncStatus!: ChannelOrderSyncStatus;

  @Column({ name: 'external_status', type: 'varchar', length: 48 })
  externalStatus!: string;

  @Column({ name: 'normalized_status', type: 'varchar', length: 32 })
  normalizedStatus!: NormalizedExternalOrderStatus;

  @Column({ name: 'status_rank', type: 'int', default: 10 })
  statusRank!: number;

  @Column({
    name: 'external_updated_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  externalUpdatedAt!: Date;

  @Column({ name: 'buyer_name', type: 'varchar', length: 160, nullable: true })
  buyerName!: string | null;

  @Column({ type: 'varchar', length: 8, default: 'VND' })
  currency!: string;

  @Column({
    name: 'total_amount',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  totalAmount!: number;

  @Column({
    name: 'shipping_fee',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  shippingFee!: number;

  @Column({
    name: 'payment_method',
    type: 'varchar',
    length: 32,
    default: 'COD',
  })
  paymentMethod!: string;

  @Column({ name: 'raw_order_snapshot', type: 'jsonb' })
  rawOrderSnapshot!: Record<string, unknown>;

  @Column({ name: 'mapping_snapshot', type: 'jsonb', nullable: true })
  mappingSnapshot!: Record<string, unknown> | null;

  @Column({ name: 'shortage_details', type: 'jsonb', nullable: true })
  shortageDetails!: Record<string, unknown> | null;

  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  lastErrorCode!: string | null;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({
    name: 'last_synced_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastSyncedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('channel_inventory_publications')
export class ChannelInventoryPublicationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 24 })
  provider!: MarketplaceProvider;

  @Column({ name: 'mapping_id', type: 'uuid' })
  mappingId!: string;

  @Column({ name: 'internal_variant_id', type: 'uuid' })
  internalVariantId!: string;

  @Column({ name: 'external_item_id', type: 'varchar', length: 128 })
  externalItemId!: string;

  @Column({ name: 'external_sku_id', type: 'varchar', length: 128 })
  externalSkuId!: string;

  @Column({ name: 'available_qty_snapshot', type: 'int', default: 0 })
  availableQtySnapshot!: number;

  @Column({ name: 'safety_buffer_snapshot', type: 'int', default: 0 })
  safetyBufferSnapshot!: number;

  @Column({ name: 'allocation_percent_snapshot', type: 'int', default: 100 })
  allocationPercentSnapshot!: number;

  @Column({ name: 'target_published_qty', type: 'int', default: 0 })
  targetPublishedQty!: number;

  @Column({ name: 'last_confirmed_qty', type: 'int', nullable: true })
  lastConfirmedQty!: number | null;

  @Column({ name: 'stock_version', type: 'bigint', default: 1 })
  stockVersion!: string;

  @Column({ name: 'last_published_stock_version', type: 'bigint', default: 0 })
  lastPublishedStockVersion!: string;

  @Column({ type: 'varchar', length: 24, default: 'PENDING' })
  status!:
    | 'PENDING'
    | 'PUBLISHING'
    | 'SUCCEEDED'
    | 'STALE_SKIPPED'
    | 'FAILED'
    | 'UNKNOWN_OUTCOME';

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({
    name: 'provider_request_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  providerRequestId!: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('sync_jobs')
export class SyncJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  connectionId!: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  provider!: MarketplaceProvider | null;

  @Column({ name: 'job_type', type: 'varchar', length: 40 })
  jobType!: SyncJobType;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 190 })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 24, default: 'PENDING' })
  status!: SyncJobStatus;

  @Column({ type: 'int', default: 10 })
  priority!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: 'result_summary', type: 'jsonb', nullable: true })
  resultSummary!: Record<string, unknown> | null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ name: 'max_attempts', type: 'int', default: 5 })
  maxAttempts!: number;

  @Column({
    name: 'next_retry_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  nextRetryAt!: Date;

  @Column({ name: 'lease_owner', type: 'varchar', length: 128, nullable: true })
  leaseOwner!: string | null;

  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({
    name: 'error_category',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  errorCategory!: string | null;

  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  lastErrorCode!: string | null;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @Column({
    name: 'correlation_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  correlationId!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('sync_cursors')
export class SyncCursorEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 24 })
  provider!: MarketplaceProvider;

  @Column({ name: 'cursor_type', type: 'varchar', length: 40 })
  cursorType!: string;

  @Column({
    name: 'cursor_value',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  cursorValue!: string | null;

  @Column({ name: 'window_start', type: 'timestamptz', nullable: true })
  windowStart!: Date | null;

  @Column({ name: 'window_end', type: 'timestamptz', nullable: true })
  windowEnd!: Date | null;

  @Column({
    name: 'last_synced_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastSyncedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('sync_conflicts')
export class SyncConflictEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 24 })
  provider!: MarketplaceProvider;

  @Column({ name: 'conflict_type', type: 'varchar', length: 48 })
  conflictType!: SyncConflictType;

  @Column({ type: 'varchar', length: 16, default: 'HIGH' })
  severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @Column({ type: 'varchar', length: 16, default: 'OPEN' })
  status!: 'OPEN' | 'RESOLVED' | 'IGNORED';

  @Column({
    name: 'external_order_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  externalOrderId!: string | null;

  @Column({
    name: 'external_item_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  externalItemId!: string | null;

  @Column({
    name: 'external_sku_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  externalSkuId!: string | null;

  @Column({ name: 'channel_order_ref_id', type: 'uuid', nullable: true })
  channelOrderRefId!: string | null;

  @Column({ name: 'sync_job_id', type: 'uuid', nullable: true })
  syncJobId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  details!: Record<string, unknown>;

  @Column({
    name: 'resolution_action',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  resolutionAction!: string | null;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes!: string | null;

  @Column({ name: 'resolved_by', type: 'varchar', length: 64, nullable: true })
  resolvedBy!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('integration_dead_letter_events')
export class IntegrationDeadLetterEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  connectionId!: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  provider!: MarketplaceProvider | null;

  @Column({ name: 'source_type', type: 'varchar', length: 32 })
  sourceType!: 'WEBHOOK_INBOX' | 'SYNC_JOB';

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 190 })
  idempotencyKey!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: 'error_category', type: 'varchar', length: 32 })
  errorCategory!: string;

  @Column({ name: 'error_code', type: 'varchar', length: 64 })
  errorCode!: string;

  @Column({ name: 'error_message', type: 'text' })
  errorMessage!: string;

  @Column({ name: 'attempt_count', type: 'int', default: 1 })
  attemptCount!: number;

  @Column({ type: 'varchar', length: 24, default: 'DEAD_LETTERED' })
  status!: 'DEAD_LETTERED' | 'REPLAYED' | 'DISCARDED';

  @Column({ name: 'replayed_by', type: 'varchar', length: 64, nullable: true })
  replayedBy!: string | null;

  @Column({ name: 'replayed_at', type: 'timestamptz', nullable: true })
  replayedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('provider_request_logs')
export class ProviderRequestLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  connectionId!: string | null;

  @Column({ type: 'varchar', length: 24 })
  provider!: MarketplaceProvider;

  @Column({ type: 'varchar', length: 64 })
  operation!: string;

  @Column({ type: 'varchar', length: 255 })
  endpoint!: string;

  @Column({ name: 'http_status', type: 'int' })
  httpStatus!: number;

  @Column({ type: 'varchar', length: 32 })
  outcome!: string;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs!: number;

  @Column({ name: 'rate_limited', type: 'boolean', default: false })
  rateLimited!: boolean;

  @Column({ name: 'retry_after_seconds', type: 'int', nullable: true })
  retryAfterSeconds!: number | null;

  @Column({
    name: 'correlation_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  correlationId!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  errorCode!: string | null;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}

@Entity('reconciliation_runs')
export class IntegrationReconciliationRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  connectionId!: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  provider!: MarketplaceProvider | null;

  @Column({
    name: 'run_type',
    type: 'varchar',
    length: 32,
    default: 'INCREMENTAL',
  })
  runType!:
    | 'INCREMENTAL'
    | 'FULL'
    | 'ORDER_VERIFICATION'
    | 'INVENTORY_VERIFICATION';

  @Column({ type: 'varchar', length: 24, default: 'RUNNING' })
  status!: 'RUNNING' | 'COMPLETED' | 'FAILED';

  @Column({ name: 'window_start', type: 'timestamptz', nullable: true })
  windowStart!: Date | null;

  @Column({ name: 'window_end', type: 'timestamptz', nullable: true })
  windowEnd!: Date | null;

  @Column({ name: 'records_examined', type: 'int', default: 0 })
  recordsExamined!: number;

  @Column({ name: 'matched_count', type: 'int', default: 0 })
  matchedCount!: number;

  @Column({ name: 'mismatch_count', type: 'int', default: 0 })
  mismatchCount!: number;

  @Column({ name: 'auto_recovered_count', type: 'int', default: 0 })
  autoRecoveredCount!: number;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'triggered_by', type: 'varchar', length: 64 })
  triggeredBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('reconciliation_issues')
export class IntegrationReconciliationIssueEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  connectionId!: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  provider!: MarketplaceProvider | null;

  @Column({ name: 'issue_type', type: 'varchar', length: 48 })
  issueType!: string;

  @Column({ type: 'varchar', length: 16, default: 'HIGH' })
  severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @Column({
    name: 'external_ref',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  externalRef!: string | null;

  @Column({
    name: 'internal_ref',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  internalRef!: string | null;

  @Column({ name: 'expected_state', type: 'jsonb', nullable: true })
  expectedState!: Record<string, unknown> | null;

  @Column({ name: 'observed_state', type: 'jsonb', nullable: true })
  observedState!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 24, default: 'OPEN' })
  status!: 'OPEN' | 'RESOLVED' | 'IGNORED';

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes!: string | null;

  @Column({ name: 'resolved_by', type: 'varchar', length: 64, nullable: true })
  resolvedBy!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'related_sync_job_id', type: 'uuid', nullable: true })
  relatedSyncJobId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('integration_audit_logs')
export class IntegrationAuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  connectionId!: string | null;

  @Column({ name: 'actor_id', type: 'varchar', length: 64 })
  actorId!: string;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 48 })
  targetType!: string;

  @Column({ name: 'target_id', type: 'varchar', length: 128 })
  targetId!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}

export const M6_INTEGRATION_ENTITIES = [
  IntegrationCodeSequenceEntity,
  IntegrationCatalogVariantEntity,
  IntegrationStockProjectionEntity,
  ChannelConnectionEntity,
  ConnectionCredentialEntity,
  WebhookInboxEventEntity,
  SkuMappingEntity,
  ChannelOrderRefEntity,
  ChannelInventoryPublicationEntity,
  SyncJobEntity,
  SyncCursorEntity,
  SyncConflictEntity,
  IntegrationDeadLetterEventEntity,
  ProviderRequestLogEntity,
  IntegrationReconciliationRunEntity,
  IntegrationReconciliationIssueEntity,
  IntegrationAuditLogEntity,
];
