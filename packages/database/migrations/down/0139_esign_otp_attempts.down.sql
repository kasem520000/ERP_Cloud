-- 0139_esign_otp_attempts.down.sql
--
-- ⚠️ ما يُفقد عند التراجع: **عدّاد المحاولات وقفلُه** — لا أثر مالي ولا توقيعٌ محفوظ.
--    والطلبات الموقّعة تبقى موقّعة.
--
--    وما يعود هو الثغرة التي أغلقتها الهجرة: رمزٌ بستة أرقام بلا حدّ محاولات. ولذلك
--    تُعاد الحالتان الجديدتان إلى أقرب حالةٍ تفهمها القيود القديمة بدل أن يفشل التراجع:
--    `locked` ⇒ `declined` (كلاهما «لا توقيع على هذا الطلب»، والفرق يبقى في `esign_events`
--    الذي يُنظَّف هنا لأنه لا يقبل الحدثين الجديدين). فالتاريخ لا يُزوَّر، والتراجع يُقال
--    صريحاً إنه فقد التمييز بين الرفض ونفاد المحاولات.

UPDATE esign_requests SET status = 'declined' WHERE status = 'locked';
DELETE FROM esign_events WHERE event IN ('otp_failed', 'locked');

ALTER TABLE esign_events DROP CONSTRAINT IF EXISTS esign_events_event_check;
ALTER TABLE esign_events
  ADD CONSTRAINT esign_events_event_check
  CHECK (event IN ('sent', 'viewed', 'signed', 'declined'));

ALTER TABLE esign_requests DROP CONSTRAINT IF EXISTS esign_requests_status_check;
ALTER TABLE esign_requests
  ADD CONSTRAINT esign_requests_status_check
  CHECK (status IN ('sent', 'viewed', 'signed', 'declined'));

ALTER TABLE esign_requests DROP COLUMN IF EXISTS otp_attempts;
