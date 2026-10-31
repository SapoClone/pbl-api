import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateM6IntegrationCore1791900000200
  implements MigrationInterface
{
  name = 'CreateM6IntegrationCore1791900000200';

  async up(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);

    const codeSeq = t('integration_code_sequence');
    const catalogVariants = t('integration_catalog_variants');
    const stockProjections = t('integration_stock_projections');
    const connections = t('channel_connections');
    const credentials = t('connection_credentials');
    const webhookInbox = t('webhook_inbox_events');
    const skuMappings = t('sku_mappings');
    const orderRefs = t('channel_order_refs');
    const inventoryPubs = t('channel_inventory_publications');
    const syncJobs = t('sync_jobs');
    const syncCursors = t('sync_cursors');
    const syncConflicts = t('sync_conflicts');
    const dlqEvents = t('integration_dead_letter_events');
    const providerLogs = t('provider_request_logs');
    const reconRuns = t('reconciliation_runs');
    const reconIssues = t('reconciliation_issues');
    const auditLogs = t('integration_audit_logs');

    // 1. Atomic tenant-scoped sequence counter
    await queryRunner.query(`
      CREATE TABLE ${codeSeq} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "seq_key" character varying(64) NOT NULL,
        "last_value" bigint NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_code_sequence_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_integration_code_sequence_tenant_key" UNIQUE ("tenant_id", "seq_key")
      )
    `);
    await enableTenantRlsPolicy(queryRunner, codeSeq);

    // 2. Catalog Variant Read Projection (populated from catalog.variant.* events)
    await queryRunner.query(`
      CREATE TABLE ${catalogVariants} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "variant_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "sku_code" character varying(64) NOT NULL,
        "barcode" character varying(64) NULL,
        "name" character varying(255) NOT NULL,
        "base_price" bigint NOT NULL DEFAULT 0,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "aggregate_version" integer NOT NULL DEFAULT 1,
        "source_updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "synced_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_catalog_variants_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_integration_catalog_variants_tenant_variant" UNIQUE ("tenant_id", "variant_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_integration_catalog_variants_tenant_sku"
        ON ${catalogVariants} ("tenant_id", "sku_code")
    `);
    await enableTenantRlsPolicy(queryRunner, catalogVariants);

    // 3. Inventory Stock Availability Read Projection (populated from inventory.stock.changed)
    await queryRunner.query(`
      CREATE TABLE ${stockProjections} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "sku_id" character varying(128) NOT NULL,
        "on_hand_qty" numeric(18,3) NOT NULL DEFAULT 0,
        "reserved_qty" numeric(18,3) NOT NULL DEFAULT 0,
        "available_qty" integer NOT NULL DEFAULT 0,
        "stock_version" bigint NOT NULL DEFAULT 1,
        "source_occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_stock_projections_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_integration_stock_projections_wh_sku" UNIQUE ("tenant_id", "warehouse_id", "sku_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_integration_stock_projections_tenant_sku"
        ON ${stockProjections} ("tenant_id", "sku_id")
    `);
    await enableTenantRlsPolicy(queryRunner, stockProjections);

    // 4. Channel Connections
    await queryRunner.query(`
      CREATE TABLE ${connections} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "provider" character varying(24) NOT NULL,
        "connection_key" character varying(64) NOT NULL,
        "external_shop_id" character varying(128) NOT NULL,
        "shop_name" character varying(160) NOT NULL,
        "branch_id" uuid NOT NULL,
        "warehouse_id" uuid NULL,
        "status" character varying(24) NOT NULL DEFAULT 'PENDING_AUTH',
        "safety_stock_buffer" integer NOT NULL DEFAULT 0,
        "stock_allocation_percent" integer NOT NULL DEFAULT 100,
        "oauth_state_nonce" character varying(128) NULL,
        "oauth_redirect_uri" character varying(500) NULL,
        "oauth_initiated_by" character varying(64) NULL,
        "last_sync_at" TIMESTAMPTZ NULL,
        "last_order_sync_at" TIMESTAMPTZ NULL,
        "last_inventory_sync_at" TIMESTAMPTZ NULL,
        "last_error_code" character varying(64) NULL,
        "last_error_message" text NULL,
        "consecutive_failures" integer NOT NULL DEFAULT 0,
        "version" integer NOT NULL DEFAULT 1,
        "created_by" character varying(64) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_channel_connections_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_channel_connections_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_channel_connections_key" UNIQUE ("connection_key"),
        CONSTRAINT "UQ_channel_connections_provider_shop" UNIQUE ("provider", "external_shop_id"),
        CONSTRAINT "CHK_channel_connections_provider" CHECK ("provider" IN ('SHOPEE', 'LAZADA')),
        CONSTRAINT "CHK_channel_connections_status" CHECK ("status" IN ('PENDING_AUTH', 'CONNECTED', 'DEGRADED', 'TOKEN_EXPIRED', 'REAUTH_REQUIRED', 'PAUSED', 'DISCONNECTED')),
        CONSTRAINT "CHK_channel_connections_buffer" CHECK ("safety_stock_buffer" >= 0),
        CONSTRAINT "CHK_channel_connections_alloc" CHECK ("stock_allocation_percent" >= 0 AND "stock_allocation_percent" <= 100)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_channel_connections_tenant_status"
        ON ${connections} ("tenant_id", "status", "provider")
    `);
    await enableTenantRlsPolicy(queryRunner, connections);
    // Allow webhook ingress to resolve tenant_id by connection_key in SELECT queries when app.webhook_connection_key is set
    await queryRunner.query(`
      CREATE POLICY "webhook_routing_select_policy" ON ${connections}
        FOR SELECT
        USING (connection_key = NULLIF(current_setting('app.webhook_connection_key', true), ''))
    `);

    // 5. Connection Credentials (Encrypted at Rest)
    await queryRunner.query(`
      CREATE TABLE ${credentials} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "connection_id" uuid NOT NULL,
        "credential_version" integer NOT NULL DEFAULT 1,
        "encrypted_access_token" text NULL,
        "encrypted_refresh_token" text NULL,
        "encrypted_webhook_secret" text NOT NULL,
        "partner_id" character varying(128) NULL,
        "key_version" integer NOT NULL DEFAULT 1,
        "access_token_expires_at" TIMESTAMPTZ NULL,
        "refresh_token_expires_at" TIMESTAMPTZ NULL,
        "scopes" text NULL,
        "refresh_lease_owner" character varying(128) NULL,
        "refresh_lease_expires_at" TIMESTAMPTZ NULL,
        "last_refreshed_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_connection_credentials_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_connection_credentials_tenant_conn" UNIQUE ("tenant_id", "connection_id"),
        CONSTRAINT "FK_connection_credentials_conn" FOREIGN KEY ("tenant_id", "connection_id")
          REFERENCES ${connections} ("tenant_id", "id") ON DELETE CASCADE
      )
    `);
    await enableTenantRlsPolicy(queryRunner, credentials);

    // 6. Durable External Webhook Inbox (`webhook_inbox_events`)
    await queryRunner.query(`
      CREATE TABLE ${webhookInbox} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "connection_id" uuid NOT NULL,
        "provider" character varying(24) NOT NULL,
        "external_event_id" character varying(128) NOT NULL,
        "deduplication_key" character varying(190) NOT NULL,
        "event_type" character varying(64) NOT NULL,
        "external_shop_id" character varying(128) NOT NULL,
        "external_order_id" character varying(128) NULL,
        "payload_hash" character varying(64) NOT NULL,
        "encrypted_payload" text NOT NULL,
        "provider_event_time" TIMESTAMPTZ NOT NULL,
        "processing_status" character varying(24) NOT NULL DEFAULT 'RECEIVED',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "last_error_category" character varying(32) NULL,
        "last_error" text NULL,
        "received_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "processed_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_webhook_inbox_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_webhook_inbox_tenant_conn_dedup" UNIQUE ("tenant_id", "connection_id", "deduplication_key"),
        CONSTRAINT "CHK_webhook_inbox_status" CHECK ("processing_status" IN ('RECEIVED', 'VALIDATED', 'PROCESSING', 'PROCESSED', 'NEEDS_REVIEW', 'RETRY_PENDING', 'DEAD_LETTERED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_webhook_inbox_tenant_status_received"
        ON ${webhookInbox} ("tenant_id", "processing_status", "received_at" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, webhookInbox);

    // 7. SKU Mappings (`sku_mappings`)
    await queryRunner.query(`
      CREATE TABLE ${skuMappings} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "connection_id" uuid NOT NULL,
        "provider" character varying(24) NOT NULL,
        "external_item_id" character varying(128) NOT NULL,
        "external_sku_id" character varying(128) NOT NULL,
        "external_sku_code" character varying(128) NULL,
        "external_product_name" character varying(255) NULL,
        "internal_product_id" uuid NULL,
        "internal_variant_id" uuid NOT NULL,
        "internal_sku_code" character varying(64) NOT NULL,
        "mapping_mode" character varying(24) NOT NULL DEFAULT 'MANUAL',
        "mapping_version" integer NOT NULL DEFAULT 1,
        "status" character varying(24) NOT NULL DEFAULT 'ACTIVE',
        "listing_sync_status" character varying(24) NOT NULL DEFAULT 'MAPPED',
        "external_price" bigint NULL,
        "last_synced_at" TIMESTAMPTZ NULL,
        "created_by" character varying(64) NOT NULL,
        "updated_by" character varying(64) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sku_mappings_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sku_mappings_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_sku_mappings_conn_ext_item_sku" UNIQUE ("tenant_id", "connection_id", "external_item_id", "external_sku_id"),
        CONSTRAINT "CHK_sku_mappings_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'CONFLICT', 'NEEDS_REVIEW')),
        CONSTRAINT "CHK_sku_mappings_listing_status" CHECK ("listing_sync_status" IN ('NOT_MAPPED', 'MAPPED', 'SYNC_PENDING', 'SYNCED', 'SYNC_FAILED', 'NEEDS_REVIEW', 'UNSUPPORTED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sku_mappings_tenant_internal_variant"
        ON ${skuMappings} ("tenant_id", "internal_variant_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sku_mappings_tenant_conn_sku_code"
        ON ${skuMappings} ("tenant_id", "connection_id", "external_sku_code")
    `);
    await enableTenantRlsPolicy(queryRunner, skuMappings);

    // 8. Channel Order References (`channel_order_refs`)
    await queryRunner.query(`
      CREATE TABLE ${orderRefs} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "connection_id" uuid NOT NULL,
        "provider" character varying(24) NOT NULL,
        "external_shop_id" character varying(128) NOT NULL,
        "external_order_id" character varying(128) NOT NULL,
        "internal_order_id" uuid NULL,
        "internal_order_code" character varying(64) NULL,
        "sync_status" character varying(24) NOT NULL DEFAULT 'RECEIVED',
        "external_status" character varying(48) NOT NULL,
        "normalized_status" character varying(32) NOT NULL,
        "status_rank" integer NOT NULL DEFAULT 10,
        "external_updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "buyer_name" character varying(160) NULL,
        "currency" character varying(8) NOT NULL DEFAULT 'VND',
        "total_amount" bigint NOT NULL DEFAULT 0,
        "shipping_fee" bigint NOT NULL DEFAULT 0,
        "payment_method" character varying(32) NOT NULL DEFAULT 'COD',
        "raw_order_snapshot" jsonb NOT NULL,
        "mapping_snapshot" jsonb NULL,
        "shortage_details" jsonb NULL,
        "last_error_code" character varying(64) NULL,
        "last_error_message" text NULL,
        "version" integer NOT NULL DEFAULT 1,
        "last_synced_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_channel_order_refs_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_channel_order_refs_tenant_conn_ext_order" UNIQUE ("tenant_id", "connection_id", "external_order_id"),
        CONSTRAINT "CHK_channel_order_refs_sync_status" CHECK ("sync_status" IN ('RECEIVED', 'IMPORTING', 'IMPORTED', 'MAPPING_REQUIRED', 'SHORTAGE_HOLD', 'CONFLICT', 'FAILED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_channel_order_refs_tenant_status_updated"
        ON ${orderRefs} ("tenant_id", "sync_status", "updated_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_channel_order_refs_internal_order"
        ON ${orderRefs} ("tenant_id", "internal_order_id")
    `);
    await enableTenantRlsPolicy(queryRunner, orderRefs);

    // 9. Channel Inventory Publications (`channel_inventory_publications`)
    await queryRunner.query(`
      CREATE TABLE ${inventoryPubs} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "connection_id" uuid NOT NULL,
        "provider" character varying(24) NOT NULL,
        "mapping_id" uuid NOT NULL,
        "internal_variant_id" uuid NOT NULL,
        "external_item_id" character varying(128) NOT NULL,
        "external_sku_id" character varying(128) NOT NULL,
        "available_qty_snapshot" integer NOT NULL DEFAULT 0,
        "safety_buffer_snapshot" integer NOT NULL DEFAULT 0,
        "allocation_percent_snapshot" integer NOT NULL DEFAULT 100,
        "target_published_qty" integer NOT NULL DEFAULT 0,
        "last_confirmed_qty" integer NULL,
        "stock_version" bigint NOT NULL DEFAULT 1,
        "last_published_stock_version" bigint NOT NULL DEFAULT 0,
        "status" character varying(24) NOT NULL DEFAULT 'PENDING',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "provider_request_id" character varying(128) NULL,
        "last_error" text NULL,
        "published_at" TIMESTAMPTZ NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_channel_inventory_publications_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_channel_inventory_pubs_tenant_conn_mapping" UNIQUE ("tenant_id", "connection_id", "mapping_id"),
        CONSTRAINT "CHK_channel_inventory_pubs_status" CHECK ("status" IN ('PENDING', 'PUBLISHING', 'SUCCEEDED', 'STALE_SKIPPED', 'FAILED', 'UNKNOWN_OUTCOME'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_channel_inventory_pubs_tenant_variant"
        ON ${inventoryPubs} ("tenant_id", "internal_variant_id", "status")
    `);
    await enableTenantRlsPolicy(queryRunner, inventoryPubs);

    // 10. Sync Jobs (`sync_jobs`)
    await queryRunner.query(`
      CREATE TABLE ${syncJobs} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "connection_id" uuid NULL,
        "provider" character varying(24) NULL,
        "job_type" character varying(40) NOT NULL,
        "idempotency_key" character varying(190) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'PENDING',
        "priority" integer NOT NULL DEFAULT 10,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "result_summary" jsonb NULL,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 5,
        "next_retry_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "lease_owner" character varying(128) NULL,
        "lease_expires_at" TIMESTAMPTZ NULL,
        "error_category" character varying(32) NULL,
        "last_error_code" character varying(64) NULL,
        "last_error_message" text NULL,
        "correlation_id" character varying(128) NULL,
        "started_at" TIMESTAMPTZ NULL,
        "completed_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sync_jobs_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sync_jobs_tenant_idempotency" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "CHK_sync_jobs_status" CHECK ("status" IN ('PENDING', 'RUNNING', 'RETRY_SCHEDULED', 'COMPLETED', 'FAILED_PERMANENT', 'CANCELLED', 'NEEDS_REVIEW', 'DEAD_LETTERED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sync_jobs_claimable"
        ON ${syncJobs} ("tenant_id", "status", "next_retry_at" ASC, "priority" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sync_jobs_conn_type_status"
        ON ${syncJobs} ("tenant_id", "connection_id", "job_type", "status")
    `);
    await enableTenantRlsPolicy(queryRunner, syncJobs);

    // 11. Sync Cursors (`sync_cursors`)
    await queryRunner.query(`
      CREATE TABLE ${syncCursors} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "connection_id" uuid NOT NULL,
        "provider" character varying(24) NOT NULL,
        "cursor_type" character varying(40) NOT NULL,
        "cursor_value" character varying(255) NULL,
        "window_start" TIMESTAMPTZ NULL,
        "window_end" TIMESTAMPTZ NULL,
        "last_synced_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sync_cursors_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sync_cursors_tenant_conn_type" UNIQUE ("tenant_id", "connection_id", "cursor_type")
      )
    `);
    await enableTenantRlsPolicy(queryRunner, syncCursors);

    // 12. Sync Conflicts (`sync_conflicts`)
    await queryRunner.query(`
      CREATE TABLE ${syncConflicts} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "connection_id" uuid NOT NULL,
        "provider" character varying(24) NOT NULL,
        "conflict_type" character varying(48) NOT NULL,
        "severity" character varying(16) NOT NULL DEFAULT 'HIGH',
        "status" character varying(16) NOT NULL DEFAULT 'OPEN',
        "external_order_id" character varying(128) NULL,
        "external_item_id" character varying(128) NULL,
        "external_sku_id" character varying(128) NULL,
        "channel_order_ref_id" uuid NULL,
        "sync_job_id" uuid NULL,
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "resolution_action" character varying(64) NULL,
        "resolution_notes" text NULL,
        "resolved_by" character varying(64) NULL,
        "resolved_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sync_conflicts_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_sync_conflicts_status" CHECK ("status" IN ('OPEN', 'RESOLVED', 'IGNORED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sync_conflicts_tenant_status_created"
        ON ${syncConflicts} ("tenant_id", "status", "conflict_type", "created_at" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, syncConflicts);

    // 13. Dead-Letter Queue Events (`integration_dead_letter_events`)
    await queryRunner.query(`
      CREATE TABLE ${dlqEvents} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "connection_id" uuid NULL,
        "provider" character varying(24) NULL,
        "source_type" character varying(32) NOT NULL,
        "source_id" uuid NOT NULL,
        "idempotency_key" character varying(190) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "error_category" character varying(32) NOT NULL,
        "error_code" character varying(64) NOT NULL,
        "error_message" text NOT NULL,
        "attempt_count" integer NOT NULL DEFAULT 1,
        "status" character varying(24) NOT NULL DEFAULT 'DEAD_LETTERED',
        "replayed_by" character varying(64) NULL,
        "replayed_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_dlq_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_integration_dlq_tenant_source" UNIQUE ("tenant_id", "source_type", "source_id"),
        CONSTRAINT "CHK_integration_dlq_status" CHECK ("status" IN ('DEAD_LETTERED', 'REPLAYED', 'DISCARDED'))
      )
    `);
    await enableTenantRlsPolicy(queryRunner, dlqEvents);

    // 14. Provider Request Telemetry Logs (`provider_request_logs`)
    await queryRunner.query(`
      CREATE TABLE ${providerLogs} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "connection_id" uuid NULL,
        "provider" character varying(24) NOT NULL,
        "operation" character varying(64) NOT NULL,
        "endpoint" character varying(255) NOT NULL,
        "http_status" integer NOT NULL,
        "outcome" character varying(32) NOT NULL,
        "duration_ms" integer NOT NULL DEFAULT 0,
        "rate_limited" boolean NOT NULL DEFAULT false,
        "retry_after_seconds" integer NULL,
        "correlation_id" character varying(128) NULL,
        "error_code" character varying(64) NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_provider_request_logs_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_provider_request_logs_tenant_conn_time"
        ON ${providerLogs} ("tenant_id", "connection_id", "occurred_at" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, providerLogs);

    // 15. Reconciliation Runs (`reconciliation_runs`)
    await queryRunner.query(`
      CREATE TABLE ${reconRuns} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "connection_id" uuid NULL,
        "provider" character varying(24) NULL,
        "run_type" character varying(32) NOT NULL DEFAULT 'INCREMENTAL',
        "status" character varying(24) NOT NULL DEFAULT 'RUNNING',
        "window_start" TIMESTAMPTZ NULL,
        "window_end" TIMESTAMPTZ NULL,
        "records_examined" integer NOT NULL DEFAULT 0,
        "matched_count" integer NOT NULL DEFAULT 0,
        "mismatch_count" integer NOT NULL DEFAULT 0,
        "auto_recovered_count" integer NOT NULL DEFAULT 0,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMPTZ NULL,
        "triggered_by" character varying(64) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_recon_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_integration_recon_runs_status" CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED'))
      )
    `);
    await enableTenantRlsPolicy(queryRunner, reconRuns);

    // 16. Reconciliation Issues (`reconciliation_issues`)
    await queryRunner.query(`
      CREATE TABLE ${reconIssues} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "connection_id" uuid NULL,
        "provider" character varying(24) NULL,
        "issue_type" character varying(48) NOT NULL,
        "severity" character varying(16) NOT NULL DEFAULT 'HIGH',
        "external_ref" character varying(128) NULL,
        "internal_ref" character varying(128) NULL,
        "expected_state" jsonb NULL,
        "observed_state" jsonb NULL,
        "status" character varying(24) NOT NULL DEFAULT 'OPEN',
        "resolution_notes" text NULL,
        "resolved_by" character varying(64) NULL,
        "resolved_at" TIMESTAMPTZ NULL,
        "related_sync_job_id" uuid NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_recon_issues_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_integration_recon_issues_status" CHECK ("status" IN ('OPEN', 'RESOLVED', 'IGNORED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_integration_recon_issues_tenant_run_status"
        ON ${reconIssues} ("tenant_id", "run_id", "status")
    `);
    await enableTenantRlsPolicy(queryRunner, reconIssues);

    // 17. Integration Audit Logs (`integration_audit_logs`)
    await queryRunner.query(`
      CREATE TABLE ${auditLogs} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "connection_id" uuid NULL,
        "actor_id" character varying(64) NOT NULL,
        "action" character varying(64) NOT NULL,
        "target_type" character varying(48) NOT NULL,
        "target_id" character varying(128) NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_audit_logs_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_integration_audit_logs_tenant_time"
        ON ${auditLogs} ("tenant_id", "occurred_at" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, auditLogs);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);
    const tables = [
      'integration_audit_logs',
      'reconciliation_issues',
      'reconciliation_runs',
      'provider_request_logs',
      'integration_dead_letter_events',
      'sync_conflicts',
      'sync_cursors',
      'sync_jobs',
      'channel_inventory_publications',
      'channel_order_refs',
      'sku_mappings',
      'webhook_inbox_events',
      'connection_credentials',
      'channel_connections',
      'integration_stock_projections',
      'integration_catalog_variants',
      'integration_code_sequence',
    ];
    for (const name of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t(name)} CASCADE`);
    }
  }
}
