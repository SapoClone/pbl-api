# ADR-007: Fixed-Point BigInt Monetary & Quantity Value Objects

- **Status:** Accepted (Expanded in M7.5)
- **Date:** 2026-10-31

## Context
IEEE-754 binary floating-point numbers (`number`) introduce rounding drift in multi-line discount allocation, weighted-average cost (`WAC`) valuation, and double-entry journal balancing (e.g., `0.1 + 0.2 !== 0.3`).

## Decision
1. Represent monetary amounts as whole VND (`bigint`, no minor unit; the M1-M6 integer-VND decision, see docs/decisions/0020 and the money.ts transformers) and stock quantities as integer milli-units (`bigint`, scale `1000n` for `NUMERIC(18,3)`).
2. Encapsulate arithmetic and invariant validation in immutable Value Objects (`VndMoney`, `StockQuantity`, `DiscountPercentage` in `sales-domain.ts`; `InventoryQuantity`, `InventoryMoney` in `inventory-domain.ts`).

## Consequences
- **Positive:** Zero floating-point drift across checkout waterfalls, partial return refunds, WAC inventory valuation, and double-entry journals.
- **Negative / Trade-off:** Requires explicit string formatting (`formatCentsToMoney`, `formatMilliToQty`) at DTO/database boundaries.
