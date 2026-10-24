-- Reverse 0144: drop the due-date and party credit-term columns (derived data only).
ALTER TABLE sales_invoices DROP COLUMN IF EXISTS due_date;
ALTER TABLE purchase_invoices DROP COLUMN IF EXISTS due_date;
ALTER TABLE parties DROP COLUMN IF EXISTS payment_terms_days;
ALTER TABLE parties DROP COLUMN IF EXISTS credit_hold;
