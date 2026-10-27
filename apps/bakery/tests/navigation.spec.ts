import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BAKERY_GROUPS,
  BAKERY_MODULES,
  groupedVisibleModules,
  isRepScoped,
  moduleForPath,
  readyModules,
  unknownPermissionCodes,
  visibleModules,
  type BakeryModule,
} from '../lib/navigation';

const appDir = fileURLToPath(new URL('../app', import.meta.url));

function pageExists(href: string): boolean {
  return existsSync(join(appDir, href === '/' ? 'page.tsx' : `${href.slice(1)}/page.tsx`));
}

/** كلّ `page.tsx` تحت `app/` — كي لا تُبنى شاشةٌ بلا إعلانٍ في الكتالوج. */
function declaredPages(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...declaredPages(absolute, `${prefix}/${entry.name}`));
      continue;
    }
    if (entry.name === 'page.tsx') found.push(prefix === '' ? '/' : prefix);
  }
  return found;
}

describe('خريطة وحدات واجهة المخابز', () => {
 it('«مبنيّة» صفحةٌ فعلًا: لا إعلان بلا بناء، ولا بناء بلا إعلان', () => {
    for (const module of BAKERY_MODULES) {
      const href = module.href;
      if (module.status === 'ready') {
        expect(href, `${module.key}: وحدةٌ مبنيّة بلا مسار`).toBeTruthy();
        expect(pageExists(href ?? '/'), `${module.key}: المسار ${href} بلا صفحة تحت app/`).toBe(true);
      } else {
        // ‏المخطَّطة لا تُعطى رابطاً: الرابط الميت كذبٌ على المستخدم.
        expect(href, `${module.key}: وحدةٌ مخطَّطة تحمل رابطاً`).toBeUndefined();
      }
    }

    const pages = declaredPages(appDir).sort();
    const ready = readyModules()
      .map((module) => module.href)
      .sort();
    expect(pages).toEqual(ready);
  });

  it('كلّ وحدة تقول ما ستفعله وبأيّ نقاط خادم — ولا مسارَ مُختلَع', () => {
    for (const module of BAKERY_MODULES) {
      expect(module.labelAr.trim().length, module.key).toBeGreaterThan(1);
      expect(module.planAr.trim().length, `${module.key}: بلا وصف`).toBeGreaterThan(20);
      expect(module.phaseAr, `${module.key}: بلا مرحلة`).toMatch(/^المرحلة \d/);
      expect(module.endpoints.length, `${module.key}: بلا نقاط`).toBeGreaterThan(0);
      for (const endpoint of module.endpoints) {
        expect(endpoint, `${module.key}: ${endpoint}`).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \//);
      }
    }
  });

  it('كلّ صلاحية معلنة رمزٌ حقيقيّ في سجلّ العقود — لا رمزَ مخترع يُخفي شاشةً للأبد', () => {
    expect(unknownPermissionCodes()).toEqual([]);
  });

  it('القائمة تُصفّى بالصلاحيات: ما سيرفضه الخادم لا يُعرض', () => {
    const all = visibleModules(() => true);
    expect(all.length).toBe(BAKERY_MODULES.length);

    const nothing = visibleModules(() => false);
    expect(nothing.length).toBeLessThan(all.length);
    expect(
      nothing.every((module) => module.permission === undefined && !module.anyPermissions?.length),
      'وحدةٌ بلا رمز صلاحية تُعرض للجميع — فإن خلت القائمة وكلٌّ بلا رمز فالتصفية لا تعمل',
    ).toBe(true);

    const productionOnly = visibleModules((permission) => permission === 'van_sales.production.manage');
    expect(productionOnly.some((module) => module.key === 'production')).toBe(true);
    expect(productionOnly.some((module) => module.key === 'custody')).toBe(false);

    // ‏شاشةٌ لدورين: يراها المندوب (يقدّم الإقفال) والمحاسب (يعتمده)، ولا يراها من لا يملك
    // أياً من الرمزين وإن ملك القراءة.
    const repOnly = visibleModules((permission) => permission === 'van_sales.closing.submit');
    expect(repOnly.some((module) => module.key === 'custody')).toBe(true);
    const accountantOnly = visibleModules((permission) => permission === 'van_sales.closing.approve');
    expect(accountantOnly.some((module) => module.key === 'custody')).toBe(true);
    const viewerOnly = visibleModules((permission) => permission === 'van_sales.view');
    expect(viewerOnly.some((module) => module.key === 'custody')).toBe(false);
  });

  it('مطابقة المسار بحدّ المقطع، ولا وحدةَ لمسارٍ لم يُبنَ', () => {
    expect(moduleForPath('/')?.key).toBe('overview');
    expect(moduleForPath('/production')?.key).toBe('production');
    expect(moduleForPath('/production/9')?.key).toBe('production'); // ‏حدّ المقطع لا البادئة
    expect(moduleForPath('/distribution')?.key).toBe('distribution');
    expect(moduleForPath('/production-x')).toBeUndefined();
    expect(moduleForPath('/distribution-x')).toBeUndefined();
    // ‏ما لم يُبنَ بعد: لا وحدةَ تطابقه (فلا قشرةَ تدّعي مساراً ولا مسارَ يدّعي قشرة).
    // ‏الشريحة ١٤ب: تطبيقُ المندوب — مسارٌ حقيقيّ، وحدُّ المقطع يمنع «rep-x».
    expect(moduleForPath('/rep')?.key).toBe('rep-app');
    expect(moduleForPath('/rep/9')?.key).toBe('rep-app');
    expect(moduleForPath('/rep-x')).toBeUndefined();
    expect(moduleForPath('/custody')?.key).toBe('custody');
    expect(moduleForPath('/custody/9')?.key).toBe('custody');
    expect(moduleForPath('/custody-x')).toBeUndefined();
    // ‏الشريحتان الجديدتان: مسارٌ حقيقيّ لكلٍّ منهما، وحدُّ المقطع يمنع «sales-x».
    expect(moduleForPath('/sales')?.key).toBe('sales');
    expect(moduleForPath('/sales/9')?.key).toBe('sales');
    expect(moduleForPath('/sales-x')).toBeUndefined();
    expect(moduleForPath('/collection')?.key).toBe('collection');
    expect(moduleForPath('/collection-x')).toBeUndefined();
    // ‏شريحة ١١: بطاقة المندوب الرسمية — مسارٌ حقيقيّ وحدُّ المقطع يمنع «reps-x».
    expect(moduleForPath('/reps')?.key).toBe('reps');
    expect(moduleForPath('/reps/9')?.key).toBe('reps');
    expect(moduleForPath('/reps-x')).toBeUndefined();
    // ‏شريحة ١٢ب: تقريرُ الفترة — مسارٌ حقيقيّ وحدُّ المقطع يمنع «reports-x».
    expect(moduleForPath('/reports')?.key).toBe('reports');
    expect(moduleForPath('/reports-x')).toBeUndefined();
    // ‏المسار الرسميّ لبطاقات المندوب في staff ليس مسارًا في هذه الواجهة.
    expect(moduleForPath('/sales/salesmen')?.key).toBe('sales');
  });

  /**
   * المرحلة المعلنة ليست زينة: «مبنيّة» تعني `status: 'ready'` (وله صفحة — مقاسٌ أعلاه)،
   * وما عداها مخطَّط. فلو كُتبت «مبنيّة» على وحدةٍ مخطَّطة لسقط هذا الحكم.
   */
  it('المراحل معلنة ومتّسقة مع الحالة — ولا وحدةَ تدّعي بناءً لم يحدث', () => {
    const allowed = [
      'المرحلة 2 — مبنيّة',
      'المرحلة 3 — مبنيّة',
      'المرحلة 3',
      'المرحلة 4 — مبنيّة',
      'المرحلة 4',
    ];
    for (const module of BAKERY_MODULES) {
      expect(allowed, `${module.key}: مرحلة غير معلنة`).toContain(module.phaseAr);
      if (module.phaseAr.includes('مبنيّة')) {
        expect(module.status, `${module.key}: «مبنيّة» وليست ready`).toBe('ready');
      } else {
        expect(module.status, `${module.key}: «${module.phaseAr}» وليست planned`).toBe('planned');
      }
    }

    expect(readyModules().map((module) => module.key).sort()).toEqual([
      'accounting',
      'adjustments',
      'ai-assistant',
      'ai-settings',
      'cash-boxes',
      'categories',
      'change-password',
      'collection',
      'counts',
      'custody',
      'distribution',
      'employee-account',
      'employees',
      'inventory',
      'inventory-vouchers',
      'items',
      'notifications',
      'org',
      'overview',
      'parties',
      'payroll',
      'policy',
      'pos',
      'prices',
      'printers',
      'production',
      'purchases',
      'rep-app',
      'reports',
      'reps',
      'roles',
      'sales',
      'sales-invoices',
      'sales-registry',
      'support',
      'system-reports',
      'tax-filings',
      'treasury',
      'treasury-vouchers',
      'units',
      'users',
    ]);

    expect(BAKERY_GROUPS.length).toBe(13);
    const grouped = groupedVisibleModules(() => true);
    expect(grouped.length).toBe(13);
    expect(grouped.reduce((sum, g) => sum + g.items.length, 0)).toBe(BAKERY_MODULES.length);
    /**
     * ‏واجهةُ المندوب بُنيت (الشريحة ١٤ب) فصار مسارُها `/rep` ومرحلتُها «مبنيّة» — وحكمُ
     * «مبنيّة ⇔ صفحةٌ فعلًا» أعلاه هو ما يثبت أنّ الإعلانَ ليس قشرة: فلو حُذفت
     * ‏`app/rep/page.tsx` لسقط هذا الحكمُ معه.
     */
    const repApp = BAKERY_MODULES.find((module) => module.key === 'rep-app');
    expect(repApp?.phaseAr).toBe('المرحلة 4 — مبنيّة');
    expect(repApp?.status).toBe('ready');
    expect(repApp?.href).toBe('/rep');
    expect(
      BAKERY_MODULES.filter((module) => module.phaseAr.startsWith('المرحلة 4')).map((m) => m.key),
    ).toEqual(['rep-app']);
  });
});

/**
 * 🚐 تحجيمُ الخطّ في القائمة — العلمُ `companyScope` ليس زينةً ولا ادّعاء.
 *
 * الخادمُ يرفض ٤٠٣ `VAN_SALES_COMPANY_SCOPE_REQUIRED` على `GET /van-sales/dashboard`
 * و`/reports` و`/salesmen` لمن له بطاقةُ مندوبٍ بلا إذنِ إدارةِ الخطّ (الشريحة ١٩، وقِيس
 * على خادمٍ قائم). وهذه المثبّتةُ تربط العلمَ بالواقع من طرفين: فكلُّ وحدةٍ تعلنه يجب أن
 * تكون صفحتُها تنادي أحدَ المسارات الثلاثة فعلًا، وكلُّ صفحةٍ مبنيّةٍ تنادي أحدها يجب أن
 * تُعلنه — وإلّا رأى المندوبُ رابطًا يُرفض، أو حُجب عنه رابطٌ يعمل.
 */
describe('تحجيمُ الخطّ في خريطة الوحدات', () => {
  const GATED = ['/van-sales/dashboard', '/van-sales/reports', '/van-sales/salesmen'];

  /** المصدرُ من `appDir` نفسه الذي تستعمله المثبّتةُ أعلاه — فـ`__dirname` لا وجود له في ESM. */
  const pageOf = (module: BakeryModule): string | null => {
    const href = module.href;
    if (!href) return null;
    const path = join(appDir, href === '/' ? 'page.tsx' : `${href.slice(1)}/page.tsx`);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  };

  it('كلُّ وحدةٍ تعلن `companyScope` تنادي صفحتُها مسارًا محجوبًا فعلًا', () => {
    const declared = BAKERY_MODULES.filter((module) => module.companyScope);
    expect(declared.length, 'لا وحدةَ تعلن العلم — فالتصفيةُ تصير ميتة').toBeGreaterThan(0);
    for (const module of declared) {
      const source = pageOf(module);
      expect(source, `صفحةُ ${module.key} غير موجودة`).not.toBeNull();
      const called = GATED.filter((path) => (source ?? '').includes(path));
      expect(called.length, `${module.key} يعلن companyScope ولا ينادي أيًّا من ${GATED.join('، ')}`).toBeGreaterThan(0);
    }
  });

  it(' وكلُّ شاشةٍ مبنيّةٍ تنادي مسارًا محجوبًا تُعلنه — فلا رابطَ يُرفض للمندوب', () => {
    for (const module of BAKERY_MODULES) {
      if (module.status !== 'ready' || module.key === 'overview') continue; // النظرة لها وضعُ مندوب
      const source = pageOf(module);
      if (!source) continue;
      const callsGated = GATED.some((path) => source.includes(path));
      if (callsGated) {
        expect(module.companyScope, `${module.key} ينادي مسارًا محجوبًا ولا يعلن companyScope`).toBe(true);
      }
    }
  });

  it('«محصور» = بطاقةُ مندوبٍ **بلا** إذنِ إدارة، ولا يُخمَّن من الأذونات وحدها', () => {
    const repOnly = ['van_sales.view', 'van_sales.invoice.create', 'van_sales.collection.create', 'van_sales.closing.submit'];
    // مندوبٌ ببطاقة: محصور.
    expect(isRepScoped(true, repOnly)).toBe(true);
    // كاتبُ مكتبٍ بالأذونات نفسها **بلا بطاقة**: الخادمُ يفتح له اللوحة، فحجبُه كذب.
    expect(isRepScoped(false, repOnly)).toBe(false);
    // مشرفٌ له بطاقةٌ وإذنُ اعتمادِ الإقفال: يقرأ الخطّ كلّه في الخادم.
    expect(isRepScoped(true, [...repOnly, 'van_sales.closing.approve'])).toBe(false);
    // مديرُ تحميلٍ ببطاقة.
    expect(isRepScoped(true, ['van_sales.view', 'van_sales.load.manage'])).toBe(false);
    // مالكٌ (`*`) ببطاقة.
    expect(isRepScoped(true, ['*'])).toBe(false);
    // بلا أذوناتٍ أصلًا: لا يُحجب شيءٌ هنا — فالخادمُ هو الرافض.
    expect(isRepScoped(false, [])).toBe(false);
  });

  it('القائمةُ تُصفّى للمندوب المحصور: يختفي المحجوبُ ويبقى ما يعمل', () => {
    const repOnly = ['van_sales.view', 'van_sales.invoice.create', 'van_sales.collection.create', 'van_sales.closing.submit'];
    const can = (code?: string) => Boolean(code && repOnly.includes(code));

    const asRep = visibleModules(can, BAKERY_MODULES, { repScoped: true });
    const asClerk = visibleModules(can, BAKERY_MODULES, { repScoped: false });

    expect(asRep.some((module) => module.companyScope)).toBe(false);
    expect(asRep.some((module) => module.key === 'rep-app'), 'تطبيقُ المندوب يجب أن يبقى له').toBe(true);
    expect(asRep.some((module) => module.key === 'overview'), 'النظرةُ بوضع المندوب تبقى').toBe(true);
    // وبلا حصرٍ (كاتبُ المكتب نفسه) تُعرض الشاشاتُ التي يفتحها الخادم له.
    expect(asClerk.filter((module) => module.companyScope).length).toBeGreaterThan(0);
    expect(asClerk.length).toBeGreaterThan(asRep.length);
  });
});

/**
 * نصُّ العميل لا نصُّ المهندس — تنفيذُ بند «بياناتٌ تظهر في الشاشات لا تصلح للإنتاج».
 *
 * الدليلُ كان لصقةُ صاحبِ العمل (‏2026-10-17): خريطةُ الوحدات عرضت `planAr` كاملًا لكلّ
 * وحدة، وفيه مساراتُ API وأسماءُ ملفاتٍ ومكتبات (‏`decimal.js`، `tests/staff-handoff.spec.ts`)
 * وأرقامُ شرائح («خطأُ الشريحة ١٣أ») ورموزُ أخطاء — فصارت الصفحةُ جدارَ نصٍّ هندسيٍّ يُعرض
 * على عميل. والفصلُ الآن: ‏`summaryAr` جملةٌ بلغة العمل (ظاهرة)، و`planAr` مع المسارات
 * دليلُ مهندسٍ داخل «التفاصيل التقنية» المطويّة — فلا ضاع الصدقُ ولا فُرض على العميل.
 */
describe('نصُّ العميل — لا مساراتٌ ولا أسماءُ ملفاتٍ في واجهة العميل', () => {
  const pageSource = readFileSync(join(appDir, 'page.tsx'), 'utf8');
  const guardSource = readFileSync(
    fileURLToPath(new URL('../components/bakery-guard.tsx', import.meta.url)),
    'utf8',
  );

  /** ما لا يجوز أن يقرأه عميل: مسارٌ أو ملفٌّ أو مكتبةٌ أو رقمُ شريحةٍ أو رمزُ خطأ. */
  const INTERNAL_TOKENS = [
    'apps/', 'packages/', '.ts', '.tsx', 'spec', 'tests/', '@erp/', 'decimal.js',
    'GET /', 'POST /', 'PUT /', 'PATCH /', 'DELETE /',
    'الشريحة', 'قِيس', 'بندُ', 'staff', 'web-van', 'AUD-', 'VAN_', 'ADDON_',
    'idempotencyKey', 'TreasuryService', 'enabledApps', 'LIMIT', 'meta.total',
    'periodTotals', 'page.tsx', 'service.ts', 'ZATCA',
  ] as const;

  it('لكلّ وحدةٍ `summaryAr` جملةٌ بلغة العمل — لا شعارٌ قصير ولا فقرة', () => {
    for (const module of BAKERY_MODULES) {
      const text = module.summaryAr.trim();
      expect(text.length, `${module.key}: بلا وصفٍ للعميل`).toBeGreaterThanOrEqual(40);
      expect(text.length, `${module.key}: ${text.length} حرفًا — أطول من سطرَين على الجوال`).toBeLessThanOrEqual(160);
      expect(text.endsWith('.'), `${module.key}: جملةٌ تنتهي بنقطة`).toBe(true);
    }
  });

  it('لا مصطلحَ هندسيًّا في `summaryAr` — والكلمةُ تُسقط الحكمَ باسم الوحدة', () => {
    for (const module of BAKERY_MODULES) {
      for (const token of INTERNAL_TOKENS) {
        expect(module.summaryAr.includes(token), `${module.key}: «${token}» مصطلحٌ داخليّ في نصّ العميل`).toBe(false);
      }
    }
  });

  it('لا سجلَّ هندسيًّا في الشاشة: الوصفُ فقط، والمساراتُ وأسماءُ الشرائح خارج الواجهة', () => {
    const summaryAt = pageSource.indexOf('{module.summaryAr}');
    expect(summaryAt, 'الصفحةُ لا تعرض وصفَ العميل').toBeGreaterThan(-1);
    // كان السجلُّ الهندسيُّ مطويًّا في «التفاصيل التقنية»؛ وقد أُزيل من الواجهة كلها:
    // فالمطويّةُ تبقى بياناتِ مهندسٍ في صفحةِ عميل، والعقدُ أن الشاشة لا تحمل مسارًا ولا رمزًا.
    expect(pageSource.includes('<details'), 'ما زالت هناك مطويّةُ تفاصيل في الشاشة').toBe(false);
    expect(pageSource.includes('{module.planAr}'), 'السجلُّ الهندسيُّ ما زال معروضًا').toBe(false);
    expect(pageSource.includes('module.endpoints.map'), 'مساراتُ API ما زالت معروضة').toBe(false);
    expect(pageSource.includes('module.permission'), 'رموزُ الصلاحيات ما زالت معروضة').toBe(false);
  });

  it('الشريطُ الجانبيّ يقول `summaryAr` ولا يهمس بالسجلّ الهندسيّ في التلميح', () => {
    expect(guardSource.includes('module.planAr'), 'التلميحُ كان يعرض فقرةً هندسية كاملة').toBe(false);
    expect(guardSource.includes('module.summaryAr'), 'التلميحُ لا يقول شيئًا للعميل').toBe(true);
  });

  it('وسيلةُ «مخطَّط» مشروطة — فلا تُعرض والكلُّ مبنيّ (تناقضٌ مع «١١ من ١١»)', () => {
    expect(guardSource.includes('hasPlanned ?'), 'الوسيلةُ غير مشروطة').toBe(true);
    if (BAKERY_MODULES.every((module) => module.status === 'ready')) {
      expect(guardSource.includes('bak-legend-note'), 'بلا مخطَّط يجب قولُ ذلك صراحة').toBe(true);
    }
  });

  it('ادّعاءُ «المتبقّي» في تطبيق المندوب لا يعود — فـPWA سلّمتها ١٤ج', () => {
    const repApp = BAKERY_MODULES.find((module) => module.key === 'rep-app');
    expect(repApp?.planAr.includes('والمتبقّي'), 'ادّعاءٌ قديمٌ بأنّ manifest/service worker لم تُبنَ').toBe(false);
    expect(repApp?.planAr.includes('manifest.webmanifest'), 'والصحيحُ أن يُقال ما بُني فعلًا').toBe(true);
  });

  it('لا مسارَ API ولا رمزَ خطأ في نصّ الصفحة الظاهر — إلا داخل مطويّةٍ أو تعليق', () => {
    const jargon = /(GET|POST|PUT|PATCH|DELETE) \/|ADDON_[A-Z_]+|enabledApps|apps\/api|van_sales\.[a-z]+/;
    let depth = 0;
    const leaks: string[] = [];
    for (const raw of pageSource.split('\n')) {
      const line = raw.trim();
      if (line.includes('<details className="bak-tech">')) depth += 1;
      if (line.includes('</details>')) depth = Math.max(0, depth - 1);
      const isComment = line.startsWith('*') || line.startsWith('//') || line.startsWith('/*') || line.startsWith('{/*');
      // ‏**نصٌّ معروض** لا سطرُ منطق: فـ`const canVan = can('van_sales.view')` كودٌ لا يقرأه
      // عميل، وأمّا جملةٌ عربية فيها مسارٌ أو رمزٌ فهي ما يُطبع على الشاشة. (والتمييزُ
      // بالعربية + استبعاد أوامر الكود — وقِيس: بلا هذا الاستبدال سقط الحكمُ على سطرِ منطق.)
      const isCode = /^(const|let|import|if|return|export|function|await|type|}\s*else)/.test(line);
      const hasArabic = /[\u0600-\u06FF]/.test(line);
      if (isComment || isCode || depth > 0 || !hasArabic || !jargon.test(line)) continue;
      leaks.push(line.slice(0, 100));
    }
    expect(leaks, `مصطلحاتٌ هندسية في نصّ العميل: ${leaks.join(' | ')}`).toEqual([]);
  });
});
