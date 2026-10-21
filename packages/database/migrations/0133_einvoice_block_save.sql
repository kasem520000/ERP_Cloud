-- 0133 — «منع الحفظ عند الربط الضريبي».
--
-- خيارٌ في نافذة الربط الضريبي: ما دام الربط مع الهيئة مفعّلاً، لا تُحفظ فاتورة مبيعات
-- **كمسودة**؛ تُرحَّل في نفس الطلب فتأخذ رقمها ورمزها وتُرسل. الافتراضي `false` حتى لا
-- يتغيّر سلوك أي منشأة قائمة.
ALTER TABLE einvoice_settings
  ADD COLUMN IF NOT EXISTS block_save_when_linked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN einvoice_settings.block_save_when_linked IS
  'منع الحفظ عند الربط الضريبي: لا مسودّات مبيعات ما دام الربط مفعّلاً.';
