-- ACC-088: ربط حركة الراتب بسند الصرف
ALTER TABLE salary_adjustments
  ADD COLUMN IF NOT EXISTS voucher_id uuid REFERENCES vouchers (id) ON DELETE SET NULL;

COMMENT ON COLUMN salary_adjustments.voucher_id IS
  'سند الصرف المنشأ من الخزينة عند سداد سلفة أو مكافأة نقدية فورية';
