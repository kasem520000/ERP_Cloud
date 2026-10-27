import { describe, expect, it } from 'vitest';
import { canonicalPayloadText, stableDigest } from '@erp/web-core/idempotency';

import {
  actionEndpoint,
  bodyWithIdempotencyKey,
  closingShortageText,
  receiptShortfallText,
  repHeadlineCards,
  REP_WINDOW_FALLBACKS,
  repWindowNotes,
  returnableDocuments,
  returnCeilingText,
  saleableLoadOrders,
  totalsReconcile,
  type RepDocumentRow,
  type RepLoadOrderRow,
  type RepTotals,
  type RepWorkspace,
} from '../lib/rep-screen';
import { buildDocumentPayload, emptyDocumentDraft } from '../lib/sales-screen';

/**
 * 📱 منطقُ شاشة المندوب — والأعدادُ في المثبّتة هي **المقاسةُ من مثبّتات الخادم**:
 * نوافذُ المندوب (‏١٠٠ من ١٢٠ مستندًا، ٥٠ من ٦٠ أمرًا، ٥٠ من ٥٥ تحصيلًا، ٠ من ٠ إشعارًا)
 * ومجاميعُه (إيرادٌ ٨٦.٢٥ = ‏١١٥ − ٢٥ − ٣.٧٥، وعهدةٌ ٢٦٠.٠٠٠٠ و٨ إقفالات) من
 * ‏`apps/api/test/van-sales-rep-workspace-totals.spec.ts` و`van-sales-returns-in-reports.spec.ts`.
 * فلو تغيّر رقمٌ في الخادم ولم تتغيّر الشاشةُ سقط حكمٌ هنا — وهذا هو المقصود.
 *
 * ‏**وما لا تُثبته هذه المثبّتة**: أجسامُ الإجراءات — فهي من بانياتٍ قائمةٍ مقاسةٍ في
 * مواضعها (`buildDocumentPayload` و`buildReturnPayload` في مثبّتة شاشة المبيعات، و
 * `buildCollectionPayload` في مثبّتة التحصيل، و`buildClosingPayload`/‏`buildReceiptPayload` في
 * مثبّتات `@erp/web-van`)، ونسخُها هنا كان يصير نسخةً ثانيةً تتباعد. والمثبَّتُ هنا هو
 * **ربطُ المفتاح بالجسم المُرسل فعلًا** — وهو ما يملكه هذا الوجه وحده.
 */
const totals = (overrides: Partial<RepTotals> = {}): RepTotals => ({
  revenue: '86.25',
  salesGross: '115.00',
  cashSales: '0.00',
  creditSales: '115.00',
  collected: '0.00',
  outstanding: '86.25',
  returns: '25.00',
  returnsVat: '3.75',
  returnCount: 2,
  returnsWithoutCostCount: 1,
  ...overrides,
});

const loadOrder = (overrides: Partial<RepLoadOrderRow> = {}): RepLoadOrderRow => ({
  id: 'load-1',
  number: 'VLO-R-0001',
  loadDate: '2026-05-01',
  status: 'loaded',
  itemName: 'سمبوسة بلدي',
  productionBatchNo: 'BATCH-0001',
  loadedQty: '10.0000',
  receivedQty: '10.0000',
  soldQty: '4.0000',
  bonusQty: '1.0000',
  returnedQty: '0.0000',
  damagedQty: '0.0000',
  shortageQty: '0.0000',
  shortageValue: '0.0000',
  expectedCash: '65.00',
  collectedCash: '25.00',
  outstandingCash: '40.00',
  expectedRemainingQty: '5.0000',
  actualRemainingQty: '',
  discrepancyQty: '0.0000',
  discrepancyNotes: null,
  closingSubmittedAt: null,
  approvedAt: null,
  ...overrides,
});

const document = (overrides: Partial<RepDocumentRow> = {}): RepDocumentRow => ({
  id: 'doc-1',
  number: 'VTX-00001',
  docDate: '2026-05-10',
  documentKind: 'sale',
  invoiceMode: 'zatca_tax',
  paymentMethod: 'credit',
  customerName: 'تموينات النور',
  itemName: 'سمبوسة بلدي',
  soldQty: '10.0000',
  bonusQty: '1.0000',
  unitPrice: '10.0000',
  subtotal: '100.0000',
  taxTotal: '15.0000',
  total: '115.0000',
  paidAmount: '0.0000',
  outstanding: '115.0000',
  invoiceNumber: 'SI-000001',
  invoiceStatus: 'posted',
  ...overrides,
});

const workspace = (overrides: Partial<RepWorkspace> = {}): RepWorkspace => ({
  isRep: true,
  salesmanId: 'salesman-1',
  salesmanName: 'المندوب الأول',
  warehouseId: 'wh-van-1',
  vehiclePlate: 'أ ب ج 1234',
  active: true,
  custodyKg: '25.0000',
  custodyValue: '95.0000',
  balances: [],
  pendingReceipts: [],
  loadOrders: [loadOrder()],
  documents: [document()],
  collections: [],
  notifications: [],
  totals: totals(),
  custody: { expectedKg: '260.0000', officialKg: '25.0000', pendingClosings: 8 },
  windows: {
    loadOrders: { returned: 50, total: 60, limit: 50 },
    documents: { returned: 100, total: 120, limit: 100 },
    collections: { returned: 50, total: 55, limit: 50 },
    notifications: { returned: 0, total: 0, limit: 20 },
  },
  ...overrides,
});

describe('شاشة المندوب: نوافذُ الخادم، وفحصُ مجاميعه، وقراءاتٌ من حقوله', () => {
  it('جملُ النوافذ بأعداد الخادم وبمفردة المندوب، وبلا اختراعٍ حين تغيب', () => {
    const notes = repWindowNotes(workspace());
    expect(notes.documents).toBe(
      'مستندات البيع: 100 من 120 (نافذةُ الخادم LIMIT 100) — 20 صفًّا خارج هذه القائمة، ' +
        'وأرقامُ المندوب جمعُ جدوله كلّه لا جمعُ هذه الصفوف.',
    );
    expect(notes.loadOrders).toContain('أوامر التحميل: 50 من 60');
    expect(notes.collections).toContain('حركات التحصيل: 50 من 55');
    // ‏وقائمةٌ كاملةٌ فارغة تُقال كاملةً لا ناقصة.
    expect(notes.notifications).toBe('الإشعارات: 0 من 0 — القائمة كلّ السجلّ، ولا صفوف خارجها.');

    // ‏وبلا `windows` (خادمٌ أقدم أو حمولةٌ مبتورة): الجملةُ الاحتياطية حرفًا، ولا رقمَ مخمَّن.
    const bare = repWindowNotes(workspace({ windows: null }));
    expect(bare.documents).toBe(REP_WINDOW_FALLBACKS.documents);
    expect(bare.loadOrders).toBe(REP_WINDOW_FALLBACKS.loadOrders);
    expect(repWindowNotes(null).collections).toBe(REP_WINDOW_FALLBACKS.collections);
  });

  it('فحصُ المعادلتين: يُغلق صامتًا، ويقول بالأرقام حين لا يُغلق', () => {
    expect(totalsReconcile(totals())).toBeNull();
    // ‏وبلا مرتجعات تُغلق كذلك: ‏١٠٠٠ + ٠ − ٠ − ٠ = ١٠٠٠.
    expect(
      totalsReconcile(
        totals({
          revenue: '1000.00',
          salesGross: '1000.00',
          cashSales: '400.00',
          creditSales: '600.00',
          returns: '0.00',
          returnsVat: '0.00',
          returnCount: 0,
          returnsWithoutCostCount: 0,
        }),
      ),
    ).toBeNull();

    /**
     * ‏وإيرادٌ لا يساوي أطرافَه يُقال بثلاثة أرقام، لا أن يُعرض ويُترك. والمثالُ يكسر
     * **إحدى** المعادلتين (الآجلُ ١١٨.٧٥ بدل ١١٥) فيظهر طرفان مختلفان: ‏٨٦.٢٥ من
     * الإجماليّ و٩٠.٠٠ من النقديّ+الآجل — ولو كُسرتا معًا لظهر رقمٌ واحدٌ مرتين.
     */
    const broken = totalsReconcile(totals({ revenue: '100.00', creditSales: '118.75' }));
    expect(broken).toContain('لا تُغلق المعادلة');
    expect(broken).toContain('100.00'); // ‏الإيرادُ المعروض
    expect(broken).toContain('86.25'); // ‏١١٥ − ٢٥ − ٣.٧٥
    expect(broken).toContain('90.00'); // ‏٠ + ١١٨.٧٥ − ٢٥ − ٣.٧٥
    // ‏وبلا مجاميعَ أصلًا: قولٌ صريحٌ لا صفرٌ مُختلَع.
    expect(totalsReconcile(null)).toContain('لم يرجع الخادم مجاميعَ المندوب');
  });

  it('البطاقاتُ الأربع: عنوانٌ يقول ما الرقمُ فعلًا، وأطرافُه تحته', () => {
    const cards = repHeadlineCards(workspace());
    expect(cards.map((card) => card.key)).toEqual([
      'custodyBalance',
      'revenue',
      'collected',
      'custodyState',
    ]);
    const custodyCard = cards[0]!;
    const revenue = cards[1]!;
    const collected = cards[2]!;
    const custodyState = cards[3]!;

    expect(custodyCard.valueText).toBe('25.0000 كجم');
    expect(custodyCard.hintAr).toContain('95.0000');
    expect(custodyCard.hintAr).toContain('كاملٌ بلا نافذة');

    // ‏العنوانُ «صافي المرتجعات» لا «إجمالي» ولا «اليوم» — والسطرُ أطرافُ المعادلة.
    expect(revenue.labelAr).toContain('صافي المرتجعات');
    expect(revenue.valueText).toBe('86.25');
    expect(revenue.hintAr).toContain('نقديّ 0.00');
    expect(revenue.hintAr).toContain('آجل 115.00');
    expect(revenue.hintAr).toContain('− مرتجعات 25.00 وضريبتُها 3.75');

    expect(collected.valueText).toBe('0.00');
    expect(collected.hintAr).toContain('متبقٍّ 86.25');
    expect(collected.hintAr).toContain('بعد خصم 2 إشعارٍ دائن');
    expect(collected.hintAr).toContain('1 بلا تكلفةٍ مُرحّلة');

    expect(custodyState.valueText).toBe('260.0000 كجم');
    expect(custodyState.hintAr).toContain('8 إغلاق بانتظار المحاسب');
    expect(custodyState.hintAr).toContain('25.0000');

    // ‏وبلا مرتجعات لا تُذكر المرتجعات، وبلا مجاميعَ تُعرض شرطةٌ لا صفر.
    const noReturns = repHeadlineCards(
      workspace({
        totals: totals({
          returns: '0.00',
          returnsVat: '0.00',
          returnCount: 0,
          returnsWithoutCostCount: 0,
          revenue: '115.00',
          salesGross: '115.00',
        }),
      }),
    );
    expect(noReturns[1]!.hintAr).not.toContain('مرتجعات');
    const bare = repHeadlineCards(workspace({ totals: undefined, custody: null }));
    expect(bare[1]!.valueText).toBe('—');
    expect(bare[1]!.hintAr).toContain('لم يرجع الخادم مجاميعَ المندوب');
    expect(bare[3]!.valueText).toBe('0.0000 كجم');
    expect(bare[3]!.hintAr).toBe('لا عهدةَ مفتوحة.');
  });

  it('ما يُباع منه وما يُرجَع منه من حقول الخادم، ويبقى الأمر متاحًا بعد أوّل بيع (in_route)', () => {
    const rows = [
      loadOrder({ id: 'a', status: 'loaded', expectedRemainingQty: '50.0000', itemId: 'item-1', itemName: 'خبز' }),
      loadOrder({ id: 'a2', status: 'in_route', expectedRemainingQty: '55.0000', itemId: 'item-1', itemName: 'خبز' }),
      loadOrder({ id: 'b', status: 'loaded', expectedRemainingQty: '0.0000' }),
      loadOrder({ id: 'b2', status: 'in_route', expectedRemainingQty: '0.0000' }),
      loadOrder({ id: 'c', status: 'settled', expectedRemainingQty: '9.0000' }),
      loadOrder({ id: 'd', status: 'pending_receipt', expectedRemainingQty: '10.0000' }),
      loadOrder({ id: 'e', status: 'pending_closing', expectedRemainingQty: '3.0000' }),
    ];
    expect(saleableLoadOrders(rows).map((row) => row.id)).toEqual(['a', 'a2']);

    const docs = [document({ id: 's1', documentKind: 'sale' }), document({ id: 'r1', documentKind: 'return' })];
    expect(returnableDocuments(docs).map((row) => row.id)).toEqual(['s1']);

    // ‏والسقفُ **حدٌّ أعلى** يُعرض تحذيرًا: فحمولةُ المندوب لا تحمل ما أُرجع سابقًا.
    const ceiling = returnCeilingText(document({ soldQty: '10.0000', bonusQty: '1.0000' }));
    expect(ceiling).toContain('11.00 كجم حدٌّ أعلى');
    expect(ceiling).toContain('يخصم الخادمُ ما أُرجع');
  });

  it('نقصُ الاستلام وعجزُ الإقفال قراءتان مختلفتان من حقلَّي الخادم — ولا تُخلطان', () => {
    /**
     * ‏`discrepancyQty` هو `max(0, loaded − received)` كما يكتبه `confirmReceipt`
     * (‏`van-sales.service.ts:3615`) — أي **نقصُ الاستلام**، لا فرقُ الجرد. وخلطُهما كان
     * خطأً في مسوّدة هذا الوجه وصُحِّح قبل البناء: ففرقُ الجرد يُقرأ من `shortageQty`/
     * `shortageValue` بعد الإقفال، وكلاهما من الخادم لا من `expected − actual` في العميل.
     */
    const shortReceipt = receiptShortfallText(
      loadOrder({
        loadedQty: '10.0000',
        receivedQty: '8.0000',
        discrepancyQty: '2.0000',
        stockSettlementStatus: 'pending_transit_decision',
      }),
    );
    expect(shortReceipt).toContain('نقصَ عند الاستلام 2.00 كجم');
    expect(shortReceipt).toContain('10.00');
    expect(shortReceipt).toContain('8.00');
    expect(shortReceipt).toContain('بانتظار المحاسب');
    expect(shortReceipt).toContain('لا يُشطب تلقائيًّا');
    // ‏وبلا نقصٍ لا يُقال شيء.
    expect(receiptShortfallText(loadOrder({ discrepancyQty: '0.0000' }))).toBeNull();
    // ‏ونقصٌ صُفِّيَ يعرض قولَ الخادم كما كتبه.
    expect(
      receiptShortfallText(
        loadOrder({
          loadedQty: '10.0000',
          receivedQty: '9.0000',
          discrepancyQty: '1.0000',
          stockSettlementStatus: 'settled',
          stockSettlementNote: 'اعتُمد الفرقُ على المندوب',
        }),
      ),
    ).toContain('اعتُمد الفرقُ على المندوب');

    const shortage = closingShortageText(
      loadOrder({ shortageQty: '1.5000', shortageValue: '5.7000', approvedAt: null }),
    );
    expect(shortage).toContain('عجزٌ مُعلن 1.50 كجم');
    expect(shortage).toContain('بقيمة 5.70 ريال');
    expect(shortage).toContain('لا يُشطب تلقائيًّا');
    expect(shortage).toContain('مديونيةُ موظّفٍ بتفويضٍ صريحٍ لكلّ حالة');
    // ‏وبعد الاعتماد تُقرأ ملاحظةُ الخادم.
    expect(
      closingShortageText(
        loadOrder({
          shortageQty: '1.5000',
          shortageValue: '5.7000',
          approvedAt: '2026-05-12T06:00:00Z',
          stockSettlementNote: 'سُوّي الفرقُ بمستند جردٍ رسمي',
        }),
      ),
    ).toContain('سُوّي الفرقُ بمستند جردٍ رسمي');
    expect(closingShortageText(loadOrder({ shortageQty: '0.0000' }))).toBeNull();
  });

  it('المفتاحُ يُربط بالجسم **المُرسل فعلًا** — ولا يُبنى لما لا يقبله الخادم', () => {
    /**
     * والجسمُ من `buildDocumentPayload` (باني شاشة المبيعات المقاس) لا من بانٍ خاصٍّ بهذا
     * الوجه: فالمفتاحُ يجب أن يكون بصمةَ ما يُرسل حرفًا، ولو بُني الجسمُ مرّتين لجاز أن
     * يختلفا ويصير المفتاحُ لبضاعةٍ غير المرسلة.
     */
    const payload = buildDocumentPayload({
      ...emptyDocumentDraft(),
      loadOrderId: 'load-1',
      partyId: 'party-1',
      soldQty: '2',
      unitPrice: '10',
      paymentMethod: 'credit',
    });
    const keyed = bodyWithIdempotencyKey('document', payload as unknown as Record<string, unknown>);
    const key = String(keyed.idempotencyKey);
    expect(key.startsWith('rep-document:')).toBe(true);
    expect(key.split(':')[1]).toBe(stableDigest(canonicalPayloadText(payload)));
    expect({ ...keyed, idempotencyKey: undefined }).toEqual({
      ...(payload as unknown as Record<string, unknown>),
      idempotencyKey: undefined,
    });
    // ‏والنيّةُ نفسها مرتين ⇒ بصمةٌ واحدة ورقمُ محاولةٍ مختلف (فلا مستندَ مكرَّر ولا مفتاحٌ
    // ‏واحدٌ لنيّتين).
    const again = String(bodyWithIdempotencyKey('document', payload as unknown as Record<string, unknown>).idempotencyKey);
    expect(again.split(':')[1]).toBe(key.split(':')[1]);
    expect(again).not.toBe(key);

    // ‏ومفتاحٌ مُمرَّرٌ من متتبّع الشاشة يُستعمل كما هو — فالنيّةُ الواحدةُ مفتاحٌ واحد
    // ‏بين نقرتين، وهو المفتاحُ نفسه الذي يُخزَّن مع النيّة في الطابور.
    const tracked = bodyWithIdempotencyKey(
      'document',
      payload as unknown as Record<string, unknown>,
      'rep-document:tracked:nonce1',
    );
    expect(tracked.idempotencyKey).toBe('rep-document:tracked:nonce1');

    // ‏والإقفالُ والاستلامُ لا يُبنى لهما مفتاح: فمساراهما لا يقبلانه ⇒ أمانٌ زائف.
    expect(() => bodyWithIdempotencyKey('closing', {})).toThrow(/لا يقبل مفتاحًا/);
    expect(() => bodyWithIdempotencyKey('receipt', {})).toThrow(/لا يُبنى مفتاحُ عدم تكرار/);
  });

  it('المساراتُ هي الرسمية — من `rep-queue` لا مساراتٌ ثانية', () => {
    expect(actionEndpoint('document')).toBe('/van-sales/documents');
    expect(actionEndpoint('return', 'doc-9')).toBe('/van-sales/documents/doc-9/returns');
    expect(actionEndpoint('collection')).toBe('/van-sales/collections');
    expect(actionEndpoint('closing', 'load-9')).toBe('/van-sales/load-orders/load-9/submit-closing');
    expect(actionEndpoint('receipt', 'load-9')).toBe('/van-sales/load-orders/load-9/confirm-receipt');
  });
});
