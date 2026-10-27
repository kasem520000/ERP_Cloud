import { describe, expect, it } from 'vitest';

import { addDaysInMakkah, dayInMakkah, MAKKAH_TIME_ZONE, todayInMakkah } from '../src/date';

/**
 * 🗓️ مسطرة اليوم في المتصفّح — الحارس الذي يمنع عودة `new Date().toISOString().slice(0, 10)`.
 *
 * المستخدم في مكة عند الساعة 01:00 يرى في UTC **أمس**؛ فصندوق تاريخٍ افتراضيّ كان يعرض
 * يوماً سابقاً، والسند يُحفظ بتاريخٍ غير مقصود. والحدّ الفاصل: 21:00Z = منتصف ليل مكة.
 */
describe('web-core/date — اليوم بتوقيت مكة', () => {
  it('يبدّل اليوم عند منتصف ليل مكة لا عند منتصف ليل UTC', () => {
    expect(MAKKAH_TIME_ZONE).toBe('Asia/Riyadh');
    expect(dayInMakkah(new Date('2026-10-27T20:59:59.000Z'))).toBe('2026-10-27');
    expect(dayInMakkah(new Date('2026-10-27T21:00:00.000Z'))).toBe('2026-10-28');
    // 01:30 في مكة: `toISOString()` كان يعطي 2026-10-26.
    expect(dayInMakkah(new Date('2026-10-26T22:30:00.000Z'))).toBe('2026-10-27');
  });

  it('يُبقي التواريخ التقويمية كما هي بلا إزاحة', () => {
    expect(dayInMakkah('2026-03-01')).toBe('2026-03-01');
    expect(dayInMakkah('2026-12-31')).toBe('2026-12-31');
  });

  it('يقبل نصاً زمنياً أو طابعاً رقمياً، ويُعيد فراغاً لغير الصالح', () => {
    expect(dayInMakkah('2026-10-27T22:30:00.000Z')).toBe('2026-10-28');
    expect(dayInMakkah(Date.parse('2026-10-27T09:00:00.000Z'))).toBe('2026-10-27');
    expect(dayInMakkah('ليس تاريخاً')).toBe('');
  });

  it('يمشي بالأيام من اليوم المحلي لا من تاريخ UTC', () => {
    const now = new Date('2026-10-27T22:30:00.000Z'); // 01:30 الأربعاء في مكة
    expect(dayInMakkah(now)).toBe('2026-10-28');
    expect(addDaysInMakkah(-1, now)).toBe('2026-10-27');
    expect(addDaysInMakkah(7, now)).toBe('2026-11-04');
    expect(todayInMakkah()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
