-- 0157_print_design_config.sql
--
-- توسعة مصمّم قوالب الطباعة الفعلي (`design_config`):
-- يتيح لكل منشأة تخصيص تصميم كل تقرير أو مستند مطبوع (كاشير، فاتورة مبيعات، مرتجع،
-- مشتريات، سند قبض/صرف، قيد يومية، إغلاق وردية، أو أي تقرير مالي/مخزني) من حيث:
-- مقاس الورق الحراري (80mm/58mm)، اتجاه الورقة وهوامشها، ترتيب الأقسام وإظهارها/إخفاؤها،
-- اختيار وترتيب وتسمية أعمدة الجدول، الحقول والنصوص المخصصة الإضافية، مسميات التوقيعات،
-- حجم وموضع الشعار ورمز الاستجابة السريعة (QR)، والعلامة المائية.
-- لا يمسّ أي قيد محاسبي أو مبلغ مالي أو متطلبات الفوترة الضريبية الإلزامية.

ALTER TABLE print_settings
  ADD COLUMN IF NOT EXISTS design_config jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_settings_design_config_object_check') THEN
    ALTER TABLE print_settings
      ADD CONSTRAINT print_settings_design_config_object_check
      CHECK (jsonb_typeof(design_config) = 'object');
  END IF;
END $$;
