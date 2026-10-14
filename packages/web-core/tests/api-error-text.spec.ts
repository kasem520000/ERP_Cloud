import { describe, expect, it } from 'vitest';

import { ApiError, apiErrorText } from '../src/api.js';

/**
 * 📣 نصّ الرفض كما يُقال للمستخدم.
 *
 * الخادم يرسل `application/problem+json` بعنوانٍ (`title`) وتفصيلٍ (`detail`)، والشاشة كانت
 * تعرض العنوان وحده — والعنوان عامّ («Request failed») لكل رمزٍ غير مسجَّل في `errorTitle`،
 * أي أن سبب الرفض الحقيقي كان يختفي من أمام المشرف. وهذا السبيك يثبّت الحكم: التفصيل هو
 * ما يُعرض متى وُجد، والعنوان بديلٌ عنه، وتفصيل أخطاء الخادم (5xx) لا يُسرَّب.
 */
describe('api error text (📣 نصّ الرفض)', () => {
  it('shows the real reason, not the generic title', () => {
    const error = new ApiError(
      422,
      'VAN_PRODUCTION_INPUT_REQUIRED',
      'Production batch needs a material source',
      'دفعة الإنتاج تحتاج مصدراً للمواد: اربطها بقائمة مواد (BOM) أو أدخل المكوّنات المصروفة',
    );
    expect(apiErrorText(error)).toContain('دفعة الإنتاج تحتاج مصدراً للمواد');
  });

  it('falls back to the title when the server sent no detail, and to the fallback outside ApiError', () => {
    expect(apiErrorText(new ApiError(404, 'NOT_FOUND', 'Not found'))).toBe('Not found');
    expect(apiErrorText(new Error('boom'), 'تعذر الحفظ')).toBe('تعذر الحفظ');
    expect(apiErrorText('plain string', 'تعذر الحفظ')).toBe('تعذر الحفظ');
  });

  it('does not leak the detail of a server error', () => {
    const error = new ApiError(
      500,
      'INTERNAL',
      'Internal error',
      'connect ECONNREFUSED 10.0.3.14:5432 — pool.query at inventory.service.ts:245',
    );
    expect(apiErrorText(error)).toBe('Internal error');
    expect(apiErrorText(error)).not.toContain('ECONNREFUSED');
  });

  it('ignores a blank detail instead of showing an empty notice', () => {
    expect(apiErrorText(new ApiError(409, 'VERSION_CONFLICT', 'Version conflict', '   '))).toBe(
      'Version conflict',
    );
  });
});
