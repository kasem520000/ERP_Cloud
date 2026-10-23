-- ACC-153 / ACC-167 (R32 remediation): customer returns that come back onto the van are a counter of
-- their own. `returned_qty` stays what the rep hands back to the warehouse at closing.
ALTER TABLE van_load_orders
  ADD COLUMN IF NOT EXISTS customer_returned_qty numeric(20, 4) NOT NULL DEFAULT 0;

-- Back-fill from the return documents already written against each load order.
UPDATE van_load_orders l
SET customer_returned_qty = sub.qty
FROM (
  SELECT d.load_order_id, SUM(d.sold_qty) AS qty
  FROM van_sales_documents d
  WHERE d.document_kind = 'return' AND d.deleted_at IS NULL AND d.load_order_id IS NOT NULL
  GROUP BY d.load_order_id
) sub
WHERE sub.load_order_id = l.id;
