import { describe, expect, it } from 'vitest';
import { estimateComponentCost } from '@erp/web-van/production';

import {
  batchStatusLabel,
  costBasisLabel,
  emptyComponentRows,
  itemLabel,
  mapOfficialStock,
  numberText,
  pickDefaultWarehouse,
  todayIsoDate,
  warehouseLabel,
} from '../lib/production-screen';

/**
 * glue الشاشة — دوالّ صافية وحدها، والطلب والشاشة في `app/production/page.tsx` (يُثبتها
 * البناء وخدمة المسار). والأحكام هنا على **الأمانة**: الحقل الغائب لا يصير صفراً، والتعداد
 * غير المعروف لا يُترجم إلى اسمٍ مُختلَع، والتقدير يصل إلى الحزمة المشتركة بالصيغة التي
 * تقرأها فعلاً.
 */
describe('شاشة الإنتاج — الترجمة بين الخادم والشاشة', () => {
  it('الرقم الغائب شرطةٌ لا صفرٌ مُختلَع', () => {
    expect(numberText(undefined)).toBe('—');
    expect(numberText(null)).toBe('—');
    expect(numberText('')).toBe('—');
    expect(numberText('0')).toBe('0');
    expect(numberText(0)).toBe('0');
    expect(numberText('12.5000')).toBe('12.5000');
  });

  it('الأسماء عربيةٌ أولاً ثم الرموز ثم المعرّف — ولا نصّ فارغ', () => {
    expect(itemLabel({ id: 'i1', nameAr: 'دقيق', sku: 'FLR' })).toBe('دقيق (FLR)');
    expect(itemLabel({ id: 'i1', name_ar: 'دقيق' })).toBe('دقيق');
    expect(itemLabel({ id: 'i1', nameEn: 'Flour' })).toBe('Flour');
    expect(itemLabel({ id: 'i1', sku: 'FLR' })).toBe('FLR');
    expect(itemLabel({ id: 'i1' })).toBe('i1');
    expect(warehouseLabel({ id: 'w1', nameAr: 'المصنع', code: 'MAIN' })).toBe('المصنع (MAIN)');
    expect(warehouseLabel({ id: 'w1' })).toBe('w1');
  });

  it('المستودع المقترح: الافتراضيّ ثم الرئيسيّ ثم الأول — ولا اختراع عند الفراغ', () => {
    const list = [
      { id: 'w1', code: 'A' },
      { id: 'w2', code: 'B', isDefault: true },
    ];
    expect(pickDefaultWarehouse(list, 'w1')?.id).toBe('w2');
    expect(pickDefaultWarehouse([{ id: 'w1' }, { id: 'w2' }], 'w2')?.id).toBe('w2');
    expect(pickDefaultWarehouse([{ id: 'w1' }, { id: 'w2' }], null)?.id).toBe('w1');
    expect(pickDefaultWarehouse([], 'w9')).toBeUndefined();
  });

  it('صفوف الأرصدة تُغذّى إلى مقدّر التكلفة المشترك كما يقرؤها فعلاً', () => {
    const mapped = mapOfficialStock([
      { itemId: 'flour', warehouseId: 'w1', quantity: '500', averageCost: '2.5' },
      { itemId: 'sugar', warehouseId: 'w1', quantity: null, averageCost: undefined },
      { itemId: null, quantity: '10', averageCost: '1' },
    ]);
    expect(mapped).toHaveLength(2); // ‏بلا itemId لا يُطابَق بشيء
    expect(mapped[0]).toEqual({ itemId: 'flour', warehouseId: 'w1', quantity: '500', averageCost: '2.5' });
    expect(mapped[1]).toEqual({ itemId: 'sugar', warehouseId: 'w1', quantity: '0', averageCost: '0' });

    const estimate = estimateComponentCost({
      lines: [
        { itemId: 'flour', qty: '100' },
        { itemId: 'sugar', qty: '10' },
      ],
      producedQty: '110',
      stockRows: mapped,
      warehouseId: 'w1',
    });
    expect(estimate.totalValue).toBe('250.00'); // ‏2.5×100 + 0×10
    expect(estimate.perKg).toBe('2.2727');
 expect(estimate.unvalued).toBe(1); // ‏السكر بلا قيمة الخادم يرفض قبل الصرف
    expect(mapOfficialStock(undefined)).toEqual([]);
    expect(mapOfficialStock(null)).toEqual([]);
  });

  it('تعدادات الخادم الحقيقية تُترجم، وغير المعروف يُعرض خاماً', () => {
    // ‏CHECK (status IN ('active','exhausted','closed')) — الترحيل 0120.
    expect(batchStatusLabel('active')).toContain('نشطة');
    expect(batchStatusLabel('exhausted')).toContain('استُنفدت');
    expect(batchStatusLabel('closed')).toContain('مُقفلة');
    expect(batchStatusLabel('whatever_the_server_says')).toBe('whatever_the_server_says');
    expect(batchStatusLabel(null)).toBe('—');

    // ‏CHECK (cost_basis IN ('manufacturing_order','manual_input','item_cost')) — الترحيل 0127.
    expect(costBasisLabel('manufacturing_order')).toEqual({ text: 'تكلفة فعلية من أمر تصنيع رسمي', tone: 'ok' });
    expect(costBasisLabel('manual_input').tone).toBe('warn');
    expect(costBasisLabel('item_cost').tone).toBe('warn');
    expect(costBasisLabel(null).tone).toBe('warn');
    expect(costBasisLabel('mystery').text).toContain('mystery');
  });

  it('سطور المكوّنات تبدأ فارغةً وتاريخ اليوم ISO — ولا رقمَ دفعة مُختلَع', () => {
    expect(emptyComponentRows(2)).toEqual([
      { itemId: '', qty: '' },
      { itemId: '', qty: '' },
    ]);
    expect(emptyComponentRows(0)).toHaveLength(1); // ‏لا قائمة بلا سطر واحد
    // 21:30Z = 00:30 في مكة ⇒ «اليوم» 15 لا 14: الحساب السابق بـ`toISOString()` كان
    // يؤرّخ مستندات أول ثلاث ساعاتٍ من اليوم بيومٍ سابق. والحدّ الفاصل منتصفُ ليل مكة.
    expect(todayIsoDate(new Date('2026-10-14T21:30:00Z'))).toBe('2026-10-15');
    expect(todayIsoDate(new Date('2026-10-14T20:30:00Z'))).toBe('2026-10-14');
  });
});
