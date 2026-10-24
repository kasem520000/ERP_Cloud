-- MF-15 / دفقة D4 — «قفل الكشف بعد الاعتماد»: توسعة قيد حالة الكشف ليقبل 'approved'.
-- التحقّق الحيّ قبل الترحيل: POST /treasury/bank-statements/:id/approve كان ينتهي بـ500
-- على `bank_statements_status_check` (0096: processing/processed/reconciled/error فقط).
ALTER TABLE bank_statements DROP CONSTRAINT bank_statements_status_check;
ALTER TABLE bank_statements
  ADD CONSTRAINT bank_statements_status_check
  CHECK (status IN ('processing', 'processed', 'reconciled', 'error', 'approved'));
