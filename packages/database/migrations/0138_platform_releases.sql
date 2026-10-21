-- 🗜️ تحديث المنصّة عبر حزمة ZIP — سجلُّ الإصدارات.
--
-- الفكرة: الحزمة **بيانُ نشرٍ** لا شيفرة. خطّ النشر (`deploy/`) يبني أرشيفاً فيه
-- `release.json` (الإصدار والقناة وما الجديد وبصمة الحزمة) مع بقية محتويات الإصدار،
-- ويرفعه المشغّل من لوحة المنصّة. الخادم يفحص بنية الأرشيف (بلا فكّ ضغطٍ إلا للبيان)،
-- ويرفض ما فيه مسارٌ هارب أو ملفٌّ تنفيذي أو قيدٌ مشفّر، ثم يُثبّت **قياسَ** الحزمة هنا:
-- الإصدار والقناة والبصمة والحجم والملفات والقرار.
--
-- لماذا لا تُخزَّن البايتات: أرشيفٌ قابل للتنفيذ على جهاز الـAPI دينٌ أمنيّ بلا مقابل؛
-- والمطلوب هو أن يُعرف ما نُشر بأرقامه (بصمة/حجم/عدد) لا أن يُحفظ ملفّه. والنسخ
-- الاحتياطي جدولٌ آخر (`backup_artifacts`) لأن ذاك بياناتُ عميلٍ مآلها الاستعادة.
--
-- ولا `tenant_id`: جدولُ منصّةٍ خالص، يقرؤه المشغّل عبر `withPlatformAdminTx`، ويقرأ
-- منه المستأجر **سطراً واحداً** (الإصدار الحالي) عبر مسارٍ مخصّص لا يمرّر الاستعلام.
CREATE TABLE IF NOT EXISTS platform_releases (
  -- المعرّف يُولّده التطبيق (`newId()`), كبقية الجداول: لا افتراضيّ في القاعدة.
  id                uuid PRIMARY KEY,
  -- رقم الإصدار كما في `release.json` — والقيد يمنع نصّاً لا يُقارَن (‏وقد فُحص في zod أيضاً).
  -- و`NULL` في حزمةٍ رُفضت قبل قراءة بيانها: لا نلفّق رقماً لإصدارٍ لم نقرأه.
  version           text        CHECK (version IS NULL OR version ~ '^[0-9]+(\.[0-9]+){1,3}(-[0-9A-Za-z.]+)?$'),
  channel           text        NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable', 'beta')),
  -- المرفوضة تبقى: «من حاول نشر ماذا ولماذا رُفض» سؤالُ تدقيقٍ لا يُجاب بحذف الصفّ.
  status            text        NOT NULL DEFAULT 'accepted'
                                CHECK (status IN ('accepted', 'rejected', 'revoked')),
  notes             text        NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  highlights        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  min_from_version  text        CHECK (min_from_version IS NULL OR min_from_version ~ '^[0-9]+(\.[0-9]+){1,3}(-[0-9A-Za-z.]+)?$'),
  filename          text        NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  bytes             integer     NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  entries           integer     NOT NULL DEFAULT 0 CHECK (entries >= 0),
  -- بصمة `sha256` لما استُلم فعلاً — لا لما ادّعاه البيان.
  checksum          text        NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  checksum_verified boolean     NOT NULL DEFAULT false,
  files             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  reason            text        NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  rejection_code    text,
  rejection_detail  text,
  -- الإصدار المعروض للمستأجرين: واحدٌ لكل قناة على الأكثر (فهرسٌ فريدٌ جزئي).
  is_current        boolean     NOT NULL DEFAULT false,
  uploaded_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  -- ولا يُعلَن «حاليّاً» ما لم يُقبل، ولا ما سُحب.
  CONSTRAINT platform_releases_current_accepted_check
    CHECK (NOT is_current OR status = 'accepted'),
  CONSTRAINT platform_releases_revoked_check
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT platform_releases_rejection_check
    CHECK ((status = 'rejected') = (rejection_code IS NOT NULL))
);

-- إصدارٌ واحد حاليٌّ لكل قناة؛ والتراجع يُطفئ العلم قبل أن يُشعل على سابقه (في المعاملة).
CREATE UNIQUE INDEX IF NOT EXISTS platform_releases_one_current_idx
  ON platform_releases (channel) WHERE is_current;

-- رقمُ إصدارٍ واحد لكل قناةٍ **بين المقبولة والمسحوبة**. أمّا المرفوضة فلا تدخل الفهرس:
-- محاولتان لرفع الحزمة نفسها سجلانِ («كم مرّة حاولوا؟»)، وليست الثانية تكراراً يُرفض.
CREATE UNIQUE INDEX IF NOT EXISTS platform_releases_version_channel_key
  ON platform_releases (version, channel) WHERE status <> 'rejected';

CREATE INDEX IF NOT EXISTS platform_releases_uploaded_idx
  ON platform_releases (uploaded_at DESC);

-- ───────────────────────────────────────────────────────────── رموز الصلاحية
--
-- الشاشتان تُحرَسان برمزَين في سجلّ المنصّة، والرمز الذي لا سطرَ له في جدول `permissions`
-- لا يمنحه أيّ دور — فالمسار يبقى 403 أبدياً. والسطر هنا لا في البذرة: قاعدةٌ مُهاجَرة
-- بـ`pnpm db:migrate` وحدها (بلا `db:seed`) يجب أن تعرف الرمز، وإلا سقط الاختبار
-- `permission-codes.spec.ts` وسقط معه أوّل دخولٍ لشاشة الإصدارات.
--
-- و`ON CONFLICT … DO UPDATE` تكتب الوصف مرّةً أخرى بلا أثر: البذرة تكتب السطر نفسه،
-- فالترتيب بينهما لا يهمّ.
INSERT INTO permissions (code, module, description) VALUES
  ('console.releases.view', 'console', 'Read the platform release ledger and the release shown to tenants.'),
  ('console.releases.manage', 'console', 'Upload, promote and revoke platform releases. Archive contents are never executed.')
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description;
