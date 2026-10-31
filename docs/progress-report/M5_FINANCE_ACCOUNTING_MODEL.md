# M5 Finance Microservice — Operational Accounting & Double-Entry Posting Model

**Implementation:** [`financial-journal.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/modules/financial-journal/financial-journal.service.ts)

---

## 1. Standard Operational Chart of Accounts (Ledger Codes)

`apps/finance` uses a deterministic operational subledger chart of accounts aligned with Vietnamese retail accounting practices (VAS-inspired operational ledger codes):

| Ledger Account Code | Account Name | Classification | Normal Balance |
|---|---|---|---|
| `1110` | Cash on Hand (`CASH_ON_HAND`) | Asset | Debit |
| `1120` | Bank Account (`BANK_ACCOUNT`) | Asset | Debit |
| `1130` | Payment Gateway / POS Clearing (`GATEWAY_CLEARING`) | Asset | Debit |
| `1140` | COD Courier Clearing (`COD_CLEARING`) | Asset | Debit |
| `1310` | Customer Accounts Receivable (`ACCOUNTS_RECEIVABLE`) | Asset | Debit |
| `1560` | Inventory Receipt Clearing (`INVENTORY_CLEARING`) | Asset | Debit |
| `3310` | Supplier Accounts Payable (`ACCOUNTS_PAYABLE`) | Liability | Credit |
| `5110` | Retail Sales Revenue / Clearing (`SALES_REVENUE`) | Revenue | Credit |
| `5210` | Sales Returns & Refunds (`SALES_RETURNS`) | Contra-Revenue | Debit |
| `6410` | Shipping & COD Service Fee Expense (`COD_FEE_EXPENSE`) | Expense | Debit |
| `6420` | General Operating Expense (`OPERATING_EXPENSE`) | Expense | Debit |
| `6428` | Payment Provider Fee Expense (`GATEWAY_FEE_EXPENSE`) | Expense | Debit |
| `7110` | Other Operational Income (`OTHER_INCOME`) | Revenue | Credit |

---

## 2. Double-Entry Posting Matrix by Business Event

Every financial state change atomically posts a balanced journal entry in the same PostgreSQL transaction:

| Business Operation | Reference Type | Debit Line(s) | Credit Line(s) |
|---|---|---|---|
| **Cashbook Receipt Voucher** (e.g., POS cash sale or misc income) | `CASHBOOK_VOUCHER` | `DR 1110/1120` (Cash/Bank Account) | `CR 5110/7110` (Revenue / Counterparty Ledger) |
| **Cashbook Payment Voucher** (e.g., store operating expense) | `CASHBOOK_VOUCHER` | `DR 6420` (Operating Expense) | `CR 1110/1120` (Cash/Bank Account) |
| **Internal Cash/Bank Transfer** | `CASHBOOK_TRANSFER` | `DR 1120` (Destination Cash/Bank Account) | `CR 1110` (Source Cash/Bank Account) |
| **Credit Sale Receivable Creation** (`CAPTURE` credit hold / `sales.order.completed`) | `CUSTOMER_RECEIVABLE` | `DR 1310` (Accounts Receivable — Customer) | `CR 5110` (Sales Revenue Clearing) |
| **Customer Debt Collection** (Receivable Payment) | `RECEIVABLE_PAYMENT` | `DR 1110/1120` (Cash/Bank Account) | `CR 1310` (Accounts Receivable — Customer) |
| **Customer Return Debt Reduction** (`sales.return.completed` on unpaid AR) | `CUSTOMER_RECEIVABLE_REDUCTION` | `DR 5210` (Sales Returns) | `CR 1310` (Accounts Receivable — Customer) |
| **Supplier Payable Creation** (`inventory.stock.received`) | `SUPPLIER_PAYABLE` | `DR 1560` (Inventory Receipt Clearing) | `CR 3310` (Accounts Payable — Supplier) |
| **Supplier Debt Payment** (Payable Payout) | `PAYABLE_PAYMENT` | `DR 3310` (Accounts Payable — Supplier) | `CR 1110/1120` (Cash/Bank Account) |
| **Supplier Return / Debit Note** | `SUPPLIER_PAYABLE_REDUCTION` | `DR 3310` (Accounts Payable — Supplier) | `CR 1560` (Inventory Receipt Clearing) |
| **Card / E-Wallet / QR Settlement** (with provider fee) | `PAYMENT_SETTLEMENT` | `DR 1120` (Net Amount to Bank)<br/>`DR 6428` (Provider Fee Expense) | `CR 1130` or `CR 1310` (Gross Settlement Amount) |
| **Customer Refund Execution** (Cash or Bank/Gateway) | `REFUND` | `DR 5210` (Sales Returns & Refunds) | `CR 1110/1120/1130` (Source Cash/Clearing Account) |
| **COD Shipment Expected Creation** | `COD_RECEIVABLE` | `DR 1140` (COD Courier Clearing) | `CR 5110` (Sales Revenue Clearing) |
| **COD Courier Remittance Batch Settlement** | `COD_REMITTANCE` | `DR 1120` (Net Payout to Bank)<br/>`DR 6410` (Courier COD + Shipping Fees) | `CR 1140` (Gross Collected COD Clearing) |

---

## 3. Reversal & Audit Trail Guarantee

When any posted operation is cancelled or reversed (e.g., `POST /api/v1/finance/cashbook/:id/cancel` or `POST /api/v1/finance/journal/:id/reverse`):

1. The original `financial_journal_entries` row is marked `status = 'REVERSED'`, `reversed_by_entry_id = <new_entry_id>`, `reversal_reason = <reason>`.
2. A new `REVERSAL` entry is inserted with `reverses_entry_id = <original_entry_id>` and every line's `debit_amount` and `credit_amount` inverted.
3. Consequently, the net effect across the ledger is zero while preserving 100% of the historical audit trail.
