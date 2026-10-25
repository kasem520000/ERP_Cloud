-- MF-29 / دفقة D13 — DKIM/SPF وتحديد معدل لكل مرسل:
--   • `email_settings.dkim_selector` — مُعرِّف selector لسجل DKIM (مثال: `google`).
--   • `email_settings.dkim_public_key` — المفتاح العام لسجل DKIM (نصٌّ مُعرَف).
--   • `email_settings.spf_record` — نصّ سجل SPF للمساعدة في العرض.
--   • `email_settings.per_recipient_rate_limit` — سقف الرسائل إلى نفس العنوان في 24 ساعة.
--   آمن للإعادة التشغيل: `IF NOT EXISTS`، ولا شيء يُحذف.

ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS dkim_selector text;
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS dkim_public_key text;
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS spf_record text;
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS per_recipient_rate_limit integer CHECK (per_recipient_rate_limit >= 1);
