import { describe, expect, it } from 'vitest';

import { dayOffsetIso, isoDayInTimezone, todayIso } from '../src/common/server-date.js';

/**
 * 🗓️ مسطرة «اليوم» — الحارس الذي يمنع عودة `toISOString().slice(0, 10)`.
 *
 * الخادم على `Asia/Riyadh` (+03): بين 00:00 و03:00 بتوقيت مكة يكون تاريخ UTC هو **أمس**.
 * فكان كل مستندٍ يُنشأ في تلك الساعات يُؤرَّخ بيومٍ سابق. الفحوص أدناه تثبّت الحدّ الفاصل
 * بالضبط (21:00Z = منتصف ليل مكة)، وكذلك سلوك المنطقة المجهولة والمناطق الأخرى.
 */
describe('server-date — اليوم بتوقيت المنشأة لا UTC', () => {
  it('يبدّل اليوم عند منتصف ليل مكة (21:00Z) لا عند منتصف ليل UTC', () => {
    expect(todayIso(new Date('2026-10-27T20:59:59.000Z'))).toBe('2026-10-27');
    expect(todayIso(new Date('2026-10-27T21:00:00.000Z'))).toBe('2026-10-28');
    // والفجر بالتوقيت المحلي (00:30 +03) ما زال يوم 27 — وهو موضعُ العطب القديم:
    // `toISOString()` كان يعطي '2026-10-26' هنا.
    expect(todayIso(new Date('2026-10-26T21:30:00.000Z'))).toBe('2026-10-27');
  });

  it('يُنسّق بـYYYY-MM-DD بأصفارٍ بادئة', () => {
    expect(todayIso(new Date('2026-01-05T09:00:00.000Z'))).toBe('2026-01-05');
    expect(todayIso(new Date('2026-12-31T20:59:59.000Z'))).toBe('2026-12-31');
    expect(todayIso(new Date('2026-12-31T21:00:00.000Z'))).toBe('2027-01-01');
  });

  it('يحترم منطقةً صريحة، ويعود إلى مكة إن كانت مجهولة', () => {
    const at = new Date('2026-10-27T22:30:00.000Z');
    expect(isoDayInTimezone(at, 'UTC')).toBe('2026-10-27');
    expect(isoDayInTimezone(at, 'Asia/Riyadh')).toBe('2026-10-28');
    expect(isoDayInTimezone(at, 'Europe/London')).toBe('2026-10-27');
    // منطقةٌ غير معروفة لا تُسقِط المستند: مكة هي المرجع.
    expect(isoDayInTimezone(at, 'Asia/Riyadhh')).toBe('2026-10-28');
  });

  it('يزيح الأيام من اليوم المحلي لا من تاريخ UTC', () => {
    const now = new Date('2026-10-27T22:30:00.000Z'); // 01:30 الأربعاء في مكة
    expect(dayOffsetIso(0, now)).toBe('2026-10-28');
    expect(dayOffsetIso(-1, now)).toBe('2026-10-27');
    expect(dayOffsetIso(7, now)).toBe('2026-11-04');
  });
});
