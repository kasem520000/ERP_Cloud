-- 0134 — مزوّدات البريد الأربعة كانت ممنوعة في القيد: «حفظ الإعدادات» ينجح، «اختبار الإرسال» يفشل.
--
-- `email_settings_provider_check` في 0070 حصر المزوّد في ('console','smtp')، ومعها قيد
-- `email_messages_provider_check`. فحين يختار المشغّل «resend» تُكتب الإعدادات (القيد هنا
-- كان يقبلها؟ لا — انظر أدناه) ثم يفشل إدراج الرسالة التجريبية بـ23514، فيرى المستخدم
-- «خطأ غير متوقع» بلا سبب. والتطبيق يعرف أربعة مزوّدات: console · smtp · resend · http.
--
-- نوسّع القيدين إلى القائمة الفعلية، فيعود اختيار Resend قابلاً للحفظ والفحص.
ALTER TABLE email_settings DROP CONSTRAINT IF EXISTS email_settings_provider_check;
ALTER TABLE email_settings
  ADD CONSTRAINT email_settings_provider_check
  CHECK (provider IN ('console', 'smtp', 'resend', 'http'));

ALTER TABLE email_messages DROP CONSTRAINT IF EXISTS email_messages_provider_check;
ALTER TABLE email_messages
  ADD CONSTRAINT email_messages_provider_check
  CHECK (provider IN ('console', 'smtp', 'resend', 'http'));
