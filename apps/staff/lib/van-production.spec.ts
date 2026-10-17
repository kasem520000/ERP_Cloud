import { describe, expect, it } from 'vitest';
import * as source from '@erp/web-van/production';

import * as bridge from './van-production';

/**
 * الجسر يعيد تصدير العقد المشترك — والأحكام التفصيلية (10 حالات) انتقلت مع المصدر إلى
 * `packages/web-van/tests/production.spec.ts`. وهنا حكمان على **الربط نفسه**: أنّ السطح
 * كامل (لا اسم سقط في re-export فتكسر الشاشة عند التشغيل لا عند الترجمة)، وأنّ سلوكاً
 * حقيقياً يمرّ عبر الجسر كما يمرّ عبر المصدر.
 */
describe('lib/van-production — الجسر إلى @erp/web-van', () => {
  it('يعيد تصدير سطح الحزمة كاملاً', () => {
    const bridgeKeys = Object.keys(bridge).sort();
    const sourceKeys = Object.keys(source).sort();
    expect(bridgeKeys).toEqual(sourceKeys);
    expect(bridgeKeys).toContain('buildProductionBatchPayload');
    expect(bridgeKeys).toContain('estimateComponentCost');
    expect(bridgeKeys).toContain('PRODUCTION_MESSAGES');
  });

  it('الحمولة تمرّ عبر الجسر بالمفتاح الذي يقرأه الخادم (`qty` لا `quantity`)', () => {
    const verdict = bridge.buildProductionBatchPayload({
      itemId: 'item-1',
      warehouseId: 'wh-1',
      producedQty: '100',
      components: [{ itemId: 'flour', qty: '60' }],
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.payload.components).toEqual([{ itemId: 'flour', qty: '60.0000' }]);
    expect('quantity' in (verdict.payload.components[0] as object)).toBe(false);
    expect('unitCost' in verdict.payload).toBe(false);
  });
});
