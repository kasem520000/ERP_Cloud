import { describe, expect, it } from 'vitest';

import { BAKERY_APP_CODE, LICENCE_COPY, licenceVerdict } from '../lib/licence';

/**
 * قرار الترخيص — الحالةُ الوحيدة التي تفصل بين «تعمل الواجهة» و«ترفض»: فلا تُترك لتصرّف
 * مكوّن، ولا تُقاس بقراءة نصّ.
 */
describe('ترخيص باقة المخابز', () => {
  it('لا قرار قبل أن تُحلّ الجلسة — فلا رفضَ كاذب ولا فتحَ مبكّر', () => {
    expect(licenceVerdict({ authenticated: false })).toBe('loading');
    expect(licenceVerdict({ authenticated: false, enabledApps: [BAKERY_APP_CODE] })).toBe('loading');
  });

  it('الترخيص من `enabledApps` وحده: وجود الكود يعني الترخيص وغيابه يعني الرفض', () => {
    expect(licenceVerdict({ authenticated: true, enabledApps: [BAKERY_APP_CODE] })).toBe('licensed');
    expect(licenceVerdict({ authenticated: true, enabledApps: ['van_sales', 'wms', BAKERY_APP_CODE] })).toBe(
      'licensed',
    );
    expect(licenceVerdict({ authenticated: true, enabledApps: ['van_sales', 'wms'] })).toBe('unlicensed');
    expect(licenceVerdict({ authenticated: true, enabledApps: [] })).toBe('unlicensed');
  });

  /**
   * الشكّ مغلق: حقلٌ غائب (خادم أقدم من الواجهة) ليس ترخيصاً. والفشل المفتوح هنا يعني أنّ
   * منشأةً بلا باقة تعمل على شاشةٍ قطاعية لأنّ الخادم نسي حقلاً.
   */
  it('الاتجاه عند الشكّ مغلق: `enabledApps` غائب ⇒ «تعذّر التأكّد» لا «مرخَّص»', () => {
    expect(licenceVerdict({ authenticated: true })).toBe('unknown');
    expect(licenceVerdict({ authenticated: true, enabledApps: null })).toBe('unknown');
  });

  it('كود الباقة هو كود الكتالوج القطاعيّ حرفياً ويقبل قيدَ الهجرة على الأكواد', () => {
    expect(BAKERY_APP_CODE).toBe('bakery_distribution');
    // ‏CHECK (code ~ '^[a-z][a-z0-9_]{1,40}$') من `0109_marketplace_white_label.sql`.
    expect(BAKERY_APP_CODE).toMatch(/^[a-z][a-z0-9_]{1,40}$/);
  });

  it('نصّ الرفض يقول ما حدث وما يُعمل — ولا نسخةَ نصّ تدّعي ترخيصاً', () => {
    // ‏`licensed`/`loading` لا نصّ لهما: وجود نصّ «مرخَّص» هنا يعني أنّه سيُستعمل يوماً
    // في ادّعاء ترخيصٍ لم يُتحقّق منه.
    expect(Object.keys(LICENCE_COPY).sort()).toEqual(['unknown', 'unlicensed']);

    expect(LICENCE_COPY.unlicensed.title).toContain('غير مرخَّصة');
    expect(LICENCE_COPY.unlicensed.body).toContain('ترفض العمل');
    const steps = LICENCE_COPY.unlicensed.steps.join(' ');
    expect(steps).toContain('سوق الإضافات');
    expect(steps).toContain('مالك المنصة');

    expect(LICENCE_COPY.unknown.title).toContain('تعذّر');
    expect(LICENCE_COPY.unknown.body).toContain('enabledApps');
    expect(LICENCE_COPY.unknown.steps.length).toBeGreaterThan(0);
  });
});
