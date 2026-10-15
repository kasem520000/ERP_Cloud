import { describe, expect, it } from 'vitest';

import {
  BALANCE_CARDS,
  cardValue,
  cellText,
  COLLECTION_COLUMNS,
  currentMonthDraft,
  emptyRangeDraft,
  filterHeadline,
  generatedAtText,
  hasPeriodTotals,
  isAnyListTruncated,
  isCalendarDate,
  listedSums,
  PERIOD_CARD_GROUPS,
  PRICE_COLUMNS,
  PRODUCTION_COLUMNS,
  rangeVerdict,
  REP_COLUMNS,
  repHeadline,
  REPORT_DATE_INVALID_CODE,
  REPORT_LIST_KEYS,
  REPORT_RANGE_INVERTED_CODE,
  REPORTS_MESSAGES,
  REPORTS_PERMISSION,
  reportsQuery,
  reportVerdicts,
  summaryValue,
  TRANSFER_COLUMNS,
  truncationNotes,
  type RepCustodyRow,
  type ReportRow,
  type ReportsPayload,
} from '../lib/reports-screen';

/**
 * 📈 منطقُ شاشة تقرير الفترة — والأرقامُ هنا أرقامُ الخادم نفسها التي قيستها
 * `apps/api/test/van-sales-reports-range.spec.ts` لفترة ٢٠٢٦-٠٥-١٠ .. ٢٠٢٦-٠٥-١٥:
 * ٦ أوامر تحميل و٦ مستندات و٤ دفعات و٤ سجلّات تسعير، وإيرادُ الفترة ٦٠٠٫٠٠ وذممُها ٣٦٠٫٠٠
 * وإيرادُ المنشأة كلّها ١٦٠٠٫٠٠. فلو غيّرت الشاشةُ رقمًا أو جمعت فترةً برصيدٍ لسقط الحكم.
 */
function periodPayload(overrides: Partial<ReportsPayload> = {}): ReportsPayload {
  const transfers: ReportRow[] = [
    {
      id: 'a1',
      loadOrderNumber: 'VLO-0010',
      loadDate: '2026-05-11',
      salesmanId: 'rep-a',
      salesmanName: 'المندوب أ',
      productionBatchNo: 'BATCH-0010',
      warehouseId: null,
      vanWarehouseId: null,
      stockTransferId: null,
      returnTransferId: null,
      loadedQty: '10.00',
      soldQty: '4.00',
      bonusQty: '1.00',
      returnedQty: '0.00',
      damagedQty: '0.00',
      shortageQty: '0.00',
      shortageValue: '0.00',
      shortagePolicyStatus: 'pending_policy_approval',
      remainingQty: '0.00',
      status: 'settled',
    },
    {
      id: 'a2',
      loadOrderNumber: 'VLO-0012',
      loadDate: '2026-05-13',
      salesmanId: 'rep-a',
      salesmanName: 'المندوب أ',
      productionBatchNo: 'BATCH-0012',
      warehouseId: null,
      vanWarehouseId: null,
      stockTransferId: null,
      returnTransferId: null,
      loadedQty: '10.00',
      soldQty: '4.00',
      bonusQty: '1.00',
      returnedQty: '0.00',
      damagedQty: '0.00',
      shortageQty: '0.00',
      shortageValue: '0.00',
      shortagePolicyStatus: 'pending_policy_approval',
      remainingQty: '5.00',
      status: 'loaded',
    },
  ];
  const collections: ReportRow[] = [
    {
      documentId: 'd1',
      documentNumber: 'VSD-0009',
      salesInvoiceId: null,
      receiptVoucherId: null,
      docDate: '2026-05-10',
      salesmanName: 'المندوب ب',
      customerName: 'تموينات المدى',
      paymentMethod: 'cash',
      grandTotal: '100.00',
      paidAmount: '40.00',
      outstandingBalance: '60.00',
    },
    {
      documentId: 'd2',
      documentNumber: 'VSD-0012',
      salesInvoiceId: 'inv-12',
      receiptVoucherId: 'rcp-12',
      docDate: '2026-05-13',
      salesmanName: 'المندوب أ',
      customerName: 'تموينات المدى',
      paymentMethod: 'credit',
      grandTotal: '100.00',
      paidAmount: '40.00',
      outstandingBalance: '60.00',
    },
  ];
  const production: ReportRow[] = [
    {
      id: 'b1',
      batchNo: 'BATCH-0009',
      productionDate: '2026-05-10',
      itemId: 'item-1',
      itemName: 'رقائق سمبوسة',
      producedQty: '10.00',
      scrapQty: '1.00',
      issuedQty: '0.00',
      returnedGoodQty: '0.00',
      damagedQty: '0.00',
      availableWarehouseQty: '10.00',
      unitCost: '3.80',
      totalCost: '38.00',
      scrapValue: '3.80',
      costBasis: 'manual_input_or_item_cost',
      status: 'completed',
    },
  ];
  const priceHistory: ReportRow[] = [
    {
      id: 'h1',
      customerPriceId: 'cp-1',
      partyId: 'party-1',
      partyName: 'تموينات المدى',
      itemId: 'item-1',
      itemName: 'رقائق سمبوسة',
      previousUnitPrice: '6.00',
      newUnitPrice: '6.50',
      maxBonusPct: '5.00',
      maxBonusKgPerInvoice: '2.00',
      maxDiscountPct: '3.00',
      lockPrice: true,
      effectiveFrom: '2026-05-01',
      effectiveTo: null,
      changeReason: 'اختبارُ المدى',
      changedByLabel: 'النظام',
      createdAt: '2026-05-10T12:00:00.000Z',
    },
  ];
  const reps: RepCustodyRow[] = [
    {
      salesmanId: 'rep-a',
      salesmanName: 'المندوب أ',
      loadedKg: '30.00',
      soldKg: '12.00',
      bonusKg: '3.00',
      returnedKg: '0.00',
      damagedKg: '0.00',
      shortageKg: '0.00',
      shortageSar: '0.00',
      custodyRemainingKg: '10.00',
      revenueSar: '300.00',
      collectedSar: '120.00',
      creditDebtSar: '180.00',
      netProfitSar: '37.50',
      pendingClosings: 0,
    },
  ];
  return {
    generatedAt: '2026-05-15T06:00:00.000Z',
    filters: { salesmanId: null, fromDate: '2026-05-10', toDate: '2026-05-15' },
    filterNotes: [
      'سجلُّ تسعير العملاء يُصفّى بتاريخ الإنشاء (created_at) لأنه لا يحمل تاريخَ عملٍ آخر؛ وأمّا الأوامر والمستندات والدفعات فتُصفّى بتواريخ عملها (load_date, doc_date, production_date).',
    ],
    rowCap: 2000,
    truncated: {
      transfersReport: false,
      collectionsReport: false,
      productionReport: false,
      customerPriceAuditReport: false,
    },
    policy: { shortageValuationBasis: 'unit_cost' },
    summary: {
      totalRevenueSar: '1600.00',
      totalCreditReceivablesSar: '960.00',
      totalCollectedCashSar: '640.00',
      mainWarehouseBalanceKg: '0.00',
      vanWarehousesBalanceKg: '0.00',
    },
    periodTotals: {
      producedKg: '40.00',
      scrapKg: '4.00',
      productionCostSar: '152.00',
      loadedKg: '60.00',
      soldKg: '24.00',
      bonusKg: '6.00',
      returnedKg: '0.00',
      damagedKg: '0.00',
      shortageKg: '0.00',
      shortageSar: '0.00',
      zatcaSalesSar: '200.00',
      internalSalesSar: '400.00',
      salesGrossSar: '600.00',
      returnsSar: '0.00',
      returnsVatSar: '0.00',
      revenueSar: '600.00',
      collectedCashSar: '240.00',
      creditReceivablesSar: '360.00',
      netProfitSar: '75.00',
      returnsProfitEffectSar: '0.00',
      returnDocumentCount: 0,
      returnsWithoutCostCount: 0,
      anomalyCount: 1,
      loadOrderCount: 6,
      documentCount: 6,
      productionBatchCount: 4,
    },
    repCustodyReport: reps,
    transfersReport: transfers,
    collectionsReport: collections,
    productionReport: production,
    customerPriceAuditReport: priceHistory,
    ...overrides,
  };
}

describe('منطق شاشة تقارير الخطّ', () => {
  it('التاريخُ المقروء: الصيغةُ ثمّ الوجود — والقاعدةُ قاعدةُ الخادم', () => {
    expect(isCalendarDate('2026-05-10')).toBe(true);
    expect(isCalendarDate('2024-02-29')).toBe(true); // ‏سنةٌ كبيسة
    expect(isCalendarDate('2026-02-29')).toBe(false); // ‏ليست كبيسة
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('10/05/2026')).toBe(false);
    expect(isCalendarDate('2026-5-1')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
  });

  it('الفحصُ المسبق للمدى مرآةُ الخادم: النصّ نفسه والرمزُ نفسه', () => {
    // ‏الرمزان اللذان يرفعهما الخادم ٤٢٢ — مثبّتان هنا كي لا يُخترع رمزٌ ثالث في الشاشة.
    expect(REPORT_DATE_INVALID_CODE).toBe('VAN_REPORT_DATE_INVALID');
    expect(REPORT_RANGE_INVERTED_CODE).toBe('VAN_REPORT_RANGE_INVERTED');
    expect(REPORTS_PERMISSION).toBe('van_sales.view');

    const badFormat = rangeVerdict({ fromDate: '10/05/2026', toDate: '', salesmanId: '' });
    expect(badFormat.blocked).toEqual([
      REPORTS_MESSAGES.dateInvalidFormat('بدايةُ الفترة', '10/05/2026'),
    ]);
    expect(badFormat.blocked[0]).toContain('YYYY-MM-DD');

    const notReal = rangeVerdict({ fromDate: '', toDate: '2026-02-30', salesmanId: '' });
    expect(notReal.blocked).toEqual([REPORTS_MESSAGES.dateNotReal('نهايةُ الفترة', '2026-02-30')]);

    const inverted = rangeVerdict({ fromDate: '2026-05-15', toDate: '2026-05-10', salesmanId: '' });
    expect(inverted.blocked).toEqual([REPORTS_MESSAGES.rangeInverted('2026-05-15', '2026-05-10')]);
    expect(inverted.blocked[0]).toContain('بعد نهايتها');
    expect(inverted.blocked[0]).toContain('والتصحيحُ في التاريخ لا في التقرير');

    // ‏تاريخان فاسدان ⇒ حكمان، لا يُبتلع الثاني.
    const both = rangeVerdict({ fromDate: '2026-02-30', toDate: 'x', salesmanId: '' });
    expect(both.blocked).toHaveLength(2);

    // ‏ومدىً صالحٌ لا يُحظر ولا يُحذَّر.
    const good = rangeVerdict({ fromDate: '2026-05-10', toDate: '2026-05-15', salesmanId: 'rep-a' });
    expect(good).toEqual({ blocked: [], warnings: [] });

    // ‏وبلا مدىً يُقال إنّ التقرير كلّ السجلّ — لا «اليوم».
    const open = rangeVerdict(emptyRangeDraft());
    expect(open.blocked).toEqual([]);
    expect(open.warnings.join(' ')).toContain('بلا مدىً زمنيّ');
    expect(open.warnings.join(' ')).toContain('كلّ السجلّ لا «اليوم»');

    const fromOnly = rangeVerdict({ fromDate: '2026-05-10', toDate: '', salesmanId: '' });
    expect(fromOnly.warnings.join(' ')).toContain('مدىً مفتوحُ النهاية');
    const toOnly = rangeVerdict({ fromDate: '', toDate: '2026-05-15', salesmanId: '' });
    expect(toOnly.warnings.join(' ')).toContain('مدىً مفتوحُ البداية');
    expect(toOnly.warnings.join(' ')).toContain('حتى 2026-05-15');
  });

  it('نصُّ الاستعلام: الفارغُ لا يُرسل، والمسافاتُ تُقصّ', () => {
    expect(reportsQuery(emptyRangeDraft())).toBe('');
    expect(
      reportsQuery({ fromDate: ' 2026-05-10 ', toDate: '2026-05-15', salesmanId: ' rep-a ' }),
    ).toBe('?fromDate=2026-05-10&toDate=2026-05-15&salesmanId=rep-a');
    expect(reportsQuery({ fromDate: '', toDate: '2026-05-15', salesmanId: '' })).toBe(
      '?toDate=2026-05-15',
    );
    expect(reportsQuery({ fromDate: '2026-05-10', toDate: '', salesmanId: '' })).toBe(
      '?fromDate=2026-05-10',
    );
  });

  it('«هذا الشهر» أولُه وآخرُه بتقويم المتصفح — ومنها فبراير الكبيسة', () => {
    expect(currentMonthDraft(new Date(2026, 4, 17))).toEqual({
      fromDate: '2026-05-01',
      toDate: '2026-05-31',
      salesmanId: '',
    });
    expect(currentMonthDraft(new Date(2028, 1, 5)).toDate).toBe('2028-02-29');
    expect(currentMonthDraft(new Date(2026, 1, 5)).toDate).toBe('2026-02-28');
    expect(currentMonthDraft(new Date(2026, 11, 31)).toDate).toBe('2026-12-31');
  });

  it('عنوانُ المدى من `filters` الخادم لا من حقول المستخدم', () => {
    expect(filterHeadline(null)).toBe('لم يرجع الخادم ما طُبِّق من المرشِّحات.');
    expect(filterHeadline(periodPayload())).toBe('من 2026-05-10 إلى 2026-05-15 · كلّ المناديب');
    expect(
      filterHeadline(periodPayload({ filters: { salesmanId: 'rep-a', fromDate: '2026-05-10', toDate: '2026-05-15' } })),
    ).toBe('من 2026-05-10 إلى 2026-05-15 · مندوبٌ واحد');
    expect(filterHeadline(periodPayload({ filters: { salesmanId: null, fromDate: '2026-05-10', toDate: null } }))).toBe(
      'من 2026-05-10 حتى آخر سجلّ · كلّ المناديب',
    );
    expect(filterHeadline(periodPayload({ filters: { salesmanId: null, fromDate: null, toDate: '2026-05-15' } }))).toBe(
      'من أول سجلّ حتى 2026-05-15 · كلّ المناديب',
    );
    expect(filterHeadline(periodPayload({ filters: { salesmanId: null, fromDate: null, toDate: null } }))).toBe(
      'كلّ السجلّ (بلا مدىً زمنيّ) · كلّ المناديب',
    );
  });

  it('بطاقاتُ الفترة من periodTotals وحده، والغائب «—» لا صفرٌ مُختلَع', () => {
    const payload = periodPayload();
    expect(cardValue(payload, 'revenueSar')).toBe('600.00');
    expect(cardValue(payload, 'zatcaSalesSar')).toBe('200.00');
    expect(cardValue(payload, 'internalSalesSar')).toBe('400.00');
    expect(cardValue(payload, 'collectedCashSar')).toBe('240.00');
    expect(cardValue(payload, 'creditReceivablesSar')).toBe('360.00');
    expect(cardValue(payload, 'netProfitSar')).toBe('75.00');
    expect(cardValue(payload, 'producedKg')).toBe('40.00');
    expect(cardValue(payload, 'loadOrderCount')).toBe('6');
    expect(cardValue(payload, 'anomalyCount')).toBe('1');
    // ‏مفتاحٌ لم يرجعه الخادم ⇒ شرطة، لا صفر ولا اختراع.
    expect(cardValue(payload, 'notReturnedByServer')).toBe('—');
    expect(cardValue(null, 'revenueSar')).toBe('—');
    expect(hasPeriodTotals(payload)).toBe(true);
    expect(hasPeriodTotals(periodPayload({ periodTotals: {} }))).toBe(false);
    expect(hasPeriodTotals(null)).toBe(false);

    // ‏وكلّ بطاقةٍ معلنة لها قيمةٌ في حمولة الخادم — فلا بطاقةَ تعرض «—» أبدًا.
    for (const group of PERIOD_CARD_GROUPS) {
      for (const card of group.cards) {
        expect(cardValue(payload, card.key), `${group.key}/${card.key}`).not.toBe('—');
      }
    }

    /**
     * وفترةٌ فيها مرتجعات — والأرقامُ هي المقاسةُ من الخادم في
     * `apps/api/test/van-sales-returns-in-reports.spec.ts` (بيعٌ ١١٥.٠٠ ومرتجعان ٢٠.٠٠ + ٣.٠٠
     * و٥.٠٠ + ٠.٧٥ ضريبتهما، وأثرُ المرتجع في الربح ١٢.٠٠ بتكلفة إشعاره الدائن ٨.٠٠):
     * فالشاشةُ تعرض الأطرافَ لا رقمًا صافيًا ابتلعها.
     */
    const withReturns = periodPayload({
      periodTotals: {
        salesGrossSar: '115.00',
        returnsSar: '25.00',
        returnsVatSar: '3.75',
        revenueSar: '86.25',
        zatcaSalesSar: '86.25',
        internalSalesSar: '0.00',
        collectedCashSar: '0.00',
        creditReceivablesSar: '86.25',
        netProfitSar: '48.00',
        returnsProfitEffectSar: '12.00',
        returnDocumentCount: 2,
        returnsWithoutCostCount: 1,
        documentCount: 3,
      },
    });
    expect(cardValue(withReturns, 'salesGrossSar')).toBe('115.00');
    expect(cardValue(withReturns, 'returnsSar')).toBe('25.00');
    expect(cardValue(withReturns, 'returnsVatSar')).toBe('3.75');
    expect(cardValue(withReturns, 'revenueSar')).toBe('86.25');
    expect(cardValue(withReturns, 'returnsProfitEffectSar')).toBe('12.00');
    expect(cardValue(withReturns, 'netProfitSar')).toBe('48.00');
    expect(cardValue(withReturns, 'returnDocumentCount')).toBe('2');
    expect(cardValue(withReturns, 'returnsWithoutCostCount')).toBe('1');
    // ‏والمعادلةُ تُغلق على أرقام الخادم نفسه: إجماليٌّ − مرتجعاتٌ − ضريبتُها = صافٍ.
    const gross = Number(cardValue(withReturns, 'salesGrossSar'));
    const returns = Number(cardValue(withReturns, 'returnsSar'));
    const returnsVat = Number(cardValue(withReturns, 'returnsVatSar'));
    expect((gross - returns - returnsVat).toFixed(2)).toBe(cardValue(withReturns, 'revenueSar'));

    /**
     * ‏**وفي الاتّجاه المعاكس:** كلّ رقمٍ يرجعه الخادم في `periodTotals` له بطاقة. فالحلقةُ
     * أعلاه تمنع بطاقةً تعرض «—»، وهذه تمنع الخادمَ أن يزيد رقمًا (كـ`returnsSar` يوم أُضيف)
     * فتبتلعه الشاشةُ بالصمت — وهو الوجه الآخر لقاعدة «لا يختفي شيء». والمثبّتُ هنا على
     * شكل حمولة الخادم الكاملة (٢٦ مفتاحًا)، فلو أُضيف مفتاحٌ في الردّ وسُكِت عنه في
     * البطاقات لسقط هذا الحكم.
     */
    const declared = new Set(
      PERIOD_CARD_GROUPS.flatMap((group) => group.cards.map((card) => card.key)),
    );
    const undeclared = Object.keys(payload.periodTotals ?? {}).filter(
      (key) => !declared.has(key),
    );
    expect(undeclared, `أرقامٌ من الخادم بلا بطاقة: ${undeclared.join(', ')}`).toEqual([]);
    // ‏بطاقاتُ summary كذلك، وبمفاتيح اللوحة لا مفاتيح الفترة.
    expect(summaryValue(payload, 'totalRevenueSar')).toBe('1600.00');
    expect(summaryValue(payload, 'mainWarehouseBalanceKg')).toBe('0.00');
    expect(summaryValue(payload, 'creditReceivablesSar')).toBe('—'); // ‏مفتاحُ فترةٍ لا يوجد في summary
    for (const card of BALANCE_CARDS) {
      expect(summaryValue(payload, card.key), card.key).not.toBe('—');
      // ‏وكلّ بطاقةِ رصيدٍ تقول إنّها ليست تدفّقَ الفترة — فالعنوانُ وحده لا يمنع الخلط.
      expect((card.hintAr ?? '').length, card.key).toBeGreaterThan(10);
    }
  });

  it('الفترةُ ليست كلّ السجلّ، والأرصدةُ ليست أيًّا منهما — وتُقال الجملة صريحة', () => {
    const payload = periodPayload();
    const note = reportVerdicts(payload).warnings.join(' ');
    expect(note).toContain('600.00');
    expect(note).toContain('1600.00');
    expect(note).toContain('وليسا رقمين لشيءٍ واحد');
    expect(note).toContain('أرصدةُ اللحظة ليست أيًّا منهما');

    // ‏وحين يتطابقان (بلا تصفية) يُقال ذلك بدل إنذارٍ كاذب.
    const same = periodPayload({ summary: { totalRevenueSar: '600.00' } });
    const sameNote = reportVerdicts(same).warnings.join(' ');
    expect(sameNote).toContain('إيرادُ الفترة = إيرادُ المنشأة كلّها');
    expect(sameNote).not.toContain('وليسا رقمين لشيءٍ واحد');
  });

  it('مجاميعُ الصفوف المعروضة جمعُ المتصفح للصفوف نفسها — وتُقابل مجموعَ الفترة', () => {
    const sums = listedSums(periodPayload());
    // ‏صفّا مستندات: ‏١٠٠ + ١٠٠ و٦٠ + ٦٠؛ وأمران: ‏١٠ + ١٠ محمَّل و٠ + ٥ متبقٍّ؛ ودفعةٌ واحدة ١٠ كجم.
    expect(sums).toEqual({
      collectionsOutstandingSar: '120.00',
      collectionsGrandSar: '200.00',
      transfersLoadedKg: '20.00',
      transfersRemainingKg: '5.00',
      productionProducedKg: '10.00',
    });
    expect(listedSums(null)).toEqual({
      collectionsOutstandingSar: '0.00',
      collectionsGrandSar: '0.00',
      transfersLoadedKg: '0.00',
      transfersRemainingKg: '0.00',
      productionProducedKg: '0.00',
    });
    // ‏قيمةٌ لا تُقرأ لا تُسقِط الشاشة ولا تُختلق صفرًا في مكانٍ آخر.
    const broken = listedSums(
      periodPayload({ collectionsReport: [{ grandTotal: 'abc', outstandingBalance: null }] }),
    );
    expect(broken.collectionsGrandSar).toBe('0.00');
    expect(broken.collectionsOutstandingSar).toBe('0.00');
  });

  it('القصُّ يُقال: سقفُ الخادم والعدُّ في الجدول بجانب المعروض', () => {
    expect(truncationNotes(periodPayload())).toEqual([]);
    expect(isAnyListTruncated(periodPayload())).toBe(false);

    const capped = periodPayload({
      collectionsReport: Array.from({ length: 3 }, (_, index) => ({
        documentId: `d${index}`,
        grandTotal: '100.00',
        paidAmount: '40.00',
        outstandingBalance: '60.00',
      })),
      truncated: {
        transfersReport: false,
        collectionsReport: true,
        productionReport: false,
        customerPriceAuditReport: false,
      },
      periodTotals: { documentCount: 2001, revenueSar: '200100.00' },
    });
    const notes = truncationNotes(capped);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('مستندات البيع والتحصيل');
    expect(notes[0]).toContain('عُرض 3 صفًّا');
    expect(notes[0]).toContain('سقفُ الخادم 2000');
    expect(notes[0]).toContain('والعدُّ في الجدول 2001');
    expect(notes[0]).toContain('فالقصُّ في المعروض لا في المحسوب');
    expect(isAnyListTruncated(capped)).toBe(true);
    // ‏والتنبيهُ يظهر في تحذيرات الشاشة أيضًا، لا في دالّةٍ لا يقرؤها أحد.
    expect(reportVerdicts(capped).warnings.join(' ')).toContain('فالقصُّ في المعروض لا في المحسوب');

    // ‏وإن لم يقل الخادم سقفَه أو عدَّه قيل ذلك، ولم يُفترض رقم.
    const mute = periodPayload({
      rowCap: null,
      truncated: {
        transfersReport: true,
        collectionsReport: false,
        productionReport: false,
        customerPriceAuditReport: false,
      },
      periodTotals: {},
    });
    const muteNotes = truncationNotes(mute);
    expect(muteNotes).toHaveLength(1);
    expect(muteNotes[0]).toContain('سقفُ الخادم غير مُعاد');
    expect(muteNotes[0]).toContain('والعدُّ في الجدول غير مُعاد');
  });

  it('الخليةُ كما رجعت: منطقيٌّ نعم/لا، وفارغٌ شرطة، وكائنٌ لا يُعرض', () => {
    expect(cellText({ lockPrice: true }, { key: 'lockPrice', labelAr: 'تثبيت السعر' })).toBe('نعم');
    expect(cellText({ lockPrice: false }, { key: 'lockPrice', labelAr: 'تثبيت السعر' })).toBe('لا');
    expect(cellText({ salesInvoiceId: null }, { key: 'salesInvoiceId', labelAr: 'الفاتورة' })).toBe('—');
    expect(cellText({ salesInvoiceId: '' }, { key: 'salesInvoiceId', labelAr: 'الفاتورة' })).toBe('—');
    expect(cellText(null, { key: 'salesInvoiceId', labelAr: 'الفاتورة' })).toBe('—');
    expect(cellText({ pendingClosings: 0 }, { key: 'pendingClosings', labelAr: 'عدد', numeric: true })).toBe('0');
    expect(cellText({ grandTotal: '100.00' }, { key: 'grandTotal', labelAr: 'الإجمالي', numeric: true })).toBe('100.00');
    expect(cellText({ status: 'loaded' }, { key: 'status', labelAr: 'الحالة' })).toBe('loaded');
    // ‏حمولةٌ فيها كائنٌ بدل قيمة (لا يفعله الخادم) لا تُعرض «[object Object]» ولا تُسقِط الشاشة.
    expect(
      cellText({ weird: { nested: true } } as unknown as ReportRow, { key: 'weird', labelAr: 'كائن' }),
    ).toBe('—');
  });

  it('أعمدةُ الجداول تغطّي حقولَ الخادم فعلًا — فلا عمودَ يعرض «—» إلى الأبد', () => {
    const payload = periodPayload();
    const cases: Array<{ columns: readonly { key: string }[]; rows: readonly object[]; label: string }> = [
      { columns: TRANSFER_COLUMNS, rows: payload.transfersReport ?? [], label: 'transfers' },
      { columns: COLLECTION_COLUMNS, rows: payload.collectionsReport ?? [], label: 'collections' },
      { columns: PRODUCTION_COLUMNS, rows: payload.productionReport ?? [], label: 'production' },
      { columns: PRICE_COLUMNS, rows: payload.customerPriceAuditReport ?? [], label: 'price' },
      { columns: REP_COLUMNS, rows: payload.repCustodyReport ?? [], label: 'reps' },
    ];
    for (const table of cases) {
      expect(table.rows.length, table.label).toBeGreaterThan(0);
      const keys = table.columns.map((column) => column.key);
      expect(new Set(keys).size, `${table.label}: عمودٌ مكرّر`).toBe(keys.length);
      for (const row of table.rows) {
        for (const column of table.columns) {
          const value = (row as Record<string, unknown>)[column.key];
          // ‏الفراغُ المسموح هو `null` صريحٌ من الخادم (مُعرِّفاتٌ اختيارية) — أمّا مفتاحٌ غير
          // موجودٍ فمعناه عمودٌ مكتوبٌ بخطأ، وكان سيعرض «—» إلى الأبد بلا خطأ.
          expect(
            Object.prototype.hasOwnProperty.call(row, column.key),
            `${table.label}/${column.key}: مفتاحٌ ليس في حمولة الخادم`,
          ).toBe(true);
          if (value === null) continue;
          expect(
            cellText(row as ReportRow, column as (typeof TRANSFER_COLUMNS)[number]),
            `${table.label}/${column.key}`,
          ).not.toBe('—');
        }
      }
    }
    // ‏والقوائمُ الأربع هي مفاتيحُ `truncated` نفسها عند الخادم.
    expect(REPORT_LIST_KEYS).toEqual([
      'transfersReport',
      'collectionsReport',
      'productionReport',
      'customerPriceAuditReport',
    ]);
  });

  it('تحذيراتُ الشاشة: نصُّ الخادم كما هو، ولا حظرَ على قراءة', () => {
    const verdict = reportVerdicts(periodPayload());
    expect(verdict.blocked).toEqual([]);
    // ‏filterNotes الخادم تُعرض كما رجعت — ومنها أنّ التسعير يُصفّى بتاريخ الإنشاء.
    expect(verdict.warnings.join(' ')).toContain('يُصفّى بتاريخ الإنشاء (created_at)');
    expect(verdict.warnings.join(' ')).toContain('load_date, doc_date, production_date');
    // ‏شذوذُ البونص واحدٌ في الفترة، وذممُها ٣٦٠٫٠٠.
    expect(verdict.warnings.join(' ')).toContain('1 مستندًا في الفترة عَلَمُ شذوذِ البونص');
    expect(verdict.warnings.join(' ')).toContain('ذممُ الفترة 360.00 ريال لم تُحصّل');
    expect(verdict.warnings.join(' ')).toContain('التحصيلُ في شاشة التحصيل بسندٍ رسمي');

    // ‏وبلا شذوذٍ ولا ذممٍ ولا نقص لا إنذار — فالإنذارُ الدائم يُفقد الإنذارَ معناه.
    const quiet = reportVerdicts(
      periodPayload({
        filterNotes: [],
        periodTotals: { anomalyCount: 0, creditReceivablesSar: '0.00', shortageSar: '0.00' },
        summary: { totalRevenueSar: '600.00' },
      }),
    );
    expect(quiet.blocked).toEqual([]);
    expect(quiet.warnings.join(' ')).not.toContain('شذوذ');
    expect(quiet.warnings.join(' ')).not.toContain('لم تُحصّل');

    // ‏ونقصٌ مُحمَّلٌ في الفترة يُقال معه شرطُ الاعتماد — ولا يُنشئ التقريرُ قيدًا.
    const shortage = reportVerdicts(
      periodPayload({ periodTotals: { shortageSar: '240.00', anomalyCount: 0 } }),
    );
    expect(shortage.warnings.join(' ')).toContain('قيمةُ النقص في الفترة 240.00 ريال');
    expect(shortage.warnings.join(' ')).toContain('salaryDeductionApproved');
    expect(shortage.warnings.join(' ')).toContain('والتقريرُ لا يُنشئ قيدًا ولا يُحمِّل أحدًا');

    // ‏وحمولةٌ فارغة لا تُسقِط الشاشة ولا تخترع أرقامًا.
    expect(reportVerdicts(null)).toEqual({ blocked: [], warnings: [] });
  });

  it('سطرُ المندوب ووقتُ التوليد من حمولة الخادم', () => {
    expect(repHeadline({ salesmanName: 'المندوب أ', custodyRemainingKg: '10.00', creditDebtSar: '180.00' })).toBe(
      'المندوب أ — المتبقي في عهدته 10.00 كجم وذمّتُه 180.00 ريال',
    );
    expect(repHeadline({ custodyRemainingKg: '5.00' })).toBe(
      'مندوبٌ بلا اسم — المتبقي في عهدته 5.00 كجم',
    );
    expect(repHeadline({ salesmanName: 'المندوب ب', custodyRemainingKg: null })).toContain('—');

    expect(generatedAtText(periodPayload())).toContain('2026');
    expect(generatedAtText(periodPayload({ generatedAt: null }))).toBeNull();
    expect(generatedAtText(periodPayload({ generatedAt: '' }))).toBeNull();
    expect(generatedAtText(null)).toBeNull();
    // ‏وطابعٌ لا يُقرأ يُعرض كما وصل، لا يُخفى ولا يُحوَّل إلى «الآن».
    expect(generatedAtText(periodPayload({ generatedAt: 'not-a-stamp' }))).toBe('not-a-stamp');
  });
});
