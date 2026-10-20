-- سجلّ أخطاء السيرفر — البند 3 من قائمة 20 أكتوبر.
--
-- «سجلّ الأخطاء يجب أن يسجّل أي خطأ أو مشكلة من جانب السيرفر في كل السيرفرات.» وكانت
-- الشاشة تجمع خمسة مصادر كلٌّ منها *صفٌّ فشل في جدوله* (بريد، فاتورة، ويب هوك، طابور،
-- نسخة). أمّا خطأ 5xx عابرٌ في مسارٍ لا يملك جدولاً — أو استثناءٌ لم يُلتقط في العملية
-- نفسها — فلم يكن يُكتب في أي مكان. هذا الجدول هو مكانه.
--
-- ولا يُكتب فيه كل 4xx: طلبٌ معطوب من مستخدم ليس عطباً في الخادم، وسجلٌّ يمتلئ بأخطاء
-- التحقّق يفقد قيمته. ما يُكتب: 5xx في الـAPI، واستثناءات العملية (uncaughtException /
-- unhandledRejection)، وما يبلّغ عنه سيرفرُ Next (onRequestError) عبر مسار الاستقبال.
CREATE TABLE IF NOT EXISTS platform_problem_events (
  id            uuid PRIMARY KEY,
  -- من أي سيرفرٍ جاء الحدث: الـAPI نفسه، أو لوحة الموظفين، أو لوحة المنصّة…
  source        text        NOT NULL DEFAULT 'api'
                            CHECK (source IN ('api', 'staff', 'platform-admin', 'marketing', 'customer-portal', 'bakery', 'worker')),
  severity      text        NOT NULL DEFAULT 'error' CHECK (severity IN ('error', 'warning')),
  code          text,
  message       text        NOT NULL,
  path          text,
  method        text,
  status        integer     CHECK (status IS NULL OR status BETWEEN 100 AND 599),
  trace_id      text,
  tenant_id     uuid,
  actor_user_id uuid,
  meta          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_problem_events_recent_idx
  ON platform_problem_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS platform_problem_events_source_idx
  ON platform_problem_events (source, occurred_at DESC);
-- التكرار: الاستثناء نفسه في المسار نفسه لا يُكتب مئة مرّة في الدقيقة؛ العدّاد في meta.
CREATE INDEX IF NOT EXISTS platform_problem_events_trace_idx
  ON platform_problem_events (trace_id)
  WHERE trace_id IS NOT NULL;

-- صفوف منصّة: القارئ مشغّل المنصّة وحده (console.health.view)، والكتابة من الـAPI نفسه.
ALTER TABLE platform_problem_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_admin_plane ON platform_problem_events;
CREATE POLICY platform_admin_plane ON platform_problem_events
  USING (COALESCE(current_setting('app.is_platform_admin', true), 'off') = 'on')
  WITH CHECK (COALESCE(current_setting('app.is_platform_admin', true), 'off') = 'on');
