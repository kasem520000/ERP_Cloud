import { describe, expect, it } from 'vitest';

import {
  buildLoadOrderPayload,
  buildReceiptPayload,
  canCancelLoadOrder,
  canConfirmReceipt,
  LOAD_ORDER_MESSAGES,
  LOAD_ORDER_STATUSES,
  loadOrderStatusLabel,
  RECEIPT_MESSAGES,
  STOCK_SETTLEMENT_STATUSES,
  stockSettlementStatusLabel,
  type LoadOrderDraft,
  type ReceiptDraft,
} from '../src/distribution';

function draft(overrides: Partial<LoadOrderDraft> = {}): LoadOrderDraft {
  return {
    salesmanId: 'salesman-1',
    itemId: 'item-flour',
    productionBatchNo: '',
    loadedQty: '50',
    warehouseId: '',
    vanWarehouseId: '',
    vehiclePlate: '',
    notes: '',
    ...overrides,
  };
}

function receipt(overrides: Partial<ReceiptDraft> = {}): ReceiptDraft {
  return { receivedQty: '', notes: '', loadedQty: '50', ...overrides };
}

describe('buildLoadOrderPayload — عقد أمر التحميل', () => {
  it('يرفض بلا مندوب، وترتيبه ترتيب الخادم: المندوب قبل الكمية قبل مصدر الصنف', () => {
    const verdict = buildLoadOrderPayload(draft({ salesmanId: '  ', loadedQty: '', itemId: '' }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toBe(LOAD_ORDER_MESSAGES.salesmanRequired);
  });

  it('يرفض كميةً فارغة أو صفراً أو سالبة أو نصّاً تالفاً', () => {
    for (const loadedQty of ['', '   ', '0', '-5', 'abc', '1,5']) {
      const verdict = buildLoadOrderPayload(draft({ loadedQty }));
      expect(verdict.ok, `loadedQty=${JSON.stringify(loadedQty)}`).toBe(false);
      if (!verdict.ok) expect(verdict.message).toBe(LOAD_ORDER_MESSAGES.qtyRequired);
    }
  });

  it('يرفض حمولةً بلا صنفٍ وبلا دفعة إنتاج — ولا يخترع مصدراً', () => {
    const verdict = buildLoadOrderPayload(draft({ itemId: '', productionBatchNo: '   ' }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toBe(LOAD_ORDER_MESSAGES.sourceRequired);
  });

  it('يقبل رقماً عشرياً ويوحّد عدد الخانات كما يفعل عقد الإنتاج', () => {
    const verdict = buildLoadOrderPayload(draft({ loadedQty: '12.5' }));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.payload.loadedQty).toBe('12.5000');
  });

  it('دفعة الإنتاج وحدها تكفي مصدراً للصنف (يشتقّه الخادم منها)', () => {
    const verdict = buildLoadOrderPayload(draft({ itemId: '', productionBatchNo: 'PB-2026-0001' }));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.payload.productionBatchNo).toBe('PB-2026-0001');
      expect(verdict.payload.itemId).toBeUndefined();
    }
  });

  it('الحقل الفارغ يُرسل undefined — لا تخمين لمستودع المصدر ولا لمستودع السيارة', () => {
    const verdict = buildLoadOrderPayload(draft());
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.payload).toEqual({
        salesmanId: 'salesman-1',
        loadedQty: '50.0000',
        itemId: 'item-flour',
        productionBatchNo: undefined,
        warehouseId: undefined,
        vanWarehouseId: undefined,
        vehiclePlate: undefined,
        notes: undefined,
      });
    }
  });

  it('مستودع الصرف ومستودع السيارة واحد ⇒ مرفوض قبل الإرسال بنصّ الخادم', () => {
    const verdict = buildLoadOrderPayload(draft({ warehouseId: 'wh-1', vanWarehouseId: 'wh-1' }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toBe(LOAD_ORDER_MESSAGES.sameWarehouse);
    // ‏وأحدهما فارغ ليس تطابقاً: الخادم يشتقّ الناقص وقد يشتقّه مختلفاً.
    expect(buildLoadOrderPayload(draft({ warehouseId: 'wh-1', vanWarehouseId: '' })).ok).toBe(true);
  });

  it('يزيل الحواشي ويُبقي ما كُتب فعلاً', () => {
    const verdict = buildLoadOrderPayload(
      draft({ salesmanId: '  salesman-9 ', vehiclePlate: ' أ ب ج 1234 ', notes: '  حمولة الفجر ' }),
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.payload.salesmanId).toBe('salesman-9');
      expect(verdict.payload.vehiclePlate).toBe('أ ب ج 1234');
      expect(verdict.payload.notes).toBe('حمولة الفجر');
    }
  });
});

describe('buildReceiptPayload — تأكيد الاستلام', () => {
  it('الحقل الفارغ ليس صفراً: يستعمل الخادم الكمية المحمّلة وتُعلَم الشاشة بذلك', () => {
    const verdict = buildReceiptPayload(receipt({ receivedQty: '   ', loadedQty: '50' }));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.usesLoadedQty).toBe(true);
      expect(verdict.payload.receivedQty).toBeUndefined();
    }
  });

  it('نصٌّ تالف يُرفض ولا يُقرأ صفراً — فالصفر هنا معنىً لا خطأ', () => {
    for (const receivedQty of ['abc', '١٢', '12kg', '']) {
      if (receivedQty === '') continue; // الفراغ حالةٌ صالحة أعلاه
      const verdict = buildReceiptPayload(receipt({ receivedQty }));
      expect(verdict.ok, receivedQty).toBe(false);
      if (!verdict.ok) expect(verdict.message).toBe(RECEIPT_MESSAGES.qtyInvalid);
    }
  });

  it('المستلم أكثر من المصروف مرفوض، والرسالة تحمل الرقمين', () => {
    const verdict = buildReceiptPayload(receipt({ receivedQty: '60', loadedQty: '50' }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      // ‏نصّ الخادم حرفاً بقالبه المحشوِّ رقمين — لا صياغةٌ من عندنا:
      expect(verdict.message).toBe(RECEIPT_MESSAGES.exceedsLoaded('60.00', '50.00'));
      expect(verdict.message).toBe('الكمية المستلمة (60.00) تتجاوز الكمية المصروفة (50.00)');
    }
  });

  it('الصفر المكتوب صراحةً مقبول (ما استلم شيئاً) والفرق يسجّله الخادم', () => {
    const verdict = buildReceiptPayload(receipt({ receivedQty: '0', loadedQty: '50' }));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.usesLoadedQty).toBe(false);
      expect(verdict.payload.receivedQty).toBe('0.0000');
    }
  });

  it('المساوي للمحمَّل مقبول، والملاحظات الفارغة لا تُرسل', () => {
    const verdict = buildReceiptPayload(receipt({ receivedQty: '50', notes: '  ' }));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.payload.receivedQty).toBe('50.0000');
      expect(verdict.payload.notes).toBeUndefined();
    }
  });

  it('بلا كميةٍ محمّلة معروفة لا يُقاس التجاوز (لا رفضٌ بالظن)', () => {
    const verdict = buildReceiptPayload(receipt({ receivedQty: '60', loadedQty: '' }));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.payload.receivedQty).toBe('60.0000');
  });
});

describe('تسميات الحالات — لا اختراع لما لا تعرفه الشاشة', () => {
  it('كل حالةٍ في قيد CHECK لها تسمية، وكل تسمية عربية', () => {
    for (const status of LOAD_ORDER_STATUSES) {
      const label = loadOrderStatusLabel(status);
      expect(label, status).not.toBe(status);
      expect(label.length, status).toBeGreaterThan(2);
    }
    expect(LOAD_ORDER_STATUSES).toContain('pending_stock_settlement');
  });

  it('حالةٌ مجهولة تُعرض خاماً', () => {
    expect(loadOrderStatusLabel('pending_something_new')).toBe('pending_something_new');
    expect(stockSettlementStatusLabel('weird')).toBe('weird');
  });

  it('حالات تسوية المخزون الخمس مُسمّاة', () => {
    for (const status of STOCK_SETTLEMENT_STATUSES) {
      expect(stockSettlementStatusLabel(status), status).not.toBe(status);
    }
  });

  it('الإجراءات المعروضة مرآةٌ لرفض الخادم لا حكمٌ مستقل', () => {
    expect(canConfirmReceipt({ status: 'pending_receipt' })).toBe(true);
    // ‏صفٌّ بلا حالة (لم يكتمل من اللوحة) لا إجراء عليه — لا 409 مؤكّد:
    expect(canConfirmReceipt({})).toBe(false);
    expect(canCancelLoadOrder({ status: null })).toBe(false);
    for (const status of ['draft', 'loaded', 'in_route', 'pending_closing', 'settled', 'canceled']) {
      expect(canConfirmReceipt({ status }), status).toBe(false);
    }
    expect(canCancelLoadOrder({ status: 'draft' })).toBe(true);
    expect(canCancelLoadOrder({ status: 'pending_receipt' })).toBe(true);
    for (const status of ['loaded', 'in_route', 'pending_closing', 'settled', 'rejected']) {
      expect(canCancelLoadOrder({ status }), status).toBe(false);
    }
  });
});


describe('buildLoadOrderPayload — صنفٌ يُتتبَّع بالدفعات (§5.1)', () => {
  it('يرفض حمولة صنفٍ بالدفعات بلا دفعةٍ مُسمّاة، بجملة الخادم ومعها اسم الصنف', () => {
    const verdict = buildLoadOrderPayload(
      draft({ itemTrackLot: true, itemName: 'كرواسون بالدفعات', productionBatchNo: '   ' }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toBe(LOAD_ORDER_MESSAGES.batchRequired('كرواسون بالدفعات'));
      expect(verdict.message).toContain('يُتتبَّع بالدفعات');
      expect(verdict.message).toContain('ولا يُفترض رقمٌ من تاريخ اليوم');
    }
  });

  it('بلا اسمٍ معروف للصنف تبقى الجملة نفسها دون اسم — ولا يُخترع اسم', () => {
    const verdict = buildLoadOrderPayload(draft({ itemTrackLot: true }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toBe(LOAD_ORDER_MESSAGES.batchRequired());
  });

  it('الدفعة المُسمّاة ترفع الرفض، وصنفٌ لا يُتتبَّع بالدفعات يُحمَّل بلا دفعة', () => {
    expect(buildLoadOrderPayload(draft({ itemTrackLot: true, productionBatchNo: 'PB-9' })).ok).toBe(true);
    expect(buildLoadOrderPayload(draft({ itemTrackLot: false, productionBatchNo: '' })).ok).toBe(true);
    // ‏وما لم تقرأه الشاشة من البطاقة لا يُرفض هنا: الحكم عند الخادم وحده، والضابط هناك.
    expect(buildLoadOrderPayload(draft({ productionBatchNo: '' })).ok).toBe(true);
  });

  it('‏itemTrackLot واسم الصنف حكمان محليّان: لا يُرسلان في الحمولة إلى الخادم', () => {
    const verdict = buildLoadOrderPayload(
      draft({ itemTrackLot: true, itemName: 'كرواسون بالدفعات', productionBatchNo: 'PB-9' }),
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.payload).toEqual({
        salesmanId: 'salesman-1',
        loadedQty: '50.0000',
        itemId: 'item-flour',
        productionBatchNo: 'PB-9',
        warehouseId: undefined,
        vanWarehouseId: undefined,
        vehiclePlate: undefined,
        notes: undefined,
      });
    }
  });
});
