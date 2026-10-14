import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PRODUCTION_MESSAGES,
  buildProductionBatchPayload,
  estimateComponentCost,
  type ProductionBatchDraft,
} from '../src/production';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * 🏭 عقد شبكة دفعة الإنتاج كما ترسلها شاشة «البيع المتجول» إلى
 * `POST /van-sales/production-batches`.
 *
 * السبب الذي يجعل هذا السبيك واجباً لا ترفاً: الخادم يقرأ المكوّنات من
 * `components: Array<{ itemId, qty }>` (`van-sales.controller.ts:94` ←
 * `ProductionOrdersService.create:106`)، فلو أرسلت الشاشة `quantity` لمرّ الطلب وفيه
 * مكوّناتٌ بلا كميات — والنتيجة دفعةٌ مرفوضة برسالة «لا مصدر للمواد» أمام مشرفٍ ملأ
 * المكوّنات فعلاً. وهنا تُثبَّت الأحكام التي قررتها سياسة الإنتاج المعتمدة:
 *
 *   · لا تُرسل تكلفةٌ مكتوبة إطلاقاً (التكلفة قيمة ما صُرف من الرفّ)؛
 *   · دفعةٌ بلا مكوّنات تُرفض قبل الإرسال، مع البديل النظامي في الرسالة؛
 *   · السطر الناقص يُرفض ولا يُحذف صامتاً؛
 *   · رقم الدفعة اختياري: فارغٌ يعني رقماً تسلسلياً رسمياً من الخادم.
 */
describe('production batch payload (🏭 دفعة الإنتاج)', () => {
  const draft = (over: Partial<ProductionBatchDraft> = {}): ProductionBatchDraft => ({
    itemId: 'bread',
    warehouseId: 'wh-main',
    productionDate: '2026-10-14',
    itemName: 'خبز تميس',
    producedQty: '500',
    scrapQty: '0',
    scrapReason: '',
    batchNo: '',
    supervisorName: 'مشرف خط الإنتاج',
    components: [{ itemId: 'flour', qty: '500' }],
    ...over,
  });

  it('sends the components under `qty` — the field the engine reads — and never a typed cost', () => {
    const verdict = buildProductionBatchPayload(draft());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.payload.components).toEqual([{ itemId: 'flour', qty: '500.0000' }]);
    /** القرار المعتمد: تكلفة الدفعة مما يُصرف من الرفّ، فلا رقم يدوي في الحمولة. */
    expect(verdict.payload).not.toHaveProperty('unitCost');
    expect(verdict.payload).not.toHaveProperty('quantity');
    const firstLine = verdict.payload.components[0];
    expect(firstLine && Object.keys(firstLine).sort()).toEqual(['itemId', 'qty']);
  });

  it('refuses a batch with no material source, and names the official alternative', () => {
    for (const components of [[], [{ itemId: '', qty: '' }]]) {
      const verdict = buildProductionBatchPayload(draft({ components }));
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.message).toBe(PRODUCTION_MESSAGES.componentsRequired);
      expect(verdict.message).toContain('إذن إدخال مخزني رسمي');
      expect(verdict.message).toContain('تسوية جرد معتمدة');
    }
  });

  it('ignores an untouched new line but refuses a half-filled one instead of dropping it silently', () => {
    const withBlankRow = buildProductionBatchPayload(
      draft({ components: [{ itemId: '', qty: '' }, { itemId: 'flour', qty: '10' }] }),
    );
    expect(withBlankRow.ok).toBe(true);
    if (withBlankRow.ok) expect(withBlankRow.payload.components).toHaveLength(1);

    const missingQty = buildProductionBatchPayload(draft({ components: [{ itemId: 'flour', qty: '' }] }));
    expect(missingQty.ok).toBe(false);
    if (!missingQty.ok) expect(missingQty.message).toBe(PRODUCTION_MESSAGES.componentQtyRequired);

    const missingItem = buildProductionBatchPayload(draft({ components: [{ itemId: '', qty: '10' }] }));
    expect(missingItem.ok).toBe(false);
    if (!missingItem.ok) expect(missingItem.message).toBe(PRODUCTION_MESSAGES.componentItemRequired);

    const zeroQty = buildProductionBatchPayload(draft({ components: [{ itemId: 'flour', qty: '0' }] }));
    expect(zeroQty.ok).toBe(false);
  });

  it('refuses a duplicated component and the produced item used as its own input', () => {
    const duplicated = buildProductionBatchPayload(
      draft({ components: [{ itemId: 'flour', qty: '10' }, { itemId: 'flour', qty: '5' }] }),
    );
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) expect(duplicated.message).toBe(PRODUCTION_MESSAGES.duplicateComponent);

    const selfInput = buildProductionBatchPayload(
      draft({ components: [{ itemId: 'bread', qty: '10' }] }),
    );
    expect(selfInput.ok).toBe(false);
    if (!selfInput.ok) expect(selfInput.message).toBe(PRODUCTION_MESSAGES.componentIsOutput);
  });

  it('never ships scrap without a reason, and never a negative scrap quantity', () => {
    const silentScrap = buildProductionBatchPayload(draft({ scrapQty: '12', scrapReason: '  ' }));
    expect(silentScrap.ok).toBe(false);
    if (!silentScrap.ok) expect(silentScrap.message).toBe(PRODUCTION_MESSAGES.scrapReasonRequired);

    const reasoned = buildProductionBatchPayload(
      draft({ scrapQty: '12', scrapReason: 'عجين لم يختمر' }),
    );
    expect(reasoned.ok).toBe(true);
    if (reasoned.ok) {
      expect(reasoned.payload.scrapQty).toBe('12.0000');
      expect(reasoned.payload.scrapReason).toBe('عجين لم يختمر');
    }

    const negative = buildProductionBatchPayload(draft({ scrapQty: '-3' }));
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.message).toBe(PRODUCTION_MESSAGES.scrapNegative);
  });

  it('keeps the batch number optional: blank omits the field, written is sent verbatim', () => {
    const auto = buildProductionBatchPayload(draft({ batchNo: '   ' }));
    expect(auto.ok).toBe(true);
    if (auto.ok) expect(auto.payload.batchNo).toBeUndefined();

    const written = buildProductionBatchPayload(draft({ batchNo: ' BR-2026-0001 ' }));
    expect(written.ok).toBe(true);
    if (written.ok) expect(written.payload.batchNo).toBe('BR-2026-0001');
  });

  it('refuses a batch with no produced item or no positive quantity', () => {
    const noItem = buildProductionBatchPayload(draft({ itemId: '' }));
    expect(noItem.ok).toBe(false);
    if (!noItem.ok) expect(noItem.message).toBe(PRODUCTION_MESSAGES.itemRequired);

    const zeroProduced = buildProductionBatchPayload(draft({ producedQty: '0' }));
    expect(zeroProduced.ok).toBe(false);
    if (!zeroProduced.ok) expect(zeroProduced.message).toBe(PRODUCTION_MESSAGES.qtyRequired);
  });

  it('estimates the cost from the official moving average and warns about an unvalued material', () => {
    const stockRows = [
      { itemId: 'flour', warehouseId: 'wh-main', quantity: '1000', averageCost: '4.0000' },
      { itemId: 'sugar', warehouseId: 'wh-main', quantity: '0', averageCost: '0.0000' },
      { itemId: 'flour', warehouseId: 'wh-van', quantity: '9', averageCost: '99.0000' },
    ];
    const estimate = estimateComponentCost({
      lines: [
        { itemId: 'flour', qty: '500' },
        { itemId: 'sugar', qty: '10' },
      ],
      producedQty: '500',
      stockRows,
      warehouseId: 'wh-main',
    });
    /** الدقيق وحده المُقيَّم في المستودع الرئيسي — ورصيد الفان لا يتسرّب إلى التقدير. */
    expect(estimate.totalValue).toBe('2000.00');
    expect(estimate.perKg).toBe('4.0000');
    expect(estimate.unvalued).toBe(1);
  });

  /**
   * الدوالّ النقية تُختبر وحدها، لكن **التوصيل** — أن ترسل الصفحة ما تبنيه الدالة لا كائناً
   * مكتوباً باليد — لا يصل إليه اختبارٌ نقىّ. وأول نسخة من هذا الإصلاح أرسلت `quantity` بدل
   * `qty`: حمولةٌ تبدو صحيحة وتُرفض في الخادم برسالة «لا مصدر للمواد» أمام مشرفٍ ملأ
   * المكوّنات فعلاً. لذلك يُثبَّت التوصيل نفسه هنا (اصطلاح `tests/project-definitions.spec.ts`).
   */
  it('posts what the contract builds — no hand-rolled payload, no typed cost, real refusal text', () => {
    const page = readFileSync(join(repoRoot, 'apps/staff/app/van-sales/page.tsx'), 'utf8');
    expect(page).toContain('buildProductionBatchPayload({');
    expect(page).toContain('verdict.payload satisfies ProductionBatchPayload');
    expect(page).toContain('components: prodComponents');
    /** لا حقل تكلفة مكتوبة في الشاشة: القرار المعتمد أن التكلفة قيمة ما يُصرف من الرفّ. */
    expect(page).not.toContain('prodUnitCost');
    /** سبب الرفض يُقرأ من `detail` لا من العنوان العامّ («Request failed»). */
    expect(page).toContain('apiErrorText(error,');
    expect(page).not.toContain('error instanceof ApiError ? error.message');
  });

  it('reports no per-kilo cost when nothing is produced, instead of dividing by zero', () => {
    const estimate = estimateComponentCost({
      lines: [{ itemId: 'flour', qty: '500' }],
      producedQty: '0',
      stockRows: [{ itemId: 'flour', warehouseId: 'wh-main', quantity: '900', averageCost: '4' }],
      warehouseId: 'wh-main',
    });
    expect(estimate.totalValue).toBe('2000.00');
    expect(estimate.perKg).toBe('0.0000');
    expect(estimate.unvalued).toBe(0);
  });
});
