-- 0137_print_template_design.down.sql
--
-- ⚠️ ما يُفقد عند التراجع: **تصميمٌ لا محاسبة**. الأعمدةُ الخمسة زينةُ الورقة — قالبٌ ولونٌ
--    وخطٌّ ومقياسٌ وسطرُ توقيعات — ولا يدخل أيٌّ منها في قيدٍ أو مبلغٍ أو مخزون. فتراجعُها
--    يُعيد كل ورقةٍ إلى الشكل الكلاسيكي الذي كانت عليه قبل ٠١٣٧، ولا يمسّ صفًّا آخر ولا
--    يُعيد كتابة بيانات.
--
--    وما يُفقد هو ما اختاره المستخدم صراحةً في «مصمّم القوالب»: من اختار «عصري» بلونٍ
--    أخضرَ وخطٍّ نسخي سيجد ورقته بعد التراجع كلاسيكيةً سوداء بخطّ Segoe — وهو نفس المعنى
--    الذي يؤدّيه زرّ «استعادة الافتراضي» في الشاشة، فلا مفاجأة فيه. والتقاريرُ نفسها
--    (الأعمدة، المجاميع، والتوقيعات التي يطلبها الكتالوج) تُخرج كما كانت: `printStyle()`
--    بعد التراجع لا يجد أعمدةً يسأل عنها، فيسقط إلى الافتراضي — ولهذا تُنشر الهجرةُ عكسًا
--    مع الإصدار الذي لا يقرأ هذه الأعمدة، لا قبله ولا بعده.
--
--    والقيودُ تُسقَط قبل الأعمدة (وإلا رفضت القاعدةُ إسقاطَ عمودٍ يحمله قيد)، وكلُّها
--    `IF EXISTS` حتى يكون التراجع صالحًا للتشغيل مرتين بلا خطأ.

ALTER TABLE print_settings DROP CONSTRAINT IF EXISTS print_settings_accent_color_check;
ALTER TABLE print_settings DROP CONSTRAINT IF EXISTS print_settings_font_scale_check;
ALTER TABLE print_settings DROP CONSTRAINT IF EXISTS print_settings_font_family_check;
ALTER TABLE print_settings DROP CONSTRAINT IF EXISTS print_settings_template_check;

ALTER TABLE print_settings
  DROP COLUMN IF EXISTS show_signatures,
  DROP COLUMN IF EXISTS font_scale,
  DROP COLUMN IF EXISTS font_family,
  DROP COLUMN IF EXISTS accent_color,
  DROP COLUMN IF EXISTS template;
