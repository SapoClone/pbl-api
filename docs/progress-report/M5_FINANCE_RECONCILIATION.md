# M5 Finance Microservice — Payment, COD & Statement Reconciliation Guide

**Implementations:**
- [`reconciliation.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/modules/reconciliation/reconciliation.service.ts)
- [`cod.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/modules/cod/cod.service.ts)
- [`settlements.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/modules/settlements/settlements.service.ts)

---

## 1. Three-Pillar Reconciliation Architecture

Retail merchants face three primary external money reconciliation challenges:
1. **Bank & Payment Gateway Statement Matching:** Matching bank statement lines or VNPAY/MoMo/Stripe payout reports against internal `payment_settlements` and `cashbook_entries`.
2. **Courier COD Remittance Reconciliation:** Matching GHN/GHTK/ViettelPost COD payout batches against expected `cod_receivables` per tracking number, accounting for shipping and COD collection fees.
3. **Accounting Period Close (`financial_period_closes`):** Locking reconciled periods so historical balances cannot be altered by backdated vouchers or journal entries.

---

## 2. Bank & Gateway Statement Reconciliation Workflow

1. **Batch Import (`POST /api/v1/finance/reconciliation/batches`):**
   - Accepts `reconciliationType` (`BANK_STATEMENT`, `PAYMENT_GATEWAY`, or `COD_CARRIER`), `statementDate`, `cashAccountId` / `providerCode`, and an array of statement `items` (`externalReference`, `statementAmount`, `internalRecordType`, `internalRecordId`, `expectedAmount`).
2. **Deterministic Classification per Line:**
   - If the linked internal record (`PAYMENT_SETTLEMENT` or `CASHBOOK_ENTRY`) exists and `statementAmount === internalAmount`: classified as `MATCHED`.
   - If the internal record exists but `statementAmount !== internalAmount`: classified as `DISCREPANCY` with `discrepancyAmount = statementAmount - expectedAmount`.
   - If no internal record can be found: classified as `UNMATCHED`.
3. **Batch State Machine:**
   - If `unmatchedCount === 0` and `discrepancyCount === 0`, the batch immediately transitions to `COMPLETED` and emits `finance.reconciliation.completed`.
   - Otherwise, the batch stays `DISCREPANCY_REVIEW` until operators resolve open items via `POST /api/v1/finance/reconciliation/items/:id/resolve` (`RESOLVED` or `IGNORED` with audit notes). Once the final unresolved item is closed, the parent batch automatically transitions to `COMPLETED`.

---

## 3. COD Courier Remittance Workflow

1. **Expected COD Registration (`POST /api/v1/finance/cod/receivables` or `sales.order.completed`):**
   - Registers `trackingNumber`, `carrierCode`, `orderId`, `expectedAmount` (`status = 'EXPECTED'`) and posts `DR COD Clearing (1140) / CR Sales Revenue (5110)`.
2. **Remittance Batch Processing (`POST /api/v1/finance/cod/remittances`):**
   - For each shipment in the courier batch:
     - Looks up `cod_receivables` by `(tenant_id, tracking_number)` under `PESSIMISTIC_WRITE`.
     - Computes `netAmount = collectedAmount - codFeeAmount - shippingFeeAmount`.
     - Computes `discrepancyAmount = collectedAmount - expectedAmount`.
     - Updates `cod_receivables.status` to `RECONCILED` (if `discrepancyAmount === 0`) or `DISCREPANCY` (if `discrepancyAmount !== 0`).
   - Credits the merchant's target bank account (`cashAccountId`) by `netRemittedAmount`, records courier fees (`6410`), clears `COD Clearing (1140)`, and emits `finance.cod.reconciled`.
