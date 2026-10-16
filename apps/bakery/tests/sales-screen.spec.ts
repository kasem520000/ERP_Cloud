import { describe, expect, it } from 'vitest';

import {
  anomalyNote,
  buildDocumentPayload,
  buildReturnPayload,
  DASHBOARD_WINDOW_NOTE,
  decimalOrNull,
  documentKindLabel,
  documentRemaining,
  documentRemainingText,
  documentVerdict,
  emptyDocumentDraft,
  hasOpenDebt,
  invoiceModeLabel,
  invoiceStatusLabel,
  loadOrderBlockReason,
  OVERRIDE_PERMISSIONS,
  partyOpenDebt,
  paymentMethodLabel,
  priceAgreement,
  returnedBefore,
  returnableNow,
  returnCeiling,
  returnVerdict,
  SALES_MESSAGES,
  saleableLoadOrders,
  type CustomerPriceRow,
  type SaleLoadOrderRow,
  type SalesDashboard,
  type SalesPolicy,
} from '../lib/sales-screen';

import { doc } from './fixtures/van-documents';

/**
 * 🧾 ما يُقاس هنا ليس «أنّ الشاشة تعمل» بل أمانةُ أحكامها: (١) نصوصُ الرفض نصوصُ الخادم
 * حرفاً؛ (٢) ما لا يستطيع العميل حسابه كحساب الخادم يبقى **تحذيراً** لا حظراً — فحظرٌ
 * مبنيّ على نافذةٍ ناقصة يمنع بيعاً صحيحاً؛ (٣) لا رقمَ مختلَع: المتبقي والمجاميع من
 * `decimal.js` ومن أرقام الخادم، والغائب `null` لا صفر.
 */

function loadOrder(overrides: Partial<SaleLoadOrderRow> = {}): SaleLoadOrderRow {
  return {
    id: 'load-1',
    number: 'LO-2026-000077',
    loadDate: '2026-10-01',
    status: 'open',
    productionBatchNo: 'BATCH-2026-10-01-A',
    vehiclePlate: 'أ ب ج 1234',
    salesmanId: 'sm-1',
    salesmanName: 'سالم المندوب',
    itemId: 'item-1',
    itemName: 'خبز تميس',
    loadedQty: '200.00',
    receivedQty: '200.00',
    soldQty: '120.00',
    bonusQty: '10.00',
    returnedQty: '5.00',
    damagedQty: '1.00',
    shortageQty: '0.00',
    remainingQty: '64.00',
    awaitingReceipt: false,
    maxBonusQty: '5.00',
    maxBonusPct: '10.00',
    ...overrides,
  };
}

function priceRow(overrides: Partial<CustomerPriceRow> = {}): CustomerPriceRow {
  return {
    id: 'cp-1',
    partyId: 'party-1',
    partyName: 'بقالة النور',
    partyCode: 'CUST-001',
    itemId: 'item-1',
    itemName: 'خبز تميس',
    priceTierLabel: 'جملة الخطّ',
    unitPrice: '1.50',
    maxBonusPct: '10.00',
    maxBonusKgPerInvoice: '5.00',
    maxDiscountPct: '3.00',
    creditLimit: '500.00',
    paymentTermsDays: 15,
    lockPrice: true,
    preferredInvoiceMode: 'zatca_tax',
    ...overrides,
  };
}

function dashboard(overrides: Partial<SalesDashboard> = {}): SalesDashboard {
  return {
    policy: {
      allowInternalDeliveryWithoutTax: false,
      preventSelfApproval: true,
      shortageValuationBasis: 'unit_cost',
    },
    postingReadiness: {
      branchId: 'branch-1',
      salesInvoice: true,
      stockTransfer: true,
      receiptVoucher: true,
      message: null,
    },
    summary: {
      totalZatcaSalesSar: '1000.00',
      totalInternalSalesSar: '200.00',
      totalRevenueSar: '1200.00',
      totalSoldKg: '800.00',
      totalBonusKg: '20.00',
      totalCollectedCashSar: '700.00',
      totalCreditReceivablesSar: '500.00',
      totalNetProfitSar: '180.00',
      anomalyCount: 0,
    },
    documents: [doc()],
    loadOrders: [loadOrder()],
    customerPrices: [priceRow()],
    ...overrides,
  };
}

describe('قراءة الأرقام: الغائب null لا صفر', () => {
  it('يميز النصّ الفاسد والفارغ من الصفر الشرعيّ', () => {
    expect(decimalOrNull('')).toBeNull();
    expect(decimalOrNull('   ')).toBeNull();
    expect(decimalOrNull(null)).toBeNull();
    expect(decimalOrNull(undefined)).toBeNull();
    expect(decimalOrNull('abc')).toBeNull();
    expect(decimalOrNull('Infinity')).toBeNull();
    expect(decimalOrNull('0')?.toFixed(2)).toBe('0.00');
    expect(decimalOrNull('1.5')?.toFixed(2)).toBe('1.50');
    expect(decimalOrNull(2)?.toFixed(2)).toBe('2.00');
  });

  it('المتبقي = الإجمالي − المدفوع، ولا يكون سالبًا أبدًا', () => {
    expect(documentRemainingText(doc())).toBe('24.50');
    expect(documentRemainingText(doc({ total: '34.50', paidAmount: '40.00' }))).toBe('0.00');
    expect(documentRemainingText(doc({ total: '34.50', paidAmount: '' }))).toBe('34.50');
    expect(documentRemaining(doc({ total: 'خاطئ', paidAmount: 'خاطئ' })).toFixed(2)).toBe('0.00');
  });

  it('الدين القائم: آجلٌ وبقي منه — والنقديّ ليس دينًا وإن بقي عليه رقم', () => {
    expect(hasOpenDebt(doc())).toBe(true);
    expect(hasOpenDebt(doc({ paymentMethod: 'cash' }))).toBe(false);
    expect(hasOpenDebt(doc({ paidAmount: '34.50' }))).toBe(false);
  });
});

describe('سقف المرتجع كما يكتبه الخادم: المبيع + المجاني', () => {
  it('يجمع الكمية المجانية إلى السقف، ويرجع المجانيّ كما يُرجع المبيع', () => {
    expect(returnCeiling(doc()).toFixed(2)).toBe('22.00');
  });

  it('يجمع مرتجعات المستند وحدها: نوع return ورابطٌ إليه', () => {
    const documents = [
      doc(),
      doc({ id: 'ret-1', documentKind: 'return', referenceDocumentId: 'doc-1', soldQty: '4.00' }),
      doc({ id: 'ret-2', documentKind: 'return', referenceDocumentId: 'doc-1', soldQty: '1.50' }),
      doc({ id: 'ret-3', documentKind: 'return', referenceDocumentId: 'doc-2', soldQty: '9.00' }),
      doc({ id: 'sale-2', documentKind: 'sale', referenceDocumentId: 'doc-1', soldQty: '7.00' }),
    ];
    expect(returnedBefore(documents, 'doc-1').toFixed(2)).toBe('5.50');
    expect(returnableNow(documents, doc()).toFixed(2)).toBe('16.50');
    // ‏ولو تجاوزت المرتجعات السقف (بياناتٌ قديمة) فالباقي صفر، لا رقمٌ سالب يُرجع.
    expect(returnableNow([doc({ id: 'r', documentKind: 'return', referenceDocumentId: 'doc-1', soldQty: '40.00' })], doc()).toFixed(2)).toBe('0.00');
  });

  it('مديونية عميلٍ من نافذة اللوحة: آجلُه وحده', () => {
    const documents = [
      doc({ id: 'a', partyId: 'party-1', total: '100.00', paidAmount: '40.00' }),
      doc({ id: 'b', partyId: 'party-1', paymentMethod: 'cash', total: '50.00', paidAmount: '0.00' }),
      doc({ id: 'c', partyId: 'party-2', total: '70.00', paidAmount: '0.00' }),
    ];
    expect(partyOpenDebt(documents, 'party-1').toFixed(2)).toBe('60.00');
    expect(partyOpenDebt(documents, 'party-2').toFixed(2)).toBe('70.00');
    expect(partyOpenDebt(documents, '').toFixed(2)).toBe('0.00');
  });
});

describe('أيّ عهدةٍ يُباع منها، ولماذا لا يُباع من غيرها', () => {
  it('يستبعد المُصفّى وما لم يُستلم وما نفد، ويقول السبب بنصّ الخادم', () => {
    const rows = [
      loadOrder({ id: 'ok' }),
      loadOrder({ id: 'settled', status: 'settled' }),
      loadOrder({ id: 'not-received', awaitingReceipt: true }),
      loadOrder({ id: 'empty', remainingQty: '0.00' }),
    ];
    expect(saleableLoadOrders(rows).map((row) => row.id)).toEqual(['ok']);
    expect(loadOrderBlockReason(rows[1] ?? loadOrder())).toBe(SALES_MESSAGES.loadOrderSettled);
    expect(loadOrderBlockReason(rows[2] ?? loadOrder())).toBe(SALES_MESSAGES.loadOrderNotReceived);
    expect(loadOrderBlockReason(rows[3] ?? loadOrder())).toContain('لا متبقّي في هذه العهدة');
    expect(loadOrderBlockReason(rows[0] ?? loadOrder())).toBeNull();
  });

  it('اتفاق السعر مطابقةُ العميل والصنف معًا — ولا سعرَ يُخترع لعميلٍ بلا اتفاق', () => {
    const prices = [priceRow()];
    expect(priceAgreement(prices, 'party-1', 'item-1')?.id).toBe('cp-1');
    expect(priceAgreement(prices, 'party-1', 'item-2')).toBeNull();
    expect(priceAgreement(prices, 'party-2', 'item-1')).toBeNull();
    expect(priceAgreement(prices, '', 'item-1')).toBeNull();
    expect(priceAgreement([priceRow({ itemId: null })], 'party-1', 'item-1')).toBeNull();
  });
});

describe('الكلمات: معروفُها يُترجم ومجهولُها يُعرض خاماً', () => {
  it('لا يخترع ترجمةً لحالةٍ لم يُبرمجها', () => {
    expect(invoiceModeLabel('zatca_tax')).toContain('ضريبية');
    expect(invoiceModeLabel('internal_delivery')).toContain('إشعار تسليم');
    expect(invoiceModeLabel('something_else')).toBe('something_else');
    expect(paymentMethodLabel('credit')).toBe('آجل');
    expect(paymentMethodLabel('crypto')).toBe('crypto');
    expect(documentKindLabel('return')).toBe('مرتجع');
    expect(documentKindLabel('exchange')).toBe('exchange');
    expect(invoiceStatusLabel(null)).toBe('—');
    expect(invoiceStatusLabel('submitted')).toContain('هيئة الزكاة');
    expect(invoiceStatusLabel('weird_state')).toBe('weird_state');
  });

  it('تنبيه الرقابة يُعرض كما كتبه الخادم، ولا يُصاغ من جديد', () => {
    expect(anomalyNote(doc())).toBeNull();
    expect(anomalyNote(doc({ bonusAnomaly: true, anomalyReason: 'بونص ٤٠٪ من المبيع' }))).toBe(
      'بونص ٤٠٪ من المبيع',
    );
    expect(anomalyNote(doc({ bonusAnomaly: true, anomalyReason: '  ' }))).toContain('بلا سببٍ مكتوب');
  });

  it('يقول مدى اللوحة حتى لا يُقرأ الجدول سجلًّا كاملًا', () => {
    expect(DASHBOARD_WINDOW_NOTE).toContain('١٢٠ مستندًا');
    expect(DASHBOARD_WINDOW_NOTE).toContain('LIMIT 120');
  });
});

describe('حمولة إصدار المستند: مفاتيح الخادم وحدها، والفراغ لا يُرسل', () => {
  it('عميلٌ نقديّ بلا بطاقة: الاسم كما كُتب، وافتراضيّه نصُّ الخادم', () => {
    const draft = { ...emptyDocumentDraft(), loadOrderId: 'load-1', soldQty: '10', unitPrice: '1.5' };
    expect(buildDocumentPayload(draft).customerName).toBe('محل تجزئة نقدي');
    expect(
      buildDocumentPayload({ ...draft, customerName: '  محل الحي  ' }).customerName,
    ).toBe('محل الحي');
    expect(buildDocumentPayload({ ...draft, partyId: 'party-1', customerName: 'اسمٌ لا يُرسل' }).customerName).toBeUndefined();
  });

  it('الخانة الفارغة undefined لا نصًّا فارغاً، وعلمُ التجاوز لا يُرسل إلا حين يُقصد', () => {
    const payload = buildDocumentPayload({
      ...emptyDocumentDraft(),
      loadOrderId: 'load-1',
      soldQty: '10',
      unitPrice: '1.5',
      bonusReason: 'سببٌ بلا بونص',
      discountReason: 'سببٌ بلا خصم',
      notes: '   ',
    });
    expect(payload.partyId).toBeUndefined();
    expect(payload.cashLocationId).toBeUndefined();
    expect(payload.bonusQty).toBe('0');
    expect(payload.bonusReason).toBeUndefined();
    expect(payload.discountAmount).toBe('0');
    expect(payload.discountReason).toBeUndefined();
    expect(payload.notes).toBeUndefined();
    expect(payload.customerConfirmationCode).toBeUndefined();
    expect(payload.allowPriceDiscountOverride).toBeUndefined();
    expect(payload.allowBonusOverride).toBeUndefined();
    expect(payload.customerBonusConfirmed).toBeUndefined();
  });

  it('البونص والخصم يُرسلان مُنظَّفين حين يُقصدان', () => {
    const payload = buildDocumentPayload({
      ...emptyDocumentDraft(),
      loadOrderId: 'load-1',
      soldQty: '10',
      unitPrice: '1.5',
      bonusQty: '2.5',
      bonusReason: '  عينات  ',
      discountAmount: '1.25',
      discountReason: 'تلفٌ في العبوة',
      customerBonusConfirmed: true,
      customerConfirmationCode: ' 4821 ',
    });
    expect(payload.bonusQty).toBe('2.50');
    expect(payload.bonusReason).toBe('عينات');
    expect(payload.discountAmount).toBe('1.25');
    expect(payload.discountReason).toBe('تلفٌ في العبوة');
    expect(payload.customerBonusConfirmed).toBe(true);
    expect(payload.customerConfirmationCode).toBe('4821');
  });
});

describe('حكم ما قبل الإرسال: حظرٌ لما يطابق الخادم، وتحذيرٌ لما لا يطابقه', () => {
  const base = {
    ...emptyDocumentDraft(),
    loadOrderId: 'load-1',
    soldQty: '10',
    unitPrice: '1.50',
  };

  it('يحظر الخانات الفارغة بنصوص الخادم', () => {
    const { blocked } = documentVerdict(emptyDocumentDraft(), { canOverride: false });
    expect(blocked).toContain(SALES_MESSAGES.loadOrderRequired);
    expect(blocked).toContain(SALES_MESSAGES.soldQtyRequired);
    expect(blocked).toContain(SALES_MESSAGES.unitPriceRequired);
    // ‏كميةٌ فاسدة ليست صفرًا شرعيًّا: تُحظر ولا تُرسل.
    expect(documentVerdict({ ...base, soldQty: 'عشرة' }, { canOverride: false }).blocked).toContain(
      SALES_MESSAGES.soldQtyRequired,
    );
    expect(documentVerdict(base, { canOverride: false }).blocked).toEqual([]);
  });

  it('إشعارٌ داخليّ بلا سياسة: حظرٌ بنصّ الخادم، وبلا حظرٍ حين تُعتمد السياسة', () => {
    const draft = { ...base, invoiceMode: 'internal_delivery' as const };
    expect(documentVerdict(draft, { dashboard: dashboard(), canOverride: false }).blocked).toContain(
      SALES_MESSAGES.internalDeliveryPolicyRequired,
    );
    const allowed = dashboard({
      policy: {
        allowInternalDeliveryWithoutTax: true,
        preventSelfApproval: true,
        shortageValuationBasis: 'unit_cost',
      },
    });
    expect(
      documentVerdict(draft, { dashboard: allowed, canOverride: false }).blocked,
    ).not.toContain(SALES_MESSAGES.internalDeliveryPolicyRequired);
    // ‏وبلا لوحةٍ تُقرأ السياسة: المنع هو الأصل (لا سياسة = لا إشعار داخليّ).
    expect(documentVerdict(draft, { canOverride: false }).blocked).toContain(
      SALES_MESSAGES.internalDeliveryPolicyRequired,
    );
  });

  it('فاتورةٌ ضريبيةٌ وهويّةُ البائع ناقصة: حظرٌ بجملة الخادم، لا بنسخةٍ منها في العميل', () => {
    /**
     * 🧾 الجملةُ هنا للاختبار فحسب — فالحكمُ أنّ الشاشةَ تعرض **ما في الحمولة** أيًّا كان
     * نصّه (`policy.zatcaSeller.refusalDetail`)، والنصُّ نفسه مثبَّتٌ من طرف الخادم في
     * `apps/api/test/van-sales-zatca-seller.spec.ts` حيث `refusalDetail === detail` للرفض
     * ٤٢٢ حرفًا في `GET /van-sales/policy` و`GET /van-sales/dashboard` معًا. فلو غيّر الخادمُ
     * جملتَه تغيّرت هنا الحمولةُ وحدها وبقيت الشاشةُ صادقة — وهذا سببُ ألّا تُكتب الجملةُ
     * في `SALES_MESSAGES`.
     */
    const refusal =
      'لا يمكن إصدار فاتورة ضريبية (ZATCA) وهويّةُ البائع ناقصة: الرقم الضريبي غير مُدخلٍ في بيانات المنشأة.';
    const withSeller = (seller: NonNullable<SalesPolicy['zatcaSeller']>) =>
      dashboard({
        policy: {
          allowInternalDeliveryWithoutTax: true,
          preventSelfApproval: true,
          shortageValuationBasis: 'unit_cost',
          zatcaSeller: seller,
        },
      });
    const missing = withSeller({
      ready: false,
      missingFields: ['الرقم الضريبي'],
      refusalDetail: refusal,
    });
    const ready = withSeller({ ready: true, missingFields: [], refusalDetail: null });

    // ‏وضعٌ ضريبيٌّ وهويّةٌ ناقصة ⇒ حظرٌ بجملة الخادم نفسها.
    expect(documentVerdict(base, { dashboard: missing, canOverride: false }).blocked).toContain(
      refusal,
    );
    // ‏وهويّةٌ كاملة ⇒ لا حظر.
    expect(documentVerdict(base, { dashboard: ready, canOverride: false }).blocked).toEqual([]);
    // ‏والتسليمُ الداخليّ لا يُحظر بهويّة البائع الضريبية — فله حارسُه الخاصّ أعلاه.
    const internal = { ...base, invoiceMode: 'internal_delivery' as const };
    expect(
      documentVerdict(internal, { dashboard: missing, canOverride: false }).blocked,
    ).not.toContain(refusal);
    // ‏وبلا حمولة سياسة (خادمٌ أقدم لا يحمل `zatcaSeller`): لا نختراع حظرًا من عندنا،
    // ‏ويبقى الحكمُ للخادم وحده — فإخفاءُ الزرّ ليس ضبطًا.
    expect(documentVerdict(base, { canOverride: false }).blocked).not.toContain(refusal);
    expect(documentVerdict(base, { dashboard: dashboard(), canOverride: false }).blocked).toEqual(
      [],
    );
  });

  it('التجاوز بلا صلاحية: حظرٌ يذكر نصّ الـ403 والرمزين معًا', () => {
    const draft = { ...base, allowPriceDiscountOverride: true };
    const { blocked } = documentVerdict(draft, { dashboard: dashboard(), canOverride: false });
    expect(blocked.some((line) => line.includes(SALES_MESSAGES.overrideForbidden))).toBe(true);
    expect(blocked.some((line) => OVERRIDE_PERMISSIONS.every((code) => line.includes(code)))).toBe(true);
    expect(documentVerdict(draft, { dashboard: dashboard(), canOverride: true }).blocked).toEqual([]);
    expect(
      documentVerdict({ ...base, allowBonusOverride: true }, { dashboard: dashboard(), canOverride: false }).blocked
        .length,
    ).toBe(1);
  });

  it('عهدةٌ مُصفّاة أو لم يُؤكَّد استلامها: حظرٌ بنصّ الخادم', () => {
    const settled = dashboard({ loadOrders: [loadOrder({ status: 'settled' })] });
    expect(documentVerdict(base, { dashboard: settled, canOverride: false }).blocked).toContain(
      SALES_MESSAGES.loadOrderSettled,
    );
    const awaiting = dashboard({ loadOrders: [loadOrder({ awaitingReceipt: true })] });
    expect(documentVerdict(base, { dashboard: awaiting, canOverride: false }).blocked).toContain(
      SALES_MESSAGES.loadOrderNotReceived,
    );
    // ‏بونصٌ بلا سببٍ يُحظر بنصّ الخادم، والسبب يرفع الحظر.
    const bonus = { ...base, bonusQty: '2' };
    expect(documentVerdict(bonus, { dashboard: dashboard(), canOverride: false }).blocked).toContain(
      SALES_MESSAGES.bonusReasonRequired,
    );
    expect(
      documentVerdict({ ...bonus, bonusReason: 'ترويجي' }, { dashboard: dashboard(), canOverride: false }).blocked,
    ).toEqual([]);
  });

  it('تجاوزُ المتبقي في العهدة **تحذير** لا حظر: الخادم يجمع ما هو أوسع من نافذة اللوحة', () => {
    const { blocked, warnings } = documentVerdict(
      { ...base, soldQty: '100' },
      { dashboard: dashboard(), canOverride: false },
    );
    expect(blocked).toEqual([]);
    expect(warnings.some((line) => line.includes('رفض أمني لمنع خلط بضاعة خارجية'))).toBe(true);
    expect(warnings.some((line) => line.includes('64.00'))).toBe(true);
    expect(warnings.some((line) => line.includes('الحكم النهائي له'))).toBe(true);
  });

  it('أمرُ تحميلٍ خارج النافذة: تحذيرٌ يذكر نصّ الخادم ولا يمنع الطلب', () => {
    const { blocked, warnings } = documentVerdict(
      { ...base, loadOrderId: 'load-x' },
      { dashboard: dashboard(), canOverride: false },
    );
    expect(blocked).toEqual([]);
    expect(warnings.some((line) => line.includes(SALES_MESSAGES.loadOrderNotFound))).toBe(true);
  });

  it('سعرٌ مثبَّت وخصمٌ فوق السقف: تحذيران يسمّيان اتفاق العميل', () => {
    // ‏الاتفاق لعميلٍ مُسمّى: فبلا `partyId` لا سعرَ متّفقًا عليه ولا تحذير (مقيسٌ بعده).
    const customer = { ...base, partyId: 'party-1' };
    const cheap = documentVerdict(
      { ...customer, unitPrice: '1.20' },
      { dashboard: dashboard(), canOverride: false },
    );
    expect(cheap.warnings.some((line) => line.includes('مثبّت') && line.includes('1.50'))).toBe(true);

    const discounted = documentVerdict(
      { ...customer, unitPrice: '1.50', discountAmount: '3.00' },
      { dashboard: dashboard(), canOverride: false },
    );
    expect(discounted.warnings.some((line) => line.includes('سقف العميل') && line.includes('3.0%'))).toBe(true);
    // ‏وباعتماد التجاوز يصمت التحذير — فالإذن يُرفع الحكم لا الرقم.
    expect(
      documentVerdict(
        { ...customer, discountAmount: '3.00', allowPriceDiscountOverride: true },
        { dashboard: dashboard(), canOverride: true },
      ).warnings.some((line) => line.includes('سقف العميل')),
    ).toBe(false);
    // ‏وبلا اتفاقٍ (عميلٌ نقديّ) لا يُقال «سعرٌ مثبَّت» — فلا يُخترَع سقفٌ لعميلٍ بلا بطاقة.
    const walkIn = documentVerdict({ ...base, unitPrice: '0.10' }, { dashboard: dashboard(), canOverride: false });
    expect(walkIn.warnings.some((line) => line.includes('مثبّت'))).toBe(false);
  });

  it('رقابة البونص: تحذيرٌ حين يتجاوز السقفين بلا تأكيدٍ ولا اعتماد', () => {
    const draft = { ...base, bonusQty: '9', bonusReason: 'ترويجي' };
    const { warnings } = documentVerdict(draft, { dashboard: dashboard(), canOverride: false });
    expect(warnings.some((line) => line.includes('رقابة البونص المجاني'))).toBe(true);
    expect(warnings.some((line) => line.includes('رمز تأكيد استلام العميل'))).toBe(true);

    const confirmed = documentVerdict(
      { ...draft, customerConfirmationCode: '4821' },
      { dashboard: dashboard(), canOverride: false },
    );
    expect(confirmed.warnings.some((line) => line.includes('رقابة البونص المجاني'))).toBe(false);
    const approved = documentVerdict({ ...draft, allowBonusOverride: true }, {
      dashboard: dashboard(),
      canOverride: true,
    });
    expect(approved.warnings.some((line) => line.includes('رقابة البونص المجاني'))).toBe(false);
  });

  it('سقف الائتمان: تحذيرٌ من نافذة اللوحة، لا حكمٌ بمجموع الخادم', () => {
    const documents = [
      doc({ id: 'old', partyId: 'party-1', total: '480.00', paidAmount: '0.00' }),
    ];
    const { warnings } = documentVerdict(
      { ...base, paymentMethod: 'credit', partyId: 'party-1', soldQty: '100', unitPrice: '1.50' },
      { dashboard: dashboard({ documents }), canOverride: false },
    );
    expect(warnings.some((line) => line.includes('سقف الائتمان') && line.includes('500.00'))).toBe(true);
    expect(warnings.some((line) => line.includes('أوسع'))).toBe(true);
  });

  it('آجلٌ بلا عميل: تحذيرٌ محاسبيّ صريح — دينٌ بلا مدينٍ مُسمّى', () => {
    const { warnings } = documentVerdict(
      { ...base, paymentMethod: 'credit' },
      { dashboard: dashboard(), canOverride: false },
    );
    expect(warnings.some((line) => line.includes('دينٌ بلا مدين'))).toBe(true);
    expect(
      documentVerdict({ ...base, paymentMethod: 'credit', partyId: 'party-1' }, {
        dashboard: dashboard(),
        canOverride: false,
      }).warnings.some((line) => line.includes('دينٌ بلا مدين')),
    ).toBe(false);
  });

  it('نقدٌ بلا صندوق: تحذيرٌ يقول مآل الخادم ونصّ رفضه', () => {
    const { warnings } = documentVerdict(base, { dashboard: dashboard(), canOverride: false });
    expect(warnings.some((line) => line.includes(SALES_MESSAGES.cashAccountRequired))).toBe(true);
    expect(
      documentVerdict({ ...base, cashLocationId: 'cash-1' }, { dashboard: dashboard(), canOverride: false }).warnings.some(
        (line) => line.includes(SALES_MESSAGES.cashAccountRequired),
      ),
    ).toBe(false);
  });

  it('ملفُّ ترحيلٍ ناقص: قولُ الخادم نفسه يُعاد كما هو', () => {
    const message = 'ملف الترحيل المحاسبي للفرع غير مكتمل';
    const board = dashboard({
      postingReadiness: {
        branchId: 'branch-1',
        salesInvoice: false,
        stockTransfer: true,
        receiptVoucher: true,
        message,
      },
    });
    expect(documentVerdict(base, { dashboard: board, canOverride: false }).warnings).toContain(message);
  });
});

describe('حمولة المرتجع وحكمه', () => {
  it('يُنظّف النصّ ولا يُرسل فراغًا', () => {
    expect(buildReturnPayload({ documentId: 'doc-1', returnedQty: '4', reason: '  تلفٌ جزئي  ', notes: '  ' })).toEqual({
      returnedQty: '4',
      reason: 'تلفٌ جزئي',
      notes: undefined,
    });
  });

  it('يحظر بلا مستندٍ وبكميةٍ غير موجبة، ويرفض إرجاع مرتجع', () => {
    expect(returnVerdict({ documentId: '', returnedQty: '1', reason: '', notes: '' }, []).blocked).toContain(
      SALES_MESSAGES.returnDocumentRequired,
    );
    expect(returnVerdict({ documentId: 'doc-1', returnedQty: '0', reason: '', notes: '' }, [doc()]).blocked).toContain(
      SALES_MESSAGES.returnQtyPositive,
    );
    expect(returnVerdict({ documentId: 'doc-1', returnedQty: '', reason: '', notes: '' }, [doc()]).blocked).toContain(
      SALES_MESSAGES.returnQtyPositive,
    );
    expect(
      returnVerdict({ documentId: 'ret-1', returnedQty: '1', reason: '', notes: '' }, [
        doc({ id: 'ret-1', documentKind: 'return' }),
      ]).blocked,
    ).toContain(SALES_MESSAGES.returnOfReturnRefused);
  });

  it('تجاوزُ السقف تحذيرٌ بجملة الخادم نفسها، وبلا سببٍ تحذيرٌ لا حظر', () => {
    const { blocked, warnings } = returnVerdict(
      { documentId: 'doc-1', returnedQty: '30', reason: '', notes: '' },
      [doc()],
    );
    expect(blocked).toEqual([]);
    expect(warnings.some((line) => line.includes('إجمالي المرتجع (30.00) يتجاوز الكمية المباعة في المستند (22.00)'))).toBe(
      true,
    );
    expect(warnings.some((line) => line.includes('بلا سببٍ للمرتجع'))).toBe(true);

    const within = returnVerdict({ documentId: 'doc-1', returnedQty: '5', reason: 'تلف', notes: '' }, [doc()]);
    expect(within.blocked).toEqual([]);
    expect(within.warnings).toEqual([]);
  });
});
