-- 0128_van_sales_shortage_charge.down.sql
--
-- ⚠️ ما يُفقد عند التراجع: الدليل على **تنفيذ** تحميل العجز على المندوب — أيّ قيدٍ رُحِّل، وبأيّ
-- أساسٍ قُيِّم، وكم بلغ. القيد نفسه يبقى في `journal_entries` (فهو سجلٌّ ماليّ لا يُمحى بتراجع
-- ترحيل)، لكنّ الربط بينه وبين أمر التحميل ينقطع: فلا يعود ممكناً أن تقول «عجز VLO-0007 رُحِّل
-- على ذمّة الموظف بالتكلفة 3.80 ريال» من صفّ الأمر، ويبقى `salary_deduction_approved` علماً بلا
-- دليل — أي الحالة نفسها التي جاء هذا الترحيل ليُنهيها.
--
-- والفهرس يسقط مع العمود، فلا يبقى استعلام «أيّ الأوامر رُحِّل عجزها؟» ممكناً.

DROP INDEX IF EXISTS van_load_orders_shortage_entry_idx;

ALTER TABLE van_load_orders
  DROP COLUMN IF EXISTS shortage_charge_amount,
  DROP COLUMN IF EXISTS shortage_charge_basis,
  DROP COLUMN IF EXISTS shortage_journal_entry_id;
