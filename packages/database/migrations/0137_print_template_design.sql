-- مصمّم القوالب — «الورقة ليست ورقةً واحدة للجميع».
--
-- إعدادات الطباعة القائمة تحكم **ما يُطبع** (ترويسة، تذييل، ختم، نسخ، ورق). ما لم يكن
-- قابلاً للاختيار هو **كيف يبدو**: كانت كل ورقة تُخرج بنفس الجدول الرمادي ونفس الخط
-- ونفس الحدود، فمنشأةٌ تطبع فاتورة لعملائها بلا أي أثرٍ بصري يخصّها.
--
-- الأعمدة هنا **تصميمٌ لا بيانات**: كلٌّ منها قيمةٌ صغيرةٌ تُقرأ عند بناء الـHTML، وغيابها
-- يعطي الشكل الكلاسيكي الذي كان. ولهذا كلّها `NOT NULL DEFAULT` أو NULL مسموح، فالصفوف
-- القائمة (وكل استعادة نسخةٍ قديمة) تبقى صالحة بلا هجرة بيانات.
--
-- والقيم محكومةٌ بقيدٍ في القاعدة لا في الخدمة وحدها: لونٌ يُحقن في <style> هو مدخل CSS
-- injection لو تُرك نصًّا حرًّا، فالقيود تقصرُه على صيغةٍ واحدة.
ALTER TABLE print_settings
  -- 🎨 القالب: كلاسيكي (الحالي) · عصري (شريط لونٍ وحدود ناعمة) · مختصر (خطوط رفيعة بلا تعبئة).
  ADD COLUMN IF NOT EXISTS template text NOT NULL DEFAULT 'classic',
  -- 🖌️ لون التمييز. فارغ = لون هوية المنشأة، وإن غاب فأسود الورقة.
  ADD COLUMN IF NOT EXISTS accent_color text,
  -- ✍️ عائلة الخط، من ثلاث عائلاتٍ موجودة على النظام — لا خطوط تُحمَّل من الشبكة،
  -- لأن الورقة تُفتح للطباعة في بيئةٍ قد لا تصل إلى الإنترنت.
  ADD COLUMN IF NOT EXISTS font_family text NOT NULL DEFAULT 'segoe',
  -- 🔎 مقياس الخط بالنسبة المئوية (85..130) — يُضرب في أحجام القالب كلها.
  ADD COLUMN IF NOT EXISTS font_scale integer NOT NULL DEFAULT 100,
  -- ✒️ سطر التوقيعات في التقارير («أعده · راجعه · المدير»).
  ADD COLUMN IF NOT EXISTS show_signatures boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_settings_template_check') THEN
    ALTER TABLE print_settings
      ADD CONSTRAINT print_settings_template_check CHECK (template IN ('classic', 'modern', 'minimal'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_settings_font_family_check') THEN
    ALTER TABLE print_settings
      ADD CONSTRAINT print_settings_font_family_check CHECK (font_family IN ('segoe', 'naskh', 'sans'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_settings_font_scale_check') THEN
    ALTER TABLE print_settings
      ADD CONSTRAINT print_settings_font_scale_check CHECK (font_scale BETWEEN 85 AND 130);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_settings_accent_color_check') THEN
    ALTER TABLE print_settings
      ADD CONSTRAINT print_settings_accent_color_check
      CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$');
  END IF;
END $$;
