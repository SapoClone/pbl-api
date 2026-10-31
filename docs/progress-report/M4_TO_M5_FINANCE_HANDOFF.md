# M4 Customer & Loyalty -> M5 Finance Handoff Specification

## 1. Boundary Between M4 Customer and M5 Finance

Per the 8-service SapoClone architecture:
- **Customer (`apps/customer`)** is the authoritative owner of customer identity (`customers`), segmentation (`customer_groups`), membership tiers (`membership_tiers`), and loyalty point accounting (`loyalty_accounts`, `loyalty_transactions`, `loyalty_holds`).
- **Finance (`apps/finance`, Milestone M5)** will be the authoritative owner of cashbooks, payment settlements, customer accounts receivable (debt ledger), supplier accounts payable, and financial refunds.

## 2. Prepared Integration Contracts for M5 Finance

1. **Customer Debt Read-Model Projection on `customers`:**
   - `customers.debt_limit` (`numeric(18,2)`, default `2000000.00`) and `customers.current_debt` (`numeric(18,2)`, default `0.00`) exist on the Customer profile as a cached read model.
   - `GET /v1/customers/:id/summary` returns:
     ```json
     "financialSummary": {
       "debtLimitVnd": "2000000.00",
       "currentDebtVnd": "0.00",
       "availableCreditVnd": "2000000.00",
       "authoritativeSource": "PENDING_M5_FINANCE"
     }
     ```
   - In M5 Finance, when Finance records a credit sale receivable (`finance.receivable.recorded`) or debt payment (`finance.receivable.settled`), Customer can subscribe to update `customers.current_debt` asynchronously while Finance remains the system of record for the receivable ledger.
2. **Customer Lifecycle Events Emitted for Finance (`@pbl/contracts`):**
   - `customer.created`, `customer.updated`, `customer.deactivated`: enables M5 Finance to maintain a lightweight customer projection (`customer_id`, `code`, `name`, `status`, `debt_limit`) and handle customer merges (`merged_into_customer_id`).
3. **Sales Return Financial Refund vs. Loyalty Point Reversal Separation:**
   - When a return completes in Sales (`sales.return.completed`), **Customer** reverses earned loyalty points (`EARN_REVERSAL`), while **Finance (M5)** will process `sales.refund.requested` to disburse the monetary refund. The two concerns are cleanly decoupled.
