import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BAKERY_GROUPS, BAKERY_MODULES, groupedVisibleModules } from '../lib/navigation';
import { formatMakkahDateTime, makkahTodayIso } from '../lib/server-print';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

describe('تطابق واجهة المخابز الشاملة مع تطبيق أندرويد المخبز وتقسيم شاشات المندوب', () => {
  it('تنظّم الشريط الجانبي في 13 مجموعة تشغيلية تغطي 41 شاشة جاهزة بلا فجوات', () => {
    expect(BAKERY_GROUPS).toHaveLength(13);
    expect(BAKERY_MODULES).toHaveLength(41);

    const groupKeys = new Set(BAKERY_GROUPS.map((g) => g.key));
    for (const mod of BAKERY_MODULES) {
      expect(groupKeys.has(mod.groupKey), `${mod.key}: مجموعة غير معرّفة ${mod.groupKey}`).toBe(true);
      expect(mod.status).toBe('ready');
    }

    const grouped = groupedVisibleModules(() => true);
    expect(grouped).toHaveLength(13);
  });

  it('تمنح كلّ شاشةٍ من الشاشات الـ41 أيقونة SVG صريحة في module-icon.tsx بلا ارتداد صامت', () => {
    const iconSource = readFileSync(join(rootDir, 'components/module-icon.tsx'), 'utf8');
    for (const mod of BAKERY_MODULES) {
      const hasBare = iconSource.includes(`  ${mod.key}: (`);
      const hasQuoted = iconSource.includes(`  '${mod.key}': (`);
      expect(hasBare || hasQuoted, `الأيقونة المخصّصة مفقودة للوحدة ${mod.key}`).toBe(true);
    }
  });

  it('تقسّم مساحة عمل المندوب (/rep) إلى 9 شاشات متخصّصة بقائمة جانبية وروابط متطابقة في القشرة', () => {
    const repSource = readFileSync(join(rootDir, 'app/rep/page.tsx'), 'utf8');
    const guardSource = readFileSync(join(rootDir, 'components/bakery-guard.tsx'), 'utf8');
    for (const section of [
      'overview',
      'receipts',
      'sale',
      'returns',
      'collection',
      'documents',
      'custody',
      'closing',
      'queue',
    ]) {
      expect(repSource).toContain(`'${section}'`);
      expect(guardSource).toContain(`/rep?section=${section}`);
    }
    expect(repSource).toContain('rep-drawer-sheet');
    expect(repSource).toContain('rep-nav-list');
    expect(repSource).toContain("searchParams?.get('section')");
  });

  it('تعتمد توقيت مكة المكرمة (Asia/Riyadh) في مساعدات التاريخ والطباعة', () => {
    const today = makkahTodayIso(new Date('2026-10-27T21:30:00Z'));
    // 21:30 UTC == 00:30+1 in Asia/Riyadh -> 2026-10-28!
    expect(today).toBe('2026-10-28');
    expect(formatMakkahDateTime(null)).toBe('—');
    expect(formatMakkahDateTime('2026-10-27T10:00:00Z')).toBeTruthy();
  });
});
