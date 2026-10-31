# Ubiquitous Language Glossary — SapoClone Bounded Contexts

## 1. Cross-Context Core Terms

| Term | Canonical Definition | Authoritative Context |
|---|---|---|
| **Tenant (`tenant_id`)** | Isolated retail business organization subscribing to SapoClone. Every business record and event carries `tenant_id`. | `platform` |
| **Branch (`branch_id`)** | Physical retail store or operational location belonging to a Tenant. Every Tenant must retain at least one active Branch (`B002`). | `platform` |
| **Product Variant / SKU (`variant_id`, `sku_id`)** | Sellable and stockable item variation (e.g., `TSHIRT-BLK-M`) with a normalized SKU code, barcode, base unit, and base selling price. | `catalog` |
| **Stock Balance (`StockBalanceAggregate`)** | Per-warehouse, per-SKU authoritative inventory record holding `on_hand_qty`, `reserved_qty`, `available_qty = on_hand_qty - reserved_qty`, and `avg_unit_cost` (`WAC`). | `inventory` |
| **Stock Reservation** | Temporary hold on `available_qty` for a confirmed Sales Order prior to physical fulfillment dispatch. | `inventory` |
| **Order (`OrderAggregate`)** | Omnichannel or POS customer purchase governed by a 3D state machine (`orderStatus`, `paymentStatus`, `fulfillmentStatus`). | `sales` |
| **POS Shift** | Cashier drawer session tracking `opening_cash`, `cash_sales_total`, `cash_refunds_total`, `expected_cash`, `actual_cash`, and `variance`. | `sales` |
| **Loyalty Account & Tier** | Customer points balance (`available_points`, `lifetime_earned_points`) and spend-based tier (`BRONZE`, `SILVER`, `GOLD`, `PLATINUM`). | `customer` |
| **Journal Entry** | Immutable double-entry accounting record whose lines satisfy $\sum \text{Debit} = \sum \text{Credit} > 0$. | `finance` |
| **Channel Connection (`ChannelConnectionAggregate`)** | Authenticated link between a Tenant's Branch/Warehouse and an external marketplace shop (`SHOPEE` or `LAZADA`). | `integration` |
| **Publishable Quantity** | Marketplace stock quantity computed as $\max(0, \lfloor (\text{on\_hand} - \text{reserved} - \text{safety\_buffer}) \times \text{allocation\_pct} / 100 \rfloor)$. | `integration` |
| **Analytical Projection** | Idempotent, rebuildable read-model table (`daily_sales_rollup`, `daily_product_metrics`, `inventory_daily_snapshot`) derived strictly from domain events. | `insight` |

---

## 2. Same-Term Disambiguation Across Bounded Contexts

| Shared Term | Meaning in `catalog` | Meaning in `inventory` | Meaning in `sales` | Meaning in `finance` / `insight` |
|---|---|---|---|---|
| **Price / Cost** | `base_price` & `compare_at_price` (selling price definitions in Price Books). Never stores moving-average cost. | `avg_unit_cost` (Weighted-Average Cost `WAC` updated on Stock Receipt) & `valuation_amount`. | `unit_price` (authoritative selling price at checkout), `line_net` (post-discount), and `unit_cost_snapshot` (captured at fulfillment). | `cogs_amount` (recognized Cost of Goods Sold on order completion) and `gross_profit = net_revenue - cogs`. |
| **Order** | N/A | `PurchaseOrder` (inbound supplier procurement document). | `OrderAggregate` (outbound customer POS or omnichannel sales order). | `ArInvoice` / `SalesOrderFact` (financial receivable and analytical revenue fact). |
| **Return** | N/A | Inbound `RETURN_RESTOCK` or `RETURN_DAMAGED` stock movement. | `SalesReturn` (pro-rated customer return against original discounted `OrderItem` lines). | `REFUND` journal posting and `SalesReturnFact` revenue/COGS reversal. |
