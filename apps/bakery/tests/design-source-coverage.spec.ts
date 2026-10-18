import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * حارسُ «توجيهِ مسح Tailwind إلى مكتبة الواجهة».
 *
 * العيبُ الذي يمنعه، مقاسٌ لا مُتخيَّل: ‏Tailwind v4 يكشف المصادر تلقائيًّا ويتجاهل
 * `node_modules`، ولا خيار `content` في `postcss.config.mjs` — فكان كلّ صنفٍ مكتوبٍ داخل
 * مكوّنات `@erp/ui` وحدها لا يُولَّد مرافقُه في أيّ تطبيق. والدليلُ بالمسبار (‏`postcss` +
 * `@tailwindcss/postcss` على `app/globals.css` من جذر التطبيق) قبل إضافة `@source`:
 *
 *   apps/staff            ١٠٣٦٣٤ بايت · مفقود ١٠/١٠
 *   apps/platform-admin    ٩٤٨٢٥ بايت · مفقود ١٠/١٠
 *   apps/marketing         ٥٣٦٤٩ بايت · مفقود ١٠/١٠
 *   apps/bakery            ٤١٤٤٥ بايت (CSS مبنية) · `.bg-brand` ٠ · `.text-brand-ink` ٠ · `.shadow-2` ٠
 *
 * وبعد الإضافة: staff ١١٤٢٩٦ · platform-admin ١٠٥٧٨٤ · marketing ٨٩٨٧٩ · bakery ٧٧٩٦٠،
 * والمفقود ٠/١٣ في الأربعة. أي أنّ زرَّ الدخول كان أبيضَ بلا لون، وخلفيةُ `Modal` في
 * لوحة التحكم شفافةً بلا ضبابية، وحلقاتُ التركيز غائبة — وكلُّ ذلك «تصميمٌ شبه معدوم»
 * لا ذوقُ أحد.
 *
 * والأمرُ الذي جعل العيبَ يخفى سنوات: التطبيقاتُ الكبيرة تنجو بالصدفة، لأنّ الصنفَ
 * مكتوبٌ أيضًا في أحد ملفاتها (`bg-brand` في ١٧ ملفًّا من `apps/staff` وصفرٍ من
 * `apps/bakery`). فالحارسُ هنا يثبّت الآليةَ نفسها، لا مظهرًا بعينه.
 *
 * ولإعادة القياس يدويًّا (لا داخل الاختبار، لأنّ التجميعَ ثوانٍ لا ميلي‑ثوانٍ):
 *   cd apps/<app> && node -e "…"  — أو ابنِ وقِس:
 *   grep -c '\.bg-brand' apps/bakery/.next/static/css/*.css
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const UI_SRC = join(ROOT, 'packages', 'ui', 'src');

/**
 * تطبيقاتٌ تُشغّل Tailwind فعلًا (لها `postcss.config.mjs` فيه `@tailwindcss/postcss`)
 * وتستورد `@erp/ui`.
 *
 * والمستثنيان مقاسان لا منسيّان:
 *   • `customer-portal` now consumes @erp/ui/page and compiles shared tokens too.
 *   • `marketing` enables PostCSS/Tailwind and declares @source for the shared
 *     theme switch and gallery. This test keeps that route protected from purge.
 */
const APPS = ['staff', 'platform-admin', 'bakery'];

/**
 * أصنافٌ حرجة: كلّها مكتوبةٌ داخل `packages/ui/src` وحدها، وكلّ واحدٍ منها يُرى بالعين
 * إن غاب — فغيابُها ليس تفصيلًا بل مكوّنٌ بلا لونٍ أو بلا خلفية.
 */
const CRITICAL = [
  'bg-brand', // الزرُّ الأساسي: بدونه يصير أبيضَ بحرفٍ داكن
  'text-brand-ink', // حرفُ الزرّ الأساسي
  'shadow-2', // ارتفاعُ البطاقات والصفّوف
  'bg-slate-950/45', // خلفيةُ Modal المعتمة
  'backdrop-blur-[2px]', // ضبابيةُ خلفيةِ Modal
  'z-[60]', // طبقةُ Toast فوق كلّ شيء
  'focus:ring-brand/20', // حلقةُ التركيز — وإلّا صار التنقّلُ بلوحة المفاتيح أعمى
  'hover:text-danger-ink', // زرُّ مسحِ المرشّحات
];

function sourcesOf(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourcesOf(full));
    else if (/\.(tsx|ts|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('توجيهُ مسح Tailwind إلى مصادر مكتبة الواجهة', () => {
  it.each(APPS)('‏apps/%s يوجّه المسح إلى packages/ui/src في globals.css', (app) => {
    const css = read(join(ROOT, 'apps', app, 'app', 'globals.css'));
    const directives = [...css.matchAll(/@source\s+'([^']+)'/g)].map((match) => match[1] ?? '');
    expect(directives.length, 'لا @source في globals.css — فالمسحُ التلقائيّ وحده، وهو يتجاهل node_modules').toBeGreaterThan(0);

    const resolved = directives.map((d) => resolve(join(ROOT, 'apps', app, 'app'), d));
    expect(resolved, `المسارُ لا يصل إلى مصادر المكتبة: ${directives.join(', ')}`).toContain(UI_SRC);
  });

  it.each(APPS)('‏apps/%s لا يكتب المسار عبر node_modules (فالتجاهلُ بالاسم لا بالرابط)', (app) => {
    const css = read(join(ROOT, 'apps', app, 'app', 'globals.css'));
    const directives = [...css.matchAll(/@source\s+'([^']+)'/g)].map((match) => match[1] ?? '');
    for (const directive of directives) {
      expect(directive, `‏${directive} يمرّ بـ node_modules فيتجاهله Tailwind`).not.toContain('node_modules');
      expect(existsSync(resolve(join(ROOT, 'apps', app, 'app'), directive)), `${directive} لا يوجد`).toBe(true);
    }
  });

  it('مكتبةُ الواجهة تحمل الأصنافَ الحرجة فعلًا — فالحارسُ لا يحرس فراغًا', () => {
    const blob = sourcesOf(UI_SRC).map(read).join('\n');
    for (const critical of CRITICAL) {
      expect(blob, `‏${critical} لم يعد مكتوبًا في packages/ui/src — فالحارسُ يقيس صنفًا ميتًا`).toContain(critical);
    }
  });

  it('لا خيارَ content في إعداد postcss: آليةٌ واحدة لا اثنتان تتصارعان', () => {
    // ‏كل تطبيق يشغّل Tailwind يحدد PostCSS ويمسح مصادر @erp/ui صراحةً.
    const found: string[] = [];
    for (const app of APPS) {
      for (const name of ['postcss.config.mjs', 'postcss.config.js', 'postcss.config.cjs']) {
        const path = join(ROOT, 'apps', app, name);
        if (!existsSync(path)) continue;
        found.push(`${app}/${name}`);
        expect(read(path), `‏${app}: خيار content يعارض @source ويُوهم أنّ المسحَ موجَّه`).not.toMatch(/content\s*:/);
      }
    }
    expect(found.length, 'لا إعدادَ لـ postcss في أيّ تطبيق — فالآليةُ صارت ضمن Next وحده ولم يعد هذا الحارسُ يقيس شيئًا').toBeGreaterThan(0);
    expect(found.length, `التطبيقاتُ ذات الإعداد: ${found.join(', ')}`).toBe(APPS.length);
  });

  it('إن شغّل التسويقُ Tailwind يومًا، فلا بدّ أن يوجّه المسحَ معهُ (حارسٌ أماميّ لا تثبيتٌ للعيب)', () => {
    const appDir = join(ROOT, 'apps', 'marketing');
    const hasConfig = ['postcss.config.mjs', 'postcss.config.js', 'postcss.config.cjs'].some((name) =>
      existsSync(join(appDir, name)),
    );
    expect(hasConfig, "الموقع يحتاج PostCSS لإظهار ThemeToggle والمكونات المشتركة").toBe(true);
    const css = read(join(appDir, 'app', 'globals.css'));
    expect(css, 'التشغيلُ بلا توجيهٍ يعيد العيبَ نفسه: مكوّنات @erp/ui بلا ألوان').toMatch(
      /@source\s+'\.\.\/\.\.\/\.\.\/packages\/ui\/src'/,
    );
  });
});
