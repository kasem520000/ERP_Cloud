import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BAKERY_MODULES,
  moduleForPath,
  readyModules,
  unknownPermissionCodes,
  visibleModules,
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
  it('«مبنيّة» ⇔ صفحةٌ فعلًا: لا إعلان بلا بناء، ولا بناء بلا إعلان', () => {
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
    expect(moduleForPath('/rep')).toBeUndefined();
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
    // ‏المسار الرسميّ لبطاقات المندوب في staff ليس مسارًا في هذه الواجهة.
    expect(moduleForPath('/sales/salesmen')?.key).toBe('sales');
  });

  /**
   * المرحلة المعلنة ليست زينة: «مبنيّة» تعني `status: 'ready'` (وله صفحة — مقاسٌ أعلاه)،
   * وما عداها مخطَّط. فلو كُتبت «مبنيّة» على وحدةٍ مخطَّطة لسقط هذا الحكم.
   */
  it('المراحل معلنة ومتّسقة مع الحالة — ولا وحدةَ تدّعي بناءً لم يحدث', () => {
    const allowed = ['المرحلة 2 — مبنيّة', 'المرحلة 3 — مبنيّة', 'المرحلة 3', 'المرحلة 4'];
    for (const module of BAKERY_MODULES) {
      expect(allowed, `${module.key}: مرحلة غير معلنة`).toContain(module.phaseAr);
      if (module.phaseAr.includes('مبنيّة')) {
        expect(module.status, `${module.key}: «مبنيّة» وليست ready`).toBe('ready');
      } else {
        expect(module.status, `${module.key}: «${module.phaseAr}» وليست planned`).toBe('planned');
      }
    }

    expect(readyModules().map((module) => module.key).sort()).toEqual([
      'collection',
      'custody',
      'distribution',
      'overview',
      'production',
      'reps',
      'sales',
    ]);
    // ‏واجهة المندوب ما زالت المرحلة 4 ولا مسار لها بعد.
    expect(BAKERY_MODULES.find((module) => module.key === 'rep-app')?.phaseAr).toBe('المرحلة 4');
    expect(BAKERY_MODULES.filter((module) => module.phaseAr === 'المرحلة 4').map((m) => m.key)).toEqual(['rep-app']);
  });
});
