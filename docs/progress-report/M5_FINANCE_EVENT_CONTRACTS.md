# M5 Finance Microservice — Asynchronous Event Contracts & Saga Flows

**Shared Event Definitions:** [`events.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src/events.ts)  
**SNS/SQS Topology:** [`topology.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src/topology.ts)  
**Finance Event Consumer:** [`finance-events.consumer.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/consumers/finance-events.consumer.ts)

---

## 1. Events Published by `apps/finance` (Transactional Outbox -> `pbl6-finance-events.fifo`)

All outbound Finance events are persisted to `outbox_events` in the same PostgreSQL transaction as the domain mutation and relayed to `pbl6-finance-events.fifo` with `MessageGroupId = tenantId`.

| Event Type (`EVENT_TYPES`) | Triggering Operation | Payload Highlights |Subscribed Queues |
|---|---|---|---|
| `finance.journal.posted` | Every posted double-entry journal | `journalEntryId`, `entryCode`, `entryType`, `referenceType`, `referenceId`, `totalDebit`, `totalCredit` | `insight-events-queue.fifo` |
| `finance.cashbook.voucher_posted` | Receipt, payment, or transfer voucher posted | `voucherId`, `voucherCode`, `voucherType`, `cashAccountId`, `amount`, `balanceAfter` | `insight-events-queue.fifo` |
| `finance.cashbook.voucher_reversed` | Posted cashbook voucher cancelled/reversed | `voucherId`, `reversalVoucherId`, `cashAccountId`, `amount`, `reason` | `insight-events-queue.fifo` |
| `finance.credit.reserved` | Credit hold created (`RESERVE`) | `holdId`, `customerId`, `orderId`, `amount`, `availableCreditAfter` | `sales-events-queue.fifo`, `customer-events-queue.fifo` |
| `finance.credit.released` | Credit hold released (`RELEASE`) | `holdId`, `customerId`, `orderId`, `amount`, `availableCreditAfter` | `sales-events-queue.fifo`, `customer-events-queue.fifo` |
| `finance.credit.captured` | Credit hold captured (`CAPTURE`) | `holdId`, `receivableId`, `customerId`, `orderId`, `amount`, `currentDebtAfter` | `sales-events-queue.fifo`, `customer-events-queue.fifo` |
| `finance.receivable.created` | Customer AR invoice created | `receivableId`, `receivableCode`, `customerId`, `orderId`, `originalAmount`, `outstandingAmount`, `currentDebtAfter` | `customer-events-queue.fifo`, `insight-events-queue.fifo` |
| `finance.receivable.paid` | Customer payment allocated to AR | `paymentId`, `paymentCode`, `customerId`, `amount`, `currentDebtAfter`, `allocations` | `customer-events-queue.fifo`, `sales-events-queue.fifo`, `insight-events-queue.fifo` |
| `finance.payable.created` | Supplier AP bill created | `payableId`, `payableCode`, `supplierId`, `goodsReceiptId`, `originalAmount`, `outstandingAmount` | `inventory-events-queue.fifo`, `insight-events-queue.fifo` |
| `finance.payable.paid` | Supplier payout allocated to AP | `paymentId`, `paymentCode`, `supplierId`, `amount`, `allocations` | `inventory-events-queue.fifo`, `insight-events-queue.fifo` |
| `finance.payment.settled` | Tender settlement recorded | `settlementId`, `settlementCode`, `orderId`, `paymentMethod`, `grossAmount`, `feeAmount`, `netAmount` | `sales-events-queue.fifo`, `insight-events-queue.fifo` |
| `finance.refund.completed` | Financial refund executed | `refundId`, `refundCode`, `orderId`, `returnId`, `amount`, `refundMethod` | `sales-events-queue.fifo`, `customer-events-queue.fifo`, `insight-events-queue.fifo` |
| `finance.refund.failed` | Financial refund failed | `refundId`, `orderId`, `returnId`, `amount`, `reason` | `sales-events-queue.fifo` |
| `finance.cod.reconciled` | COD remittance batch processed | `batchId`, `batchCode`, `carrierCode`, `totalExpectedAmount`, `totalCollectedAmount`, `netRemittedAmount`, `discrepancyCount` | `sales-events-queue.fifo`, `insight-events-queue.fifo` |
| `finance.reconciliation.completed` | Bank/gateway reconciliation batch completed | `batchId`, `batchCode`, `matchedCount`, `unmatchedCount`, `discrepancyCount` | `insight-events-queue.fifo` |

---

## 2. Events Consumed by `apps/finance` (`finance-events-queue.fifo` -> Transactional Inbox)

[`FinanceEventsConsumer`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/consumers/finance-events.consumer.ts) uses `@pbl/events` `InboxService` (`processed_events` table with `UQ(event_id, consumer)`) inside `withTenantContext` so duplicate SQS deliveries are safely ignored.

| Inbound Event Type | Source Service | Finance Reaction |
|---|---|---|
| `sales.order.completed` | `Sales` | 1. For immediate tenders (`CASH`, `BANK_TRANSFER`, `CARD`, `EWALLET`, `QR`), records cashbook receipt or payment settlement.<br/>2. For `CREDIT` / `DEBT` tenders (`creditAmount > 0`), captures any active credit hold or creates a `customer_receivables` invoice.<br/>3. For `COD` shipments (`codAmount > 0`), registers an expected `cod_receivables` tracking record. |
| `sales.order.cancelled` | `Sales` | Releases any `ACTIVE` credit hold associated with `orderId` (`releaseHold`). |
| `sales.return.completed` | `Sales` | 1. If `refundAmount > 0` and `refundMethod` is specified, executes a financial refund (`executeRefund`).<br/>2. If `receivableReductionAmount > 0` (return on unpaid credit order), reduces open customer receivables and decrements `current_debt` (`applyReturnDebtReduction`). |
| `inventory.stock.received` | `Inventory` | When `supplierId` and `totalCost > 0` are present, automatically creates a `supplier_payables` bill (`createPayable`), updates `supplier_debt_ledger`, and posts `DR Inventory Clearing / CR Accounts Payable`. |
| `customer.created` / `customer.updated` | `Customer` | Synchronizes `creditLimit` policy ceiling onto `customer_credit_profiles` if provided. |
