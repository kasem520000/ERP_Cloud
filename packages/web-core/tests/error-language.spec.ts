import { describe, expect, it } from 'vitest';

import { arabicErrorText, arabicProblem } from '../src/error-language';

describe('Arabic API problem presentation', () => {
  it('localizes offline and proxy errors without changing Arabic business errors', () => {
    expect(arabicErrorText(new TypeError('Failed to fetch'))).toMatch(/تعذّر الاتصال/);
    expect(arabicErrorText(new Error('لا يوجد رصيد كافٍ'))).toBe('لا يوجد رصيد كافٍ');
    expect(arabicErrorText('<html>Bad Gateway</html>')).not.toContain('html');
  });
  it('keeps the Arabic business reason for client errors', () => {
    expect(arabicProblem(422, 'Request failed', 'لا يمكن ترحيل القيد قبل فتح الفترة').message).toBe(
      'لا يمكن ترحيل القيد قبل فتح الفترة',
    );
  });
  it('replaces untranslated responses and proxy HTML with actionable Arabic', () => {
    expect(arabicProblem(404, 'Not found', '<html>bad gateway</html>').message).toBe(
      'المورد المطلوب غير موجود.',
    );
    expect(arabicProblem(409, 'Version conflict').message).toMatch(/تعارضت/);
  });
  it('does not leak 5xx details even if they are written in Arabic', () => {
    const result = arabicProblem(500, 'Internal error', 'خطأ في قاعدة البيانات عند 10.1.2.3');
    expect(result.message).toBe('حدث خطأ في الخدمة. حاول لاحقاً.');
    expect(result.detail).toBeUndefined();
  });
});
