-- Reverse 0145: drop the fiscal-year close columns. The `is_postable` flip on 2130001 is
-- intentionally NOT reverted: a year already closed keeps its closing entry posted there.
ALTER TABLE fiscal_years DROP COLUMN IF EXISTS closing_entry_id;
ALTER TABLE fiscal_years DROP COLUMN IF EXISTS closed_at;
ALTER TABLE fiscal_years DROP COLUMN IF EXISTS closed_by;
ALTER TABLE fiscal_years DROP COLUMN IF EXISTS notes;
