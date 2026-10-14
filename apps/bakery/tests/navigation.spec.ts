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
    expect(nothing.every((module) => module.permission === undefined)).toBe(true);

    const productionOnly = visibleModules((permission) => permission === 'van_sales.production.manage');
    expect(productionOnly.some((module) => module.key === 'production')).toBe(true);
    expect(productionOnly.some((module) => module.key === 'custody')).toBe(false);
  });

  it('مطابقة المسار بحدّ المقطع، ولا وحدةَ لمسارٍ لم يُبنَ', () => {
    expect(moduleForPath('/')?.key).toBe('overview');
    expect(moduleForPath('/production')).toBeUndefined();
    expect(moduleForPath('/rep')).toBeUndefined();
    expect(moduleForPath('/overview-x')).toBeUndefined();
  });

  it('المراحل معلنة: أعمالٌ في 3 وواجهة المندوب في 4 — ولا وحدةَ تدّعي غير مرحلتها', () => {
    const phases = new Map<string, string[]>();
    for (const module of BAKERY_MODULES) {
      const list = phases.get(module.phaseAr) ?? [];
      list.push(module.key);
      phases.set(module.phaseAr, list);
    }
    expect([...phases.keys()].sort()).toEqual(['المرحلة 2 — مبنيّة', 'المرحلة 3', 'المرحلة 4']);
    expect(phases.get('المرحلة 2 — مبنيّة')).toEqual(['overview']);
    expect(phases.get('المرحلة 4')).toEqual(['rep-app']);
  });
});
