# ADR-008: Immutable Double-Entry Accounting Ledger in Finance

- **Status:** Accepted (Verified in M7.5)
- **Date:** 2026-10-31

## Context
Mutating account balances in place without a balanced journal trail makes financial audits, COD settlement variance investigation, and refund reconciliation error-prone.

## Decision
1. All financial postings in `apps/finance` create an immutable `JournalEntryEntity` with $\ge 2$ `JournalLineEntity` rows validated by `validateBalancedJournalLines()` ($\sum \text{Debit} = \sum \text{Credit} > 0$).
2. Corrections or cancellations never `UPDATE` or `DELETE` posted journal lines; instead, they append a reversing journal entry (`REVERSED`).

## Consequences
- **Positive:** Complete, tamper-evident audit trail and guaranteed trial-balance integrity.
- **Negative / Trade-off:** Higher row volume in `journal_lines`, mitigated by indexed `(tenant_id, account_id, posted_at)` queries.
