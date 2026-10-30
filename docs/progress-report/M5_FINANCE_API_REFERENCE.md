# M5 Finance Microservice — Public & Internal API Reference

**Gateway Prefix:** `/finance/api/v1/finance/*` (KrakenD `:8080`)  
**Direct Service Base URL:** `http://localhost:3006`  
**Unified OpenAPI Definition:** [`microservices-openapi.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/platform/src/utils/microservices-openapi.ts)

---

## 1. Public Tenant-Scoped Endpoints (`/api/v1/finance/*`)

### 1.1 Cash & Bank Accounts ([`cash-accounts.controller.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/modules/cash-accounts/cash-accounts.controller.ts))

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/finance/cash-accounts` | `finance.cashbook.create` | Create a cash drawer, bank account, POS clearing, or COD clearing account with optional opening balance |
| `GET` | `/api/v1/finance/cash-accounts` | `finance.cashbook.read` | List cash accounts with live balances and branch/type/status filters |
| `GET` | `/api/v1/finance/cash-accounts/:id` | `finance.cashbook.read` | Get single cash account with current balance |
| `PATCH` | `/api/v1/finance/cash-accounts/:id` | `finance.cashbook.create` | Update account metadata, negative balance policy, or status (`ACTIVE`/`INACTIVE`) |

### 1.2 Cashbook Vouchers & Transfers ([`cashbook.controller.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/modules/cashbook/cashbook.controller.ts))

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/finance/cashbook/receipts` | `finance.cashbook.create` | Create and post a cash/bank receipt voucher (`RECEIPT`) |
| `POST` | `/api/v1/finance/cashbook/payments` | `finance.cashbook.create` | Create and post a cash/bank payment voucher (`PAYMENT`) |
| `POST` | `/api/v1/finance/cashbook/transfers` | `finance.cashbook.create` | Execute an atomic internal transfer between two cash/bank accounts |
| `GET` | `/api/v1/finance/cashbook` | `finance.cashbook.read` | List cashbook entries with pagination, branch/account/type/date filters, and inflow/outflow summary |
| `GET` | `/api/v1/finance/cashbook/:id` | `finance.cashbook.read` | Get cashbook voucher detail |
| `POST` | `/api/v1/finance/cashbook/:id/post` | `finance.cashbook.create` | Post a `DRAFT` cashbook voucher |
| `POST` | `/api/v1/finance/cashbook/:id/cancel` | `finance.cashbook.cancel` | Reverse a posted voucher or cancel a draft voucher |

### 1.3 Operational Double-Entry Journal ([`financial-journal.controller.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/modules/financial-journal/financial-journal.controller.ts))

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/finance/journal` | `finance.reports.read` | Query operational journal entries with lines |
| `GET` | `/api/v1/finance/journal/:id` | `finance.reports.read` | Inspect a single journal entry and its balanced lines |
| `POST` | `/api/v1/finance/journal/:id/reverse` | `finance.reconciliation.manage` | Reverse a posted journal entry via compensating entry |

### 1.4 Customer Credit & Accounts Receivable ([`receivables.controller.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/modules/receivables/receivables.controller.ts), [`credit-authorization.controller.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/modules/credit-authorization/credit-authorization.controller.ts))

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/finance/customers/:customerId/credit-profile` | `finance.receivables.read` | Get customer credit limit, current debt, held credit, and available credit |
| `PUT` | `/api/v1/finance/customers/:customerId/credit-limit` | `finance.credit.manage` | Update customer credit limit and block status |
| `POST` | `/api/v1/finance/receivables` | `finance.receivables.collect` | Record a customer receivable invoice |
| `GET` | `/api/v1/finance/receivables` | `finance.receivables.read` | List customer receivables with status/customer/branch filters |
| `GET` | `/api/v1/finance/receivables/aging` | `finance.receivables.read` | Generate AR aging report (`current`, `1-30`, `31-60`, `61-90`, `90+` days) |
| `GET` | `/api/v1/finance/receivables/:id` | `finance.receivables.read` | Get receivable detail and payment allocations |
| `POST` | `/api/v1/finance/receivables/payments` | `finance.receivables.collect` | Collect customer payment and allocate to open receivables (explicit or FIFO) |
| `GET` | `/api/v1/finance/customers/:customerId/debt-ledger` | `finance.receivables.read` | Get append-only customer debt statement and aging summary |

### 1.5 Supplier Accounts Payable ([`payables.controller.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/modules/payables/payables.controller.ts))

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/finance/payables` | `finance.payables.pay` | Record a supplier payable bill |
| `GET` | `/api/v1/finance/payables` | `finance.payables.read` | List supplier payables |
| `GET` | `/api/v1/finance/payables/:id` | `finance.payables.read` | Get supplier payable detail and payment allocations |
| `POST` | `/api/v1/finance/payables/payments` | `finance.payables.pay` | Pay supplier and allocate to open payables (explicit or FIFO) |
| `POST` | `/api/v1/finance/payables/return-reductions` | `finance.payables.pay` | Apply supplier return / debit note reduction |
| `GET` | `/api/v1/finance/suppliers/:supplierId/debt-ledger` | `finance.payables.read` | Get supplier debt statement and open payables summary |

### 1.6 Settlements, Refunds, COD & Reconciliation

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/finance/settlements` | `finance.reconciliation.manage` | Record payment settlement (gross, fee, net) |
| `GET` | `/api/v1/finance/settlements` | `finance.reconciliation.manage` | List payment settlements |
| `GET` | `/api/v1/finance/settlements/:id` | `finance.reconciliation.manage` | Get settlement with allocations and attempts |
| `POST` | `/api/v1/finance/refunds` | `finance.refunds.execute` | Execute financial refund with cumulative order cap check |
| `GET` | `/api/v1/finance/refunds` | `finance.refunds.execute` | List refund records |
| `GET` | `/api/v1/finance/refunds/:id` | `finance.refunds.execute` | Get refund record and execution attempts |
| `POST` | `/api/v1/finance/cod/receivables` | `finance.reconciliation.manage` | Create COD shipment receivable |
| `GET` | `/api/v1/finance/cod/receivables` | `finance.reconciliation.manage` | List COD receivables |
| `POST` | `/api/v1/finance/cod/remittances` | `finance.reconciliation.manage` | Reconcile courier COD remittance batch |
| `GET` | `/api/v1/finance/cod/remittances` | `finance.reconciliation.manage` | List COD remittance batches |
| `GET` | `/api/v1/finance/cod/remittances/:id` | `finance.reconciliation.manage` | Get COD remittance batch with items |
| `POST` | `/api/v1/finance/reconciliation/batches` | `finance.reconciliation.manage` | Import & auto-match bank/gateway reconciliation statement |
| `GET` | `/api/v1/finance/reconciliation/batches` | `finance.reconciliation.manage` | List reconciliation batches |
| `GET` | `/api/v1/finance/reconciliation/batches/:id` | `finance.reconciliation.manage` | Get reconciliation batch with matched/discrepancy items |
| `POST` | `/api/v1/finance/reconciliation/items/:id/resolve` | `finance.reconciliation.manage` | Resolve a reconciliation item discrepancy |
| `POST` | `/api/v1/finance/periods/close` | `finance.period.close` | Close an accounting period to block backdated postings |
| `GET` | `/api/v1/finance/periods` | `finance.reports.read` | List closed accounting periods |

---

## 2. Internal Service-to-Service Endpoints (`/internal/v1/finance/*`)

> [!IMPORTANT]
> Internal endpoints are strictly for synchronous service-to-service workflows (e.g., `Sales` credit checkout authorization) and are blocked from public ingress at the KrakenD gateway.

| Method | Path | Caller | Description |
|---|---|---|---|
| `POST` | `/internal/v1/finance/credit/reserve` | `Sales` | Reserve customer credit (`ACTIVE` hold) under `PESSIMISTIC_WRITE` |
| `POST` | `/internal/v1/finance/credit/release` | `Sales` | Release an active credit hold on order cancellation |
| `POST` | `/internal/v1/finance/credit/capture` | `Sales` | Capture a credit hold and create the customer receivable invoice |
| `POST` | `/internal/v1/finance/settlements/record` | `Sales` / `Integration` | Record a tender settlement from checkout or webhook |
| `POST` | `/internal/v1/finance/refunds/execute` | `Sales` | Execute a refund for an approved return |
| `POST` | `/internal/v1/finance/cod/expected` | `Sales` / `Integration` | Register an expected COD shipment receivable |
