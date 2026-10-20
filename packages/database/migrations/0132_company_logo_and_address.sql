-- 0132 — شعار المنشأة وعنوانها الوطني على كل وثيقة مطبوعة.
--
-- لماذا عمودٌ في `company_profiles` ولا `files` فقط؟
--   * قوالب الطباعة تُبنى HTML مكتفياً بذاته (`print-templates.service.ts`): لا CSS ولا
--     خطوط ولا صور خارجية. الشعار كـ data URL يعيش داخل الصفحة نفسها، فيُطبع ويُحفظ PDF
--     ويعمل في iframe بلا جلسة ولا رابطٍ موقّع تنتهي صلاحيته أثناء الطباعة.
--   * `logo_file_id` يبقى: النشرات التي فيها تخزين كائنات (S3/MinIO) تستعمله، والقوالب
--     تفضّل data URL ثم الرابط الموقّع.
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS logo_data_url text;

COMMENT ON COLUMN company_profiles.logo_data_url IS
  'شعار المنشأة كـ data:image/...;base64 — يُطبع داخل الوثيقة نفسها. الحدّ 700 كيلوبايت يُفرض في العقد.';
