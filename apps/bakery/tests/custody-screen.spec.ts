import { describe, expect, it } from 'vitest';

import {
  approvalBlockers,
  approvalDraftFromRow,
  cashPosition,
  chargeEvidence,
  countSettlementAudit,
  custodyLabel,
  emptyClosingDraft,
  mapCustodyRows,
  openCustodies,
  policySummary,
  uncoveredCustodySummary,
  vanCustodyCoverage,
  type CustodyRow,
  type ShortagePolicyRow,
} from '../lib/custody-screen';

function row(overrides: Partial<CustodyRow> = {}): CustodyRow {
  return {
    id: 'lo-1',
    number: 'VLO-0007',
    status: 'pending_closing',
    salesmanId: 'sm-1',
    salesmanName: 'المندوب الأول',
    itemName: 'خبز بلدي',
    loadedQty: '20.00',
    receivedQty: '20.00',
    soldQty: '10.00',
    bonusQty: '1.00',
    returnedQty: '2.00',
    damagedQty: '1.00',
    actualRemainingQty: '6.00',
    expectedRemainingQty: '7.00',
    countVarianceQty: '1.00',
    shortageQty: '1.00',
    shortageValue: '3.80',
    countVarianceCostValue: '3.80',
    stockSettlementStatus: 'not_required',
    shortagePolicyStatus: 'pending_policy_approval',
    ...overrides,
  };
}

const readyReadiness = {
  employeeLinked: true,
  employeeAccountReady: true,
  employeeAccountName: 'المندوب الأول — ذمم عهدة',
  creditAccountMapped: true,
  creditAccountName: 'تسويات المخزون',
  ready: true,
  blockingReason: null,
};

describe('mapCustodyRows — صفوف اللوحة كما هي', () => {
  it('تُستبعد صفوفٌ بلا معرّف: لا إجراءَ على صفٍّ لا يُعرَف', () => {
    const mapped = mapCustodyRows({
      loadOrders: [row(), { number: 'بلا معرّف' } as CustodyRow, null as unknown as CustodyRow],
    });
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.id).toBe('lo-1');
  });

  it('لا لوحة ⇒ لا صفوف (لا اختراع)', () => {
    expect(mapCustodyRows(null)).toEqual([]);
    expect(mapCustodyRows({})).toEqual([]);
    expect(mapCustodyRows({ loadOrders: null })).toEqual([]);
  });
});

describe('openCustodies — ما ينتظر قراراً', () => {
  it('تقديمٌ أو اعتمادٌ أو تسويةٌ معلّقة أو فرقُ عبور', () => {
    const rows = [
      row({ id: 'a', status: 'in_route' }),
      row({ id: 'b', status: 'pending_closing' }),
      row({ id: 'c', status: 'pending_stock_settlement', stockSettlementStatus: 'pending_count_decision' }),
      row({ id: 'd', status: 'loaded', discrepancyQty: '2.00', stockSettlementStatus: 'pending_transit_decision' }),
      row({ id: 'e', status: 'settled', stockSettlementStatus: 'settled_officially' }),
      row({ id: 'f', status: 'canceled' }),
      row({ id: 'g', status: 'draft' }),
    ];
    expect(openCustodies(rows).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('مسودتا الإقفال — لا رقمَ ولا قراراً مُفتراضاً', () => {
  it('مسودة التقديم فارغة: الجرد ما يعدّه المندوب لا ما في الصفّ', () => {
    expect(emptyClosingDraft()).toEqual({
      returnedQty: '',
      damagedQty: '',
      damageReason: '',
      collectedCash: '',
      actualRemainingQty: '',
      closingNotes: '',
    });
  });

  it('مسودة الاعتماد تأخذ الكميات وتُغلق كلّ الأعلام — حتى لو قال الصفّ عكسها', () => {
    const draft = approvalDraftFromRow(
      row({
        salaryDeductionApproved: true,
        damageInspected: true,
        damageReason: 'تلف أثناء النقل',
        collectedCash: '40.00',
        remainingAction: 'carry_over',
      }),
    );
    expect(draft.returnedQty).toBe('2.00');
    expect(draft.damagedQty).toBe('1.00');
    expect(draft.actualRemainingQty).toBe('6.00');
    expect(draft.collectedCash).toBe('40.00');
    expect(draft.remainingAction).toBe('carry_over');
    // القرار الماليّ يُتّخذ الآن صراحةً، لا وراثةً من محاولةٍ سابقة.
    expect(draft.salaryDeductionApproved).toBe(false);
    expect(draft.damageInspected).toBe(false);
    expect(draft.settleStockAdjustment).toBe(false);
    expect(draft.surplusAcknowledged).toBe(false);
    expect(draft.selfApprovalOverride).toBe(false);
    expect(draft.notes).toBe('');
  });

  it('غائبُ الصفّ خانةٌ فارغة لا صفرٌ مكتوب', () => {
    const draft = approvalDraftFromRow(
      row({ returnedQty: null, damagedQty: null, actualRemainingQty: null, collectedCash: null, remainingAction: null }),
    );
    expect(draft.returnedQty).toBe('');
    expect(draft.damagedQty).toBe('');
    expect(draft.actualRemainingQty).toBe('');
    expect(draft.collectedCash).toBe('');
    expect(draft.remainingAction).toBe('');
  });
});

describe('cashPosition — أرقام الخادم لا حسبة المتصفح', () => {
  it('تعرض المحصَّل والمتوقع والفرق كما جاءت', () => {
    expect(cashPosition(row({ collectedCash: '40.00', expectedCash: '46.50', cashVariance: '-6.50' }))).toEqual({
      collected: '40.00',
      expected: '46.50',
      variance: '-6.50',
    });
  });

  it('والغائب «—» لا صفر', () => {
    expect(cashPosition(row({ collectedCash: null, expectedCash: undefined, cashVariance: null }))).toEqual({
      collected: '—',
      expected: '—',
      variance: '—',
    });
  });
});

describe('chargeEvidence — دليلُ ما رُحِّل لا وعدُ السياسة', () => {
  it('بلا قيد ⇒ null (لا رقمَ مُقدَّراً)', () => {
    expect(chargeEvidence(row())).toBeNull();
    expect(chargeEvidence(row({ shortageChargeAmount: '3.8000', shortageJournalEntryId: null }))).toBeNull();
  });

  it('قيدٌ مُرحَّل ⇒ مبلغه وأساسه ومعرّفه', () => {
    const evidence = chargeEvidence(
      row({
        shortageJournalEntryId: 'je-9',
        shortageChargeAmount: '3.8000',
        shortageChargeBasis: 'unit_cost',
        salaryDeductionApproved: true,
      }),
    );
    expect(evidence).toEqual({
      amount: '3.8000',
      basisText: 'التكلفة (قرار السياسة)',
      journalEntryId: 'je-9',
      deductionApproved: true,
    });
  });

  it('اعتمادٌ سابق للشريحة 4: قيدٌ معلومٌ بلا أساسٍ مكتوب ⇒ الأساس «—» لا تخمين', () => {
    const evidence = chargeEvidence(row({ shortageJournalEntryId: 'je-1', shortageChargeBasis: null }));
    expect(evidence?.basisText).toBe('—');
    expect(evidence?.amount).toBe('—');
  });

  it('أساسٌ غير معروف يُعرض خاماً', () => {
    const evidence = chargeEvidence(
      row({ shortageJournalEntryId: 'je-2', shortageChargeBasis: 'some_future_basis' }),
    );
    expect(evidence?.basisText).toBe('some_future_basis');
  });
});

describe('policySummary — الأساس وما يتقدّم عليه', () => {
  it('سياسةٌ مضبوطة بالتكلفة وحسابٌ دائن مربوط', () => {
    const policy: ShortagePolicyRow = {
      shortageValuationBasis: 'unit_cost',
      valuationSource: 'unit_cost',
      configured: true,
      preventSelfApproval: true,
      chargeCreditAccount: { id: 'acc-1', name: 'تسويات المخزون', code: '3121004' },
    };
    expect(policySummary(policy)).toEqual({
      basisText: 'بالتكلفة',
      sourceText: 'بالتكلفة',
      explicitPriceText: '—',
      creditAccountText: 'تسويات المخزون',
      configured: true,
      preventSelfApproval: true,
    });
  });

  it('سعرٌ صريحٌ مكتوب يتقدّم على الأساس — فيُقال ذلك لا الأساس وحده', () => {
    const summary = policySummary({
      shortageValuationBasis: 'unit_cost',
      valuationSource: 'explicit_policy_price',
      shortageUnitPrice: '5.2500',
      configured: true,
    });
    expect(summary.basisText).toBe('بالتكلفة');
    expect(summary.sourceText).toBe('سعرٌ صريح في السياسة');
    expect(summary.explicitPriceText).toBe('5.2500');
  });

  it('بلا سياسة ولا حساب ⇒ «—» و«بلا سياسة» لا تطمين', () => {
    const summary = policySummary(null);
    expect(summary.basisText).toBe('—');
    expect(summary.sourceText).toBe('—');
    expect(summary.creditAccountText).toBe('—');
    expect(summary.configured).toBe(false);
    expect(policySummary({ shortageValuationBasis: 'unconfigured' }).basisText).toContain('بلا سياسة');
  });
});

describe('approvalBlockers — ما يُقال قبل الضغط', () => {
  it('فرقُ مخزونٍ غير مُسوّى مانعٌ يُقال (لا تُغلق عهدةٌ معه)', () => {
    const blockers = approvalBlockers(
      row({ status: 'loaded', stockSettlementStatus: 'pending_transit_decision' }),
      readyReadiness,
      false,
    );
    expect(blockers.some((text) => text.includes('فرق العبور'))).toBe(true);
  });

  it('ملاحظة الخادم أولى من نصّ الشاشة', () => {
    const blockers = approvalBlockers(
      row({
        status: 'pending_stock_settlement',
        stockSettlementStatus: 'pending_count_decision',
        stockSettlementNote: 'فرق الجرد 0.50 كجم (المتوقع 1.00 / الفعلي 0.50)',
      }),
      readyReadiness,
      false,
    );
    expect(blockers).toContain('فرق الجرد 0.50 كجم (المتوقع 1.00 / الفعلي 0.50)');
  });

  it('رفعُ علم التحميل مع ناقصٍ في الحسابين مانعٌ يُقال قبل الرفض', () => {
    const blockers = approvalBlockers(
      row(),
      { ...readyReadiness, employeeAccountReady: false, ready: false, blockingReason: 'لا حساب لهذا الموظف في دليل الحسابات' },
      true,
    );
    expect(blockers).toContain('لا حساب لهذا الموظف في دليل الحسابات');
  });

  it('بلا علمٍ صريح لا مانعَ من جهة الذمّة: لن يُرحَّل شيء أصلاً', () => {
    const blockers = approvalBlockers(
      row(),
      { ...readyReadiness, ready: false, blockingReason: 'لا حساب لهذا الموظف في دليل الحسابات' },
      false,
    );
    expect(blockers).toEqual([]);
  });

  it('صفٌّ مُسوّى وحساباتٌ كاملة ⇒ لا موانع', () => {
    expect(approvalBlockers(row({ shortageQty: '1', shortageValue: '3.80' }), readyReadiness, true)).toEqual([]);
  });
});

describe('custodyLabel — تسميةٌ من حقول الخادم', () => {
  it('الرقم والمندوب والصنف، وبلا تركيبٍ مخترَع', () => {
    expect(custodyLabel(row())).toBe('VLO-0007 · المندوب الأول · خبز بلدي');
    expect(custodyLabel(row({ number: null, salesmanName: null, itemName: null }))).toBe('lo-1');
    expect(custodyLabel({} as CustodyRow)).toBe('—');
  });
});

describe('countSettlementAudit — ما امتصّه مستند الجرد خارج الاعتماد', () => {
  // أرقام القياس الحيّ نفسه (‏`VLO-0005`، 2026-10-15): رصيد السيارة الرسمي 14.00 كجم، والجرد
  // المُعلن 4.50، وفرقُ اعتماد هذا الأمر 1.50 — فمستند الجرد المطلق شطب 9.50، أي أنّ 8.00 كجم
  // (عهدةً مُرحَّلة من `VLO-0004`) خرجت من المخزون ولم تقع في عهدة أحد.
  const settled = row({
    status: 'settled',
    stockSettlementStatus: 'settled_officially',
    actualRemainingQty: '4.50',
    expectedRemainingQty: '6.00',
    countVarianceQty: '1.50',
    countDocumentExpectedQty: '14.00',
    countDocumentVarianceQty: '9.50',
    countDocumentVarianceValue: '9.50',
    stockSettlementNote:
      'سُوِّي رصيد السيارة رسمياً مع الجرد الفعلي (4.50 كجم) بفارق 1.50 كجم عبر مستند الجرد الرسمي — ⚠️ امتصّ مستند الجرد حركةً إضافية بمقدار 8.00 كجم لم تكن ضمن الاعتماد: راجع حركات السيارة في فترة التسوية',
  });

  it('الامتصاص من رقمَي الخادم، لا من تقدير الشاشة', () => {
    const audit = countSettlementAudit(settled);
    expect(audit.posted).toBe(true);
    expect(audit.absorbed).toBe(true);
    expect(audit.absorbedQtyText).toBe('8.00');
    expect(audit.documentExpectedText).toBe('14.00');
    expect(audit.documentVarianceQtyText).toBe('9.50');
    expect(audit.documentVarianceValueText).toBe('9.50');
    expect(audit.approvedVarianceText).toBe('1.50');
    expect(audit.noteText).toContain('امتصّ مستند الجرد حركةً إضافية بمقدار 8.00 كجم');
  });

  it('تطابقُ الفرقين ⇒ لا امتصاص ولا تحذيرَ مُختلَع', () => {
    const audit = countSettlementAudit(
      row({
        countVarianceQty: '2.00',
        countDocumentExpectedQty: '10.00',
        countDocumentVarianceQty: '2.00',
      }),
    );
    expect(audit.posted).toBe(true);
    expect(audit.absorbed).toBe(false);
    expect(audit.absorbedQtyText).toBe('—');
  });

  it('الفائض لا ينقلب امتصاصاً — المقارنة بين المقدارين لا بين الإشارتين', () => {
    const surplus = countSettlementAudit(
      row({
        countVarianceQty: '-2.00',
        countDocumentExpectedQty: '10.00',
        countDocumentVarianceQty: '2.00',
      }),
    );
    expect(surplus.absorbed).toBe(false);
    expect(surplus.absorbedQtyText).toBe('—');
  });

  it('مستندٌ لم يُرحَّل ⇒ لا أرقام ولا ادّعاء', () => {
    const audit = countSettlementAudit(row({ stockSettlementStatus: 'pending_count_decision' }));
    expect(audit.posted).toBe(false);
    expect(audit.absorbed).toBe(false);
    expect(audit.documentExpectedText).toBe('—');
    expect(audit.documentVarianceQtyText).toBe('—');
    expect(audit.documentVarianceValueText).toBe('—');
    expect(audit.noteText).toBeNull();
  });
});

describe('vanCustodyCoverage — تغطية الرصيد الرسمي للعهدة (أرقام منشأة العرض مقاسةً)', () => {
  it('الرصيد أقلّ من عهدةٍ مفتوحة ⇒ نقصٌ بخطورةٍ يُقال قبل الإقفال', () => {
    // VLO-0001 مقاساً: عهدةٌ مفتوحة 18.00 كجم ورصيد السيارة الرسمي 4.50 — امتصّت تسوياتُ أوامرَ
    // أخرى 13.50 كجم من عهدةٍ لم تُقفل بعد (مستند الجرد مطلقٌ يضبط الرصيد كله).
    const coverage = vanCustodyCoverage(
      row({
        status: 'loaded',
        stockSettlementStatus: 'pending_transit_decision',
        expectedRemainingQty: '18.00',
        vanOfficialQty: '4.50',
        otherCustodyInVanQty: '0.00',
        vanStockShortOfCustodyQty: '13.50',
      }),
    );
    expect(coverage.open).toBe(true);
    expect(coverage.tone).toBe('danger');
    expect(coverage.officialText).toBe('4.50');
    expect(coverage.shortOfCustodyText).toBe('13.50');
    expect(coverage.warning).toContain('13.50');
    expect(coverage.warning).toContain('4.50');
    expect(coverage.warning).toContain('18.00');
  });

  it('في السيارة عهدةٌ أخرى ⇒ تحذيرٌ أنّ العدد المُعلن لهذا الأمر وحده', () => {
    // VLO-0005 عند إقفاله: رصيد 28.00 = عهدة هذا الأمر 10.00 + عهدة VLO-0004 المفتوحة 18.00.
    const coverage = vanCustodyCoverage(
      row({
        expectedRemainingQty: '10.00',
        vanOfficialQty: '28.00',
        otherCustodyInVanQty: '18.00',
        vanStockShortOfCustodyQty: '0.00',
      }),
    );
    expect(coverage.open).toBe(true);
    expect(coverage.tone).toBe('warn');
    expect(coverage.otherCustodyText).toBe('18.00');
    expect(coverage.warning).toContain('18.00');
  });

  it('تغطيةٌ سليمة ⇒ لا تحذير ولا ادّعاء', () => {
    const coverage = vanCustodyCoverage(
      row({
        expectedRemainingQty: '10.00',
        vanOfficialQty: '10.00',
        otherCustodyInVanQty: '0.00',
        vanStockShortOfCustodyQty: '0.00',
      }),
    );
    expect(coverage.open).toBe(true);
    expect(coverage.tone).toBeNull();
    expect(coverage.warning).toBeNull();
  });

  it('أمرٌ مُسوّى ⇒ الحقول null من الخادم فلا تقيس الشاشة شيئاً', () => {
    const coverage = vanCustodyCoverage(
      row({ status: 'settled', stockSettlementStatus: 'settled_officially' }),
    );
    expect(coverage.open).toBe(false);
    expect(coverage.officialText).toBe('—');
    expect(coverage.tone).toBeNull();
    expect(coverage.warning).toBeNull();
  });
});

describe('uncoveredCustodySummary — العهدة المفتوحة بلا غطاءٍ رسمي', () => {
  it('يجمع المفتوحة الناقصة ويهمل المُسوّاة والمغطّاة', () => {
    const summary = uncoveredCustodySummary([
      row({ vanOfficialQty: '4.50', vanStockShortOfCustodyQty: '13.50' }),
      row({ vanOfficialQty: '4.50', vanStockShortOfCustodyQty: '2.25' }),
      row({ vanOfficialQty: null, vanStockShortOfCustodyQty: '99.00' }),
      row({ vanOfficialQty: '10.00', vanStockShortOfCustodyQty: '0.00' }),
    ]);
    expect(summary.count).toBe(2);
    expect(summary.shortfallText).toBe('15.75');
  });

  it('لا صفوف ⇒ صفرٌ لا تحذير', () => {
    expect(uncoveredCustodySummary([]).count).toBe(0);
    expect(uncoveredCustodySummary([]).shortfallText).toBe('0.00');
  });
});
