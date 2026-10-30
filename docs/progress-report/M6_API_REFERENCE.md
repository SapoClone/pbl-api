# M6 Integration REST & Webhook API Reference

## 1. Public External Webhook Ingress

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/webhooks/v1/:provider/:connectionKey` | Raw-body HMAC-SHA256 (`Authorization` for Shopee, `x-lazada-signature` for Lazada) | Verifies signature & 300s replay window, persists to `webhook_inbox_events`, and enqueues durable `SyncJobEntity` |

## 2. Authenticated Management Endpoints (`/api/v1/integrations/*`)

| Method | Path | RBAC Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/integrations/providers` | `integration.connection.read` | Returns Shopee v2 and Lazada provider capability matrices |
| `POST` | `/api/v1/integrations/connections` | `integration.connection.manage` | Creates a marketplace channel connection with AES-256-GCM encrypted credentials |
| `GET` | `/api/v1/integrations/connections` | `integration.connection.read` | Lists tenant channel connections (sanitized view, zero secret exposure) |
| `GET` | `/api/v1/integrations/connections/:id` | `integration.connection.read` | Gets sanitized channel connection details |
| `POST` | `/api/v1/integrations/connections/:id/authorize` | `integration.connection.manage` | Initiates OAuth authorization URL or completes callback state exchange |
| `POST` | `/api/v1/integrations/connections/:id/refresh-token` | `integration.connection.manage` | Executes lease + CAS concurrency-safe token refresh |
| `DELETE` | `/api/v1/integrations/connections/:id` | `integration.connection.manage` | Disconnects channel connection and wipes stored tokens |
| `GET` | `/api/v1/integrations/connections/:id/health` | `integration.connection.read` | Returns token expiry, circuit breaker state, open conflicts & lag diagnostics |
| `POST` | `/api/v1/integrations/sku-mappings` | `integration.mapping.manage` | Creates an explicit SKU mapping to an active internal Catalog variant |
| `GET` | `/api/v1/integrations/sku-mappings` | `integration.mapping.read` | Lists SKU mappings with optional connection/variant/status filters |
| `PATCH` | `/api/v1/integrations/sku-mappings/:id` | `integration.mapping.manage` | Updates SKU mapping and increments `mappingVersion` |
| `DELETE` | `/api/v1/integrations/sku-mappings/:id` | `integration.mapping.manage` | Deletes a SKU mapping with audit log entry |
| `POST` | `/api/v1/integrations/connections/:id/sync/orders` | `integration.sync.trigger` | Enqueues and/or executes external order polling sync job |
| `POST` | `/api/v1/integrations/connections/:id/sync/inventory` | `integration.sync.trigger` | Enqueues and/or executes sellable inventory publication sync job |
| `POST` | `/api/v1/integrations/connections/:id/sync/products` | `integration.sync.trigger` | Fetches external listings and performs exact-SKU auto-mapping |
| `GET` | `/api/v1/integrations/sync-jobs` | `integration.sync.read` | Lists durable sync jobs |
| `GET` | `/api/v1/integrations/sync-jobs/:id` | `integration.sync.read` | Gets sync job status, attempts, and result summary |
| `POST` | `/api/v1/integrations/sync-jobs/:id/retry` | `integration.sync.retry` | Replays a failed or dead-lettered sync job |
| `GET` | `/api/v1/integrations/conflicts` | `integration.conflict.read` | Lists open/resolved sync conflicts |
| `POST` | `/api/v1/integrations/conflicts/:id/resolve` | `integration.conflict.resolve` | Resolves a conflict (optionally creates missing SKU mapping and retries order import) |
| `POST` | `/api/v1/integrations/reconciliation-runs` | `integration.reconciliation.run` | Triggers an omnichannel reconciliation run |
| `GET` | `/api/v1/integrations/reconciliation-runs` | `integration.reconciliation.read` | Lists reconciliation runs |
| `GET` | `/api/v1/integrations/reconciliation-runs/:id` | `integration.reconciliation.read` | Gets reconciliation run summary and discrepancy issues |
