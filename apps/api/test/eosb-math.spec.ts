import { describe, expect, it } from 'vitest';

import { cumulativeEntitlement, DEFAULT_EOSB_RATES, entitlementMonths, periodDelta, serviceYearsAt } from '../src/modules/hrm/eosb-math.js';

/**
 * MF-42 / r44 T8 — رياضيات المخصص في صميم نقَّاء: الشرائح (0.5/1)، السنوات المتصلة،
 * Δ الصافي (بما فيه السالب). الحسابات هنا حرفية مستقلة لا تمرّ بالدوال نفسها.
 */
describe('eosb-math — شرائح مخصص نهاية الخدمة', () => {
  it('الافتراض: 0.5 شهر/سنة في الخمس الأولى ثم شهر كامل', () => {
    expect(DEFAULT_EOSB_RATES).toEqual({ monthsPerYearFirst: '0.5', monthsPerYearAfter: '1' });
    expect(entitlementMonths('0')).toBe('0.0000');
    expect(entitlementMonths('1')).toBe('0.5000');
    expect(entitlementMonths('4')).toBe('2.0000');
    expect(entitlementMonths('5')).toBe('2.5000');
    expect(entitlementMonths('6')).toBe('3.5000'); // 5×0.5 + 1×1
    expect(entitlementMonths('5.5')).toBe('3.0000'); // 2.5 + 0.5
    expect(entitlementMonths('10')).toBe('7.5000'); // 2.5 + 5
  });

  it('سنوات متصلة (365.25) وبلا تعيين ⇐ صفر', () => {
    expect(serviceYearsAt(null, '2026-12-31')).toBe('0.0000');
    expect(serviceYearsAt('2026-06-15', '2026-01-01')).toBe('0.0000'); // تعيين لاحق للفترة
    expect(serviceYearsAt('2020-01-01', '2021-01-01')).toBe('1.0021'); // 366 يوماً (2020 كبيسة)/365.25
    expect(serviceYearsAt('2020-01-15', '2026-10-31')).toBe('6.7926');
  });

  it('التراكمي والفرق (موجب وسالب)', () => {
    expect(cumulativeEntitlement('1500', '3.5')).toBe('5250.0000');
    expect(cumulativeEntitlement('1000', '4.5')).toBe('4500.0000');
    expect(periodDelta('5250', '0')).toBe('5250.0000');
    expect(periodDelta('4500', '5250')).toBe('-750.0000');
    expect(periodDelta('100.0001', '100.0000')).toBe('0.0001');
  });

  it('معدلات مخصّصة تُحسب بالصيغة نفسها', () => {
    const rates = { monthsPerYearFirst: '1', monthsPerYearAfter: '2' };
    expect(entitlementMonths('3', rates)).toBe('3.0000');
    expect(entitlementMonths('6', rates)).toBe('7.0000'); // 5×1 + 1×2
  });
});
