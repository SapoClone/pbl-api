BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL row_security=off;
WITH events AS (
 SELECT o.*,f.event_id finance_id,i.event_id integration_id,s.event_id insight_id
 FROM inventory.outbox_event o
 LEFT JOIN finance.inbox_event f ON f.event_id=o.id
 LEFT JOIN integration.inbox_event i ON i.event_id=o.id
 LEFT JOIN insight.inbox_event s ON s.event_id=o.id
 WHERE o.tenant_id=:'perf_tenant'::uuid AND o.type IN ('inventory.stock.changed','inventory.stock.received')
)
SELECT jsonb_build_object(
 'database',current_database(),'transaction_read_only',current_setting('transaction_read_only'),
 'receipts',(SELECT count(*) FROM inventory.stock_receipt WHERE tenant_id=:'perf_tenant'::uuid),
 'posted_receipts',(SELECT count(*) FROM inventory.stock_receipt WHERE tenant_id=:'perf_tenant'::uuid AND status='POSTED'),
 'receipt_items',(SELECT count(*) FROM inventory.stock_receipt_item WHERE tenant_id=:'perf_tenant'::uuid),
 'ledger',(SELECT count(*) FROM inventory.stock_balance_ledger WHERE tenant_id=:'perf_tenant'::uuid),
 'balances',(SELECT count(*) FROM inventory.stock_balance WHERE tenant_id=:'perf_tenant'::uuid),
 'on_hand_total',(SELECT coalesce(sum(on_hand_qty),0) FROM inventory.stock_balance WHERE tenant_id=:'perf_tenant'::uuid),
 'valuation_total',(SELECT coalesce(sum(valuation_amount),0) FROM inventory.stock_balance WHERE tenant_id=:'perf_tenant'::uuid),
 'wac_bad_rows',(SELECT count(*) FROM inventory.stock_balance WHERE tenant_id=:'perf_tenant'::uuid AND (avg_unit_cost<>100000 OR valuation_amount<>round(on_hand_qty*avg_unit_cost))),
 'stock_changed',(SELECT count(*) FROM events WHERE type='inventory.stock.changed'),
 'stock_received',(SELECT count(*) FROM events WHERE type='inventory.stock.received'),
 'bad_event_rows',(SELECT count(*) FROM events WHERE published_at IS NULL OR failed_at IS NOT NULL OR attempts<>0 OR last_error IS NOT NULL OR insight_id IS NULL OR (type='inventory.stock.changed' AND integration_id IS NULL) OR (type='inventory.stock.received' AND finance_id IS NULL))
)::text;
ROLLBACK;
