-- MF-04 / MF-05 (خطة MISSING_FEATURES — المرحلة 1 «الرقابة والإقفال»):
-- 1) حقول إقفال السنة المالية على `fiscal_years` (قيد الإقفال + من أقفل ومتى + ملاحظات
--    إعادة الفتح). لا «قيد افتتاح»: الدفتر محصل (الرصيد الرأسمالي يحمل نفسه) — وإلا
--    انهار اتساق الفرعي (الصندوق/الذمم/المخزون) في اليوم الأول من السنة التالية.
-- 2) ورقة «2130001 أرباح و خسائر» في دليل الديسكتوب كانت عَلَامة تجميعٍ بلا أولاد،
--    فحظر ACC-170 الترحيل إليها ويُستحيل إقفال الدخل — تُفعَّل هنا ولديسكتوب-coa.

ALTER TABLE fiscal_years ADD COLUMN IF NOT EXISTS closing_entry_id uuid REFERENCES journal_entries(id);
ALTER TABLE fiscal_years ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE fiscal_years ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES users(id);
ALTER TABLE fiscal_years ADD COLUMN IF NOT EXISTS notes text;

UPDATE accounts a
   SET is_postable = true
 WHERE a.code = '2130001'
   AND a.is_postable = false
   AND NOT EXISTS (
     SELECT 1 FROM accounts c
      WHERE c.tenant_id = a.tenant_id
        AND c.code LIKE a.code || '%'
        AND c.code <> a.code
   );
