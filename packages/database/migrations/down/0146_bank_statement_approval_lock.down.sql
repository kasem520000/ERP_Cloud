-- هابط 0146 — عودة قيد0096 حرفيّاً: أي كشف معتمَد يعود 'reconciled' (أقرب حالة
-- محسوبة منهجة الأسطر) قبل تضييق القيد؛ وما عدا ذلك يبقى كما هو.
UPDATE bank_statements SET status = 'reconciled' WHERE status = 'approved';
ALTER TABLE bank_statements DROP CONSTRAINT bank_statements_status_check;
ALTER TABLE bank_statements
  ADD CONSTRAINT bank_statements_status_check
  CHECK (status IN ('processing', 'processed', 'reconciled', 'error'));
