# M5 to M6 Hand-Off Guide — Integration & Omnichannel Marketplace Connectors

**From:** Milestone M5 (`apps/finance` — Finance Core)  
**To:** Milestone M6 (`apps/integration` — Omnichannel Marketplace, Payment Gateway & Shipping Connectors) & Milestone M7 (`apps/insight` — Analytics & Reporting)

---

## 1. Ready-to-Use Finance Integration Surfaces for M6 (`apps/integration`)

Milestone M6 (`apps/integration`) connects external marketplaces (Shopee, TikTok Shop, Lazada), payment gateways (VNPAY, MoMo, VietQR), and shipping carriers (GHN, GHTK) to SapoClone. `apps/finance` provides the following production-ready contracts for M6:

### 1.1 Payment Gateway Webhook -> Finance Settlement
When `apps/integration` receives a signed payment webhook or daily settlement file from VNPAY/MoMo:
- **Synchronous Internal API:** `POST http://finance:3006/internal/v1/finance/settlements/record`
  - Payload: `{ orderId, paymentMethod, providerCode, providerTransactionId, grossAmount, feeAmount, netAmount, cashAccountId, idempotencyKey }`
  - Guarantees idempotent recording of gross amount, gateway fee expense (`6428`), and net bank deposit (`1120`), emitting `finance.payment.settled`.

### 1.2 Shipping Carrier Webhook / Remittance -> Finance COD Lifecycle
1. **When a COD shipment is created with GHN/GHTK:**
   - Call `POST http://finance:3006/internal/v1/finance/cod/expected` (or let `sales.order.completed` with `codAmount > 0` register it automatically).
2. **When GHN/GHTK sends a COD remittance batch statement:**
   - Call `POST /api/v1/finance/cod/remittances` with `carrierCode`, `cashAccountId`, and `items: [{ trackingNumber, collectedAmount, codFeeAmount, shippingFeeAmount }]`.
   - Finance automatically reconciles each tracking number against `cod_receivables`, flags any discrepancy between courier collected amount and expected COD amount, posts net remittance + fee journal lines, and emits `finance.cod.reconciled`.

### 1.3 Marketplace Payout Statement Reconciliation
- Marketplace settlement reports (Shopee/TikTok Shop order escrow releases) can be imported into `POST /api/v1/finance/reconciliation/batches` (`reconciliationType: 'PAYMENT_GATEWAY'`) to automatically match external order payouts against internal settlements and surface fee or amount discrepancies.

---

## 2. Ready-to-Use Finance Event Streams for M7 (`apps/insight`)

The `insight-events-queue.fifo` is already subscribed in [`topology.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src/topology.ts) to receive all outbound M5 Finance events from `pbl6-finance-events.fifo`:

- `finance.journal.posted` -> Real-time P&L and trial balance projections.
- `finance.cashbook.voucher_posted` & `finance.cashbook.voucher_reversed` -> Daily branch cashflow dashboards.
- `finance.receivable.created` & `finance.receivable.paid` -> Customer debt trends and DSO (Days Sales Outstanding) metrics.
- `finance.payable.created` & `finance.payable.paid` -> Supplier liability and cash outflow forecasting.
- `finance.payment.settled`, `finance.refund.completed`, `finance.cod.reconciled` -> Net revenue and payment/shipping fee analytics.
