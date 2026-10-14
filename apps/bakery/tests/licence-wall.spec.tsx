import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LicenceWall } from '../components/licence-wall';

/**
 * الجدار مرسومٌ فعلاً (`renderToStaticMarkup`) لا مقروءٌ نصّاً: فالرفض الذي لا يُرسم هو
 * بعينه ما كان يُخفي الثغرة في النسخ السابقة من هذه الواجهات.
 */
describe('جدار الترخيص', () => {
  it('غير مرخَّصة: رفضٌ صريح، طريقُ الطلب، وقرارُ المنصة — لا تحويل ولا شاشة فارغة', () => {
    const html = renderToStaticMarkup(<LicenceWall verdict="unlicensed" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('غير مرخَّصة');
    expect(html).toContain('ترفض العمل');
    expect(html).toContain('سوق الإضافات');
    expect(html).toContain('مالك المنصة');
    expect(html).toContain('GET /me');
  });

  it('تعذّر التأكّد: يقول سببه ويعرض إعادة المحاولة', () => {
    const html = renderToStaticMarkup(<LicenceWall onRetry={() => undefined} verdict="unknown" />);
    expect(html).toContain('تعذّر التأكّد');
    expect(html).toContain('enabledApps');
    expect(html).toContain('إعادة المحاولة');
    expect(html).toContain('<button');
  });

  it('بلا إعادة محاولة: لا زرّ — فلا يُعرض فعلٌ لا يفعله أحد', () => {
    expect(renderToStaticMarkup(<LicenceWall verdict="unlicensed" />)).not.toContain('<button');
  });

  it('لا يدّعي ترخيصاً في حال الرفض', () => {
    const html = renderToStaticMarkup(<LicenceWall verdict="unlicensed" />);
    expect(html).not.toContain('الباقة مرخَّصة');
    expect(html).not.toContain('مرخَّصة:');
  });
});
