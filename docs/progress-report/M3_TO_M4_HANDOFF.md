# M3 Sales & POS to M4 (Customer, Finance, Integration & Insight) — Handoff Guide

## 1. Transactional Outbox Events Emitted by `apps/sales`

Defined in [`libs/contracts/src/events.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src/events.ts) and routed via SNS/SQS topology in [`libs/contracts/src/topology.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src/topology.ts):

| Event Type | Emitted When | Target Downstream Consumers | Key Payload Fields |
|---|---|---|---|
| `sales.order.created` | Omnichannel (`MANUAL`/`WEB`/`MARKETPLACE`) order created | `insight`, `customer` | `orderId`, `code`, `branchId`, `channelType`, `orderStatus`, `paymentStatus`, `fulfillmentStatus`, `grandTotal` |
| `sales.order.confirmed` | Order confirmed & stock reservation held | `insight`, `integration` | `orderId`, `code`, `branchId`, `orderStatus`, `fulfillmentStatus: 'RESERVED'` |
| `sales.order.completed` / `sales.checkout.completed` | POS checkout finalized or fulfillment completed | `inventory`, `insight`, `customer`, `finance` | `orderId`, `code`, `branchId`, `totalAmount`, `grandTotal`, `discountTotal`, `taxTotal`, `items` |
| `sales.order.cancelled` | Unshipped order cancelled & reservation released | `insight`, `integration`, `finance` | `orderId`, `code`, `branchId`, `orderStatus: 'CANCELLED'` |
| `sales.tender.recorded` | Single or split tender recorded on checkout or order payment | `finance` | `orderId`, `checkoutId`, `shiftId`, `totalConfirmed`, `totalCashSales`, `totalChangeDue` |
| `sales.payment.confirmed` | Full order payment settled (`paymentStatus = PAID`) | `finance`, `insight` | `orderId`, `checkoutId`, `amount`, `paymentStatus` |
| `sales.fulfillment.created` / `confirmed` / `shipped` / `completed` | Order fulfillment lifecycle transitions | `integration`, `insight` | `fulfillmentId`, `code`, `orderId`, `branchId`, `warehouseId`, `status`, `reservationId` |
| `sales.return.requested` / `approved` / `received` / `completed` | Sales return & inventory restock lifecycle | `finance`, `insight`, `customer` | `returnId`, `code`, `orderId`, `branchId`, `warehouseId`, `status`, `totalRefundAmount`, `inventoryReceiptId` |
| `sales.refund.requested` | Pro-rated refund generated upon return receipt | `finance` | `refundRequestId`, `returnId`, `orderId`, `method`, `amount`, `status` |
| `sales.shift.opened` / `sales.shift.closed` | POS register shift opened or closed with cash count | `finance`, `insight` | `shiftId`, `code`, `branchId`, `registerCode`, `staffId`, `openingCash`, `cashSalesTotal`, `cashRefundsTotal`, `expectedCash`, `actualCash`, `variance` |

---

## 2. Integration Contracts for M4 Services

### 2.1. Finance Microservice (`apps/finance`)
- **Cashbook & Payment Settlement:** Subscribe to `sales.tender.recorded` and `sales.payment.confirmed` to create immutable cashbook receipt vouchers (`CASH`, `BANK_TRANSFER`, `CARD`, `E_WALLET`) and COD accounts-receivable entries (`COD`).
- **Refund Settlement:** Subscribe to `sales.refund.requested` (`refundRequestId` idempotency key) to record cash/electronic payout vouchers and emit settlement confirmation.
- **POS Shift Reconciliation:** Subscribe to `sales.shift.closed` to record end-of-day cash drawer handoff and flag non-zero `variance` (`actualCash - expectedCash`) for accounting review.

### 2.2. Customer & Loyalty Microservice (`apps/customer`)
- **Customer Spend & Loyalty Points:** Subscribe to `sales.order.completed` / `sales.checkout.completed` and `sales.return.completed` to increment/decrement customer lifetime value (`LTV`) and loyalty points by `customer_id`.

### 2.3. Marketplace Integration Microservice (`apps/integration`)
- **Inbound Marketplace Order Sync:** Submit normalized orders from Shopee/Lazada/TikTok Shop to `POST /v1/orders` with `channelType: 'MARKETPLACE'`, `sourceConnectionId`, and `externalOrderId`. Duplicate webhook deliveries are safely deduplicated by `UQ_orders_tenant_external` (`409 DUPLICATE_EXTERNAL_ORDER`).
- **Outbound Status Sync:** Subscribe to `sales.fulfillment.shipped` and `sales.order.cancelled` to push tracking numbers and cancellation statuses back to external marketplaces.
