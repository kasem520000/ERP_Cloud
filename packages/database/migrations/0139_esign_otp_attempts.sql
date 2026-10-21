-- SH-06 / S-05 — حدُّ محاولات رمز التوقيع.
--
-- الرمز ستةُ أرقام (10^6 احتمال)، والرابط يصل بالبريد ويبقى صالحاً سبعة أيام. وبلا عدّاد
-- محاولات، كان حاملُ الرابط (بريد مُعاد توجيهه، أو صندوقٌ مشترك) يخمّن بالسرعة التي يسمح
-- بها سقفُ IP وحده: 10/دقيقة × 7 أيام ≈ 100 ألف محاولة ≈ 10% احتمال نجاح. الحدّ في
-- القاعدة لا في الذاكرة: العدّاد يُقرأ ويُزاد تحت قفل صفّ الطلب نفسه.
--
-- و`locked` حالةٌ نهائيّة مقصودة (لا `declined`): الرفض قرار الموقّع، والقفل نفادُ محاولات،
-- وإعادة الإرسال تُنشئ طلباً جديداً برمز جديد.

ALTER TABLE esign_requests ADD COLUMN IF NOT EXISTS otp_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE esign_requests DROP CONSTRAINT IF EXISTS esign_requests_status_check;
ALTER TABLE esign_requests
  ADD CONSTRAINT esign_requests_status_check
  CHECK (status IN ('sent', 'viewed', 'signed', 'declined', 'locked'));

ALTER TABLE esign_events DROP CONSTRAINT IF EXISTS esign_events_event_check;
ALTER TABLE esign_events
  ADD CONSTRAINT esign_events_event_check
  CHECK (event IN ('sent', 'viewed', 'signed', 'declined', 'otp_failed', 'locked'));
