-- الاستعادة الفعلية — «نسخةٌ تُستعاد» لا «نسخةٌ تُتحقَّق فقط».
--
-- لماذا جدولٌ رابع بدل أعمدةٍ في `backup_jobs`؟ لأن العلاقة ليست واحدة-لواحد: النسخة
-- الواحدة قد تُستعاد عدّة مرّات (تجربةٌ على بيئةٍ أخرى، ثم استعادةٌ بعد حادث)، ولكل
-- محاولةٍ عدّاداتها وسببها ومَن نفّذها. ووضعُ ذلك في صفّ النسخة كان سيمحو أثر المحاولة
-- السابقة في كل مرّة.
--
-- والوعد الذي يحكمه هذا الجدول صريح: **إضافية فقط**. `inserted` ما أُدرج، و`skipped` ما
-- كان موجوداً فتُخطّي، و`failed` ما رفضته القاعدة (مفتاح أجنبي، قيد، انحراف مخطّط) —
-- والثلاثة تُقرأ من التنفيذ لا من تقدير. `summary` يحمل جدولاً بجدولٍ ليكون الجواب
-- «أيُّ جدولٍ لم يدخل؟» لا «نجحت الاستعادة».
CREATE TABLE IF NOT EXISTS backup_restores (
  id             uuid PRIMARY KEY,
  job_id         uuid        NOT NULL REFERENCES backup_jobs (id) ON DELETE CASCADE,
  artifact_id    uuid        REFERENCES backup_artifacts (id) ON DELETE SET NULL,
  mode           text        NOT NULL DEFAULT 'dry_run'
                             CHECK (mode IN ('dry_run', 'apply')),
  status         text        NOT NULL DEFAULT 'dry_run'
                             CHECK (status IN ('dry_run', 'succeeded', 'partial', 'failed')),
  scope          text        NOT NULL DEFAULT 'platform'
                             CHECK (scope IN ('platform', 'tenant')),
  tenant_id      uuid        REFERENCES tenants (id) ON DELETE SET NULL,
  -- البصمة التي وُقّعت عليها هذه المحاولة: استعادةٌ بعد تغيّر الملف لا تُقبل.
  checksum       text        NOT NULL,
  verified       boolean     NOT NULL DEFAULT false,
  tables         integer     NOT NULL DEFAULT 0 CHECK (tables >= 0),
  inserted       integer     NOT NULL DEFAULT 0 CHECK (inserted >= 0),
  skipped        integer     NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  failed         integer     NOT NULL DEFAULT 0 CHECK (failed >= 0),
  summary        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,
  -- سببٌ مكتوب لا يُختصر: من استعاد نسخةً يجب أن يقول لماذا، ويُقرأ السبب في التدقيق
  -- وفي السجلّ نفسه حتى بعد أن ينسى أحدٌ أنه استعاد.
  reason         text        CHECK (reason IS NULL OR length(reason) BETWEEN 5 AND 500),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  duration_ms    integer     CHECK (duration_ms IS NULL OR duration_ms >= 0),
  requested_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT backup_restores_finish_check CHECK (
    (finished_at IS NULL) OR (finished_at >= started_at)
  )
);

CREATE INDEX IF NOT EXISTS backup_restores_job_idx ON backup_restores (job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS backup_restores_started_idx ON backup_restores (started_at DESC);

-- صفوف منصّة بلا استثناء: القارئ مشغّل المنصّة وحده (`console.backups.manage`)، والجدول
-- لا `tenant_id` فيه أصلاً — بل `tenant_id` هنا **موضوع** الاستعادة لا مالك الصفّ.
ALTER TABLE backup_restores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_admin_plane ON backup_restores;
CREATE POLICY platform_admin_plane ON backup_restores
  USING (COALESCE(current_setting('app.is_platform_admin', true), 'off') = 'on')
  WITH CHECK (COALESCE(current_setting('app.is_platform_admin', true), 'off') = 'on');
