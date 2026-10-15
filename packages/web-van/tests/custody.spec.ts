import { describe, expect, it } from 'vitest';

import {
  APPROVAL_MESSAGES,
  buildApprovalPayload,
  buildClosingPayload,
  canApproveClosing,
  canCloseTransitDifference,
  canSettleStock,
  canSubmitClosing,
  CHARGE_BASES,
  CHARGE_BASIS_LABELS,
  chargeBasisLabel,
  chargePreview,
  CLOSING_MESSAGES,
  custodyBasis,
  fourWaySeparation,
  remainingActionLabel,
  SHORTAGE_POLICY_STATUS_LABELS,
  shortagePolicyStatusLabel,
  unsettledStockReason,
  VALUATION_BASIS_LABELS,
  vehicleCountShare,
  valuationBasisLabel,
  type ApprovalDraft,
  type ClosingDraft,
  type CustodyQuantities,
} from '../src/custody';

/** عهدة: حُمِّل 20، استُلم 20، بيع 10 وبونص 1 ⇒ المتوقع 9. */
function quantities(overrides: Partial<CustodyQuantities> = {}): CustodyQuantities {
  return { loadedQty: '20', receivedQty: '20', soldQty: '10', bonusQty: '1', ...overrides };
}

function closing(overrides: Partial<ClosingDraft> = {}): ClosingDraft {
  return {
    returnedQty: '2',
    damagedQty: '1',
    damageReason: 'تلف أثناء النقل',
    collectedCash: '40',
    actualRemainingQty: '6',
    closingNotes: 'جرد نهاية الوردية',
    ...overrides,
  };
}

function approval(overrides: Partial<ApprovalDraft> = {}): ApprovalDraft {
  return {
    ...closing(),
    damageInspected: true,
    salaryDeductionApproved: false,
    remainingAction: 'carry_over',
    settleStockAdjustment: false,
    surplusAcknowledged: false,
    selfApprovalOverride: false,
    notes: '',
    ...overrides,
  };
}

describe('custodyBasis — أساس العهدة قاعدة الخادم نفسها', () => {
  it('يستعمل المستلَم فعلاً حين يكون موجباً، وإلا المحمَّل', () => {
    expect(custodyBasis(quantities()).toFixed(2)).toBe('20.00');
    // استلامٌ ناقص: العهدة 18 لا 20 (والفرق فرقُ عبورٍ له قراره المستقل).
    expect(custodyBasis(quantities({ receivedQty: '18' })).toFixed(2)).toBe('18.00');
    expect(custodyBasis(quantities({ receivedQty: '0' })).toFixed(2)).toBe('20.00');
    expect(custodyBasis(quantities({ receivedQty: null })).toFixed(2)).toBe('20.00');
  });
});

describe('buildClosingPayload — تقديم الجرد', () => {
  it('يرفض النصّ غير الرقمي: الخادم يقرأه صفراً بصمت فتُغلق العهدة على رقمٍ لم يُكتب', () => {
    for (const actualRemainingQty of ['abc', '٦', '1,5', '-3']) {
      const verdict = buildClosingPayload(closing({ actualRemainingQty }), quantities());
      expect(verdict.ok, `actualRemainingQty=${JSON.stringify(actualRemainingQty)}`).toBe(false);
      if (!verdict.ok) {
        expect(verdict.field).toBe('actualRemainingQty');
        expect(verdict.message).toContain('يجب أن تكون رقمًا موجبًا أو صفرًا');
      }
    }
    const returned = buildClosingPayload(closing({ returnedQty: '2k' }), quantities());
    expect(returned.ok).toBe(false);
    if (!returned.ok) expect(returned.field).toBe('returnedQty');
  });

  it('يقبل الصفر صراحةً — فـ«لم يرتجع شيئاً» قرارٌ لا فراغ', () => {
    const verdict = buildClosingPayload(
      closing({ returnedQty: '0', damagedQty: '0', damageReason: '' }),
      quantities(),
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.payload.returnedQty).toBe('0.0000');
      expect(verdict.payload.damagedQty).toBe('0.0000');
    }
  });

  it('يرفض تلفاً بلا سبب بنصّ الخادم حرفاً', () => {
    const verdict = buildClosingPayload(closing({ damageReason: '   ' }), quantities());
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toBe(CLOSING_MESSAGES.damageReasonRequired);
      expect(verdict.message).toBe(
        'عند تسجيل كمية تالفة يجب كتابة سبب التلف بوضوح لإحالته للفحص الفعلي من المحاسب وأمين المستودع',
      );
      expect(verdict.field).toBe('damageReason');
    }
  });

  it('يرفض مجموعاً يتجاوز العهدة بالقالب الذي يحشو الخادم أرقامه', () => {
    // ‏10 + 1 + 2 + 1 + 8 = 22 > 20
    const verdict = buildClosingPayload(closing({ actualRemainingQty: '8' }), quantities());
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toBe(
        'مجموع الكميات (المباع 10.00 + البونص 1.00 + المرتجع السليم 2.00 + التالف 1.00 + المتبقي الفعلي 8.00 = 22.00 كجم) يتجاوز العهدة المستلمة أصلاً (20.00 كجم). إن كانت الكمية الزائدة موجودة فعلاً في السيارة فأبلغ المحاسب: تسجيل الفائض يتم عند الاعتماد بإقرار صريح، لا من حساب المندوب.',
      );
      expect(verdict.field).toBe('actualRemainingQty');
    }
  });

  it('لا يرسل ما لم تملأه الشاشة — فلا يُخترع رقمٌ في المتصفح', () => {
    const verdict = buildClosingPayload(
      closing({ collectedCash: '', actualRemainingQty: '', closingNotes: '', damageReason: '' , damagedQty: '0'}),
      quantities(),
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.payload.collectedCash).toBeUndefined();
      expect(verdict.payload.actualRemainingQty).toBeUndefined();
      expect(verdict.payload.closingNotes).toBeUndefined();
      expect(verdict.payload.damageReason).toBeUndefined();
    }
  });
});

describe('buildApprovalPayload — اعتماد الإقفال', () => {
  it('يرفض تلفاً بلا فحص فعلي بنصّ الخادم حرفاً', () => {
    const verdict = buildApprovalPayload(approval({ damageInspected: false }), quantities());
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toBe(APPROVAL_MESSAGES.damageInspectionRequired);
      expect(verdict.field).toBe('damageInspected');
    }
  });

  it('لا يطلب فحصاً حين لا تلف', () => {
    const verdict = buildApprovalPayload(
      approval({ damagedQty: '0', damageReason: '', damageInspected: false }),
      quantities(),
    );
    expect(verdict.ok).toBe(true);
  });

  it('يرفض فائض الجرد بلا إقرار، ويقبله بإقرارٍ صريح', () => {
    // ‏10 + 1 + 2 + 1 + 12 = 26 > 20 ⇒ فائض 6
    const refused = buildApprovalPayload(approval({ actualRemainingQty: '12' }), quantities());
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.field).toBe('surplusAcknowledged');
      expect(refused.message).toBe(
        'الجرد الفعلي (12.00 كجم) أكبر من المتبقي حسب المستندات (6.00 كجم) بفائض 6.00 كجم — أكد الإقرار بالفائض (surplusAcknowledged) ليُسجَّل في مستند الجرد الرسمي',
      );
    }
    const accepted = buildApprovalPayload(
      approval({ actualRemainingQty: '12', surplusAcknowledged: true }),
      quantities(),
    );
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.payload.surplusAcknowledged).toBe(true);
  });

  it('يرفض متبقياً فعلياً بلا مصير، والنصّ يحمل الخيارين كما يكتبهما الخادم', () => {
    const verdict = buildApprovalPayload(approval({ remainingAction: '' }), quantities());
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.field).toBe('remainingAction');
      expect(verdict.message).toBe(
        'يوجد متبقٍ فعلي بالجرد (6.00 كجم) في سيارة المندوب: حدّد مصيره صراحةً — ' +
          '`return_to_main` لإرجاعه رسمياً إلى المستودع الرئيسي، أو `carry_over` لإبقائه عهدةً للوردية التالية. ' +
          'لا تُغلق العهدة مع بقاء كمية بلا قرار.',
      );
    }
  });

  it('يمرّر قرار التحميل كما اختاره المحاسب — لا يُستنتج ولا يُفترض', () => {
    const off = buildApprovalPayload(approval({ salaryDeductionApproved: false }), quantities());
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.payload.salaryDeductionApproved).toBe(false);

    const on = buildApprovalPayload(approval({ salaryDeductionApproved: true }), quantities());
    expect(on.ok).toBe(true);
    if (on.ok) {
      expect(on.payload.salaryDeductionApproved).toBe(true);
      expect(on.payload.damageInspected).toBe(true);
    }
  });

  it('جسم الاعتماد غير جسم التقديم: لا سبب تلف ولا ملاحظات إقفال فيه', () => {
    const verdict = buildApprovalPayload(approval(), quantities());
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(Object.keys(verdict.payload)).not.toContain('damageReason');
      expect(Object.keys(verdict.payload)).not.toContain('closingNotes');
      expect(verdict.payload.remainingAction).toBe('carry_over');
    }
  });

  it('يرثّ رفض الرقم التالف، لكن تجاوز العهدة عنده إقرارُ فائض لا رفضٌ موروث', () => {
    const numeric = buildApprovalPayload(approval({ returnedQty: 'abc' }), quantities());
    expect(numeric.ok).toBe(false);
    if (!numeric.ok) expect(numeric.field).toBe('returnedQty');

    // ‏10 + 1 + 2 + 1 + 8 = 22 > 20: عند التقديم رفضٌ (خطأ إدخال)، وعند الاعتماد فائضٌ
    // يُسجَّل بإقرارٍ صريح — فالخادم يقبله هناك ويرفضه هنا، والشاشة مرآته لا أشدّ منه.
    const surplus = buildApprovalPayload(approval({ actualRemainingQty: '8' }), quantities());
    expect(surplus.ok).toBe(false);
    if (!surplus.ok) expect(surplus.field).toBe('surplusAcknowledged');
  });
});

describe('fourWaySeparation — الفصل الرباعي لا يُدمج', () => {
  it('أربعة أرقامٍ منفصلة: مرتجعٌ سليم، تالف، عجز، متبقٍ فعلي', () => {
    const split = fourWaySeparation({
      soldQty: '10',
      bonusQty: '1',
      returnedQty: '2',
      damagedQty: '1',
      shortageQty: '2.5',
      actualRemainingQty: '3.5',
      expectedRemainingQty: '6',
      countVarianceQty: '2.5',
    });
    expect(split.returned).toBe('2.00');
    expect(split.damaged).toBe('1.00');
    expect(split.shortage).toBe('2.50');
    expect(split.actualRemaining).toBe('3.50');
    expect(split.surplus).toBe('0.00'); // ‏فرقٌ موجب = عجز، لا فائض
    expect(split.hasShortage).toBe(true);
    expect(split.hasSurplus).toBe(false);
    // لا يُشتقّ العجز من التالف ولا من المرتجع — كلّ رقمٍ من حقله (2 + 1 ≠ 2.5).
    expect(Number(split.damaged) + Number(split.returned)).not.toBe(Number(split.shortage));
    // والمتوقع − الفعلي = فرق الجرد: العلاقة تُعرض ولا يُعاد حسابها من رقمٍ واحد.
    expect(Number(split.expectedRemaining) - Number(split.actualRemaining)).toBe(
      Number(split.countVariance),
    );
  });

  it('الفرق السالب فائضٌ يُقال بوصفه فائضاً لا عجزاً', () => {
    const split = fourWaySeparation({ countVarianceQty: '-2.5', shortageQty: '0' });
    expect(split.hasSurplus).toBe(true);
    expect(split.surplus).toBe('2.50');
    expect(split.hasShortage).toBe(false);
  });

  it('الغائب صفرٌ معروضٌ لا رقمٌ مخترَع', () => {
    const split = fourWaySeparation({});
    expect(split).toMatchObject({
      sold: '0.00',
      bonus: '0.00',
      returned: '0.00',
      damaged: '0.00',
      shortage: '0.00',
      surplus: '0.00',
      countVariance: '0.00',
    });
  });
});

describe('التسميات — قيمةٌ غير معروفة تُعرض خاماً', () => {
  it('حالة سياسة العجز ومنها «محمَّل على ذمّة الموظف»', () => {
    expect(shortagePolicyStatusLabel('charged_to_employee')).toBe(
      SHORTAGE_POLICY_STATUS_LABELS.charged_to_employee,
    );
    expect(shortagePolicyStatusLabel('charged_to_employee')).toContain('ذمّة الموظف');
    expect(shortagePolicyStatusLabel('pending_policy_approval')).toBe('بانتظار سياسة التقييم');
    expect(shortagePolicyStatusLabel('some_future_state')).toBe('some_future_state');
    expect(shortagePolicyStatusLabel(null)).toBe('—');
  });

  it('أساس التقييم الفعلي لا أساس السياسة المعلن', () => {
    expect(chargeBasisLabel('unit_cost')).toBe(CHARGE_BASIS_LABELS.unit_cost);
    expect(chargeBasisLabel('unit_cost')).toBe('التكلفة (قرار السياسة)');
    expect(chargeBasisLabel('average_document_price')).toContain('متوسط سعر البيع');
    // حمولةٌ بلا دفعة إنتاج: `unit_cost` على الأمر صفر، فـ«بالتكلفة» تُقرأ من الرصيد الرسمي
    // (متوسط تكلفة مستودع المصدر) لا من سعر البيع — والقياس الحيّ هو ما فرض هذا الأساس.
    expect(CHARGE_BASES).toContain('stock_average_cost');
    expect(chargeBasisLabel('stock_average_cost')).toContain('متوسط تكلفة الرصيد الرسمي');
    expect(chargeBasisLabel('stock_average_cost')).not.toContain('سعر بيع');
    expect(chargeBasisLabel('made_up')).toBe('made_up');
    expect(chargeBasisLabel(undefined)).toBe('—');
  });

  it('أساس السياسة ومصير المتبقي', () => {
    expect(valuationBasisLabel('unit_cost')).toBe(VALUATION_BASIS_LABELS.unit_cost);
    expect(valuationBasisLabel('unconfigured')).toContain('بلا سياسة');
    expect(valuationBasisLabel('weird')).toBe('weird');
    expect(remainingActionLabel('carry_over')).toContain('عهدةً للوردية التالية');
    expect(remainingActionLabel('return_to_main')).toContain('المستودع الرئيسي');
    expect(remainingActionLabel('fly_away')).toBe('fly_away');
    expect(remainingActionLabel(null)).toBe('—');
  });
});

describe('chargePreview — أثر القرار قبل الضغط', () => {
  const ready = {
    employeeLinked: true,
    employeeAccountReady: true,
    employeeAccountName: 'المندوب الأول — ذمم عهدة',
    creditAccountMapped: true,
    creditAccountName: 'تسويات المخزون',
    ready: true,
    blockingReason: null,
  };

  it('بلا علمٍ صريح لا قيد: «لن يُرحَّل شيء»', () => {
    const preview = chargePreview(
      { shortageQty: '3', shortageValue: '11.40', salesmanId: 's1' },
      ready,
      false,
    );
    expect(preview.willPost).toBe(false);
    expect(preview.posted).toBe(false);
    expect(preview.blockingReason).toBeNull();
  });

  it('بالعلم الصريح يقول المبلغ والأساس والطرفين — من أرقام الخادم لا من تقدير', () => {
    const preview = chargePreview(
      { shortageQty: '3', shortageValue: '11.40', countVarianceCostValue: '11.40', salesmanId: 's1' },
      ready,
      true,
    );
    expect(preview.willPost).toBe(true);
    expect(preview.amountText).toBe('11.40');
    expect(preview.costValueText).toBe('11.40');
    expect(preview.debitText).toBe('المندوب الأول — ذمم عهدة');
    expect(preview.creditText).toBe('تسويات المخزون');
  });

  it('لا مبلغ قبل أن يكتبه الخادم — «—» لا تقديرٌ مخترَع', () => {
    const preview = chargePreview({ shortageQty: '0' }, ready, true);
    expect(preview.willPost).toBe(false);
    expect(preview.amountText).toBe('—');
    expect(preview.costValueText).toBe('—');
  });

  it('يقول المانع قبل الضغط حين ينقص حساب الموظف أو الحساب الدائن', () => {
    const blocked = chargePreview(
      { shortageQty: '3', shortageValue: '11.40' },
      { ...ready, employeeAccountReady: false, ready: false, blockingReason: 'لا حساب لهذا الموظف في دليل الحسابات' },
      true,
    );
    expect(blocked.willPost).toBe(true);
    expect(blocked.blockingReason).toBe('لا حساب لهذا الموظف في دليل الحسابات');

    const unmapped = chargePreview(
      { shortageQty: '3', shortageValue: '11.40' },
      { ...ready, creditAccountMapped: false, ready: false, blockingReason: 'لم يُربط الحساب الدائن لنوع المستند «van_shortage_charge»' },
      true,
    );
    expect(unmapped.blockingReason).toContain('لم يُربط الحساب الدائن');

    // مانعٌ بلا نصٍّ من الخادم ⇒ يُقال إنّه غير معروف ولا يُخفى.
    const silent = chargePreview({ shortageQty: '3' }, { ...ready, ready: false, blockingReason: null }, true);
    expect(silent.blockingReason).toBe('مانعٌ غير معروف');
  });

  it('قيدٌ رُحِّل من قبل تُعرض نتيجته لا وَعده', () => {
    const preview = chargePreview(
      {
        shortageQty: '3',
        shortageChargeAmount: '11.4000',
        shortageChargeBasis: 'unit_cost',
        shortageJournalEntryId: 'je-1',
      },
      ready,
      true,
    );
    expect(preview.posted).toBe(true);
    expect(preview.willPost).toBe(false);
    expect(preview.amountText).toBe('11.40');
    expect(preview.basisText).toBe('التكلفة (قرار السياسة)');
  });
});

describe('مرايا رفض الخادم — الإجراء يُخفى فقط حين يكون مآله 409 مؤكّداً', () => {
  it('التقديم لمن حمّل واستلم، والاعتماد لمن قُدِّم إقفاله', () => {
    expect(canSubmitClosing({ status: 'loaded' })).toBe(true);
    expect(canSubmitClosing({ status: 'in_route' })).toBe(true);
    expect(canSubmitClosing({ status: 'pending_receipt' })).toBe(false);
    expect(canSubmitClosing({ status: 'pending_closing' })).toBe(false);
    expect(canSubmitClosing({ status: 'settled' })).toBe(false);
    expect(canSubmitClosing({})).toBe(false);

    expect(canApproveClosing({ status: 'pending_closing' })).toBe(true);
    expect(canApproveClosing({ status: 'pending_stock_settlement' })).toBe(false);
    expect(canApproveClosing({ status: 'settled' })).toBe(false);
  });

  it('استكمال التسوية للمعلّق، وفرق العبور قرارٌ مستقل', () => {
    expect(canSettleStock({ status: 'pending_stock_settlement' })).toBe(true);
    expect(canSettleStock({ stockSettlementStatus: 'pending_count_decision' })).toBe(true);
    expect(canSettleStock({ status: 'settled', stockSettlementStatus: 'settled_officially' })).toBe(false);

    expect(canCloseTransitDifference({ stockSettlementStatus: 'pending_transit_decision' })).toBe(true);
    expect(canCloseTransitDifference({ status: 'loaded', discrepancyQty: '2.00' })).toBe(true);
    expect(canCloseTransitDifference({ status: 'loaded', discrepancyQty: '0' })).toBe(false);
    expect(canCloseTransitDifference({ status: 'settled' })).toBe(false);
  });
});

describe('unsettledStockReason — لا تُغلق عهدةٌ بفرق مخزونٍ غير مُسوّى', () => {
  it('يقول السبب لكلّ حالةٍ معلّقة، ويسكت عن المسوّاة', () => {
    expect(unsettledStockReason({ stockSettlementStatus: 'not_required' })).toBeNull();
    expect(unsettledStockReason({ stockSettlementStatus: 'settled_officially' })).toBeNull();
    expect(unsettledStockReason({ stockSettlementStatus: 'pending_transit_decision' })).toContain('فرق العبور');
    expect(unsettledStockReason({ stockSettlementStatus: 'pending_count_decision' })).toContain('مستند الجرد');
    expect(unsettledStockReason({ stockSettlementStatus: 'blocked_missing_accounts' })).toContain('ناقصة');
    // حالةٌ لم تعرفها الشاشة تُعرض خاماً ولا تُقرأ «لا شيء».
    expect(unsettledStockReason({ stockSettlementStatus: 'weird_state' })).toBe('weird_state');
  });

  it('ملاحظة الخادم أولى من نصّ الشاشة', () => {
    expect(
      unsettledStockReason({
        stockSettlementStatus: 'pending_count_decision',
        stockSettlementNote: 'فرق الجرد 0.50 كجم (المتوقع 1.00 / الفعلي 0.50)',
      }),
    ).toBe('فرق الجرد 0.50 كجم (المتوقع 1.00 / الفعلي 0.50)');
  });
});

describe('🚐 عددُ المركبة كلها — الاشتقاق والرفض (قرار المالك 2026-10-15)', () => {
  it('الاشتقاق: نصيبُ العهدة = max(0, عددُ السيارة − عهدةُ الغير)', () => {
    expect(
      vehicleCountShare(
        closing({ vehicleCountQty: '25.5', otherCustodyInVanQty: '20' }),
      ).share.toFixed(2),
    ).toBe('5.50');
    expect(
      vehicleCountShare(closing({ vehicleCountQty: '5', otherCustodyInVanQty: '20' })).share.toFixed(2),
    ).toBe('0.00');
    expect(
      vehicleCountShare(closing({ vehicleCountQty: '5', otherCustodyInVanQty: '20' }))
        .belowOtherCustody,
    ).toBe(true);
    expect(vehicleCountShare(closing()).declared).toBe(false);
    // بلا رقمٍ من اللوحة ⇒ عهدةُ الغير صفرٌ والنصيب هو العدد كله.
    expect(vehicleCountShare(closing({ vehicleCountQty: '25.5' })).share.toFixed(2)).toBe('25.50');
  });

  it('يُرسل عددُ المركبة وحده — والنصيب يشتقّه الخادم فلا يُرسل بجانبه', () => {
    const verdict = buildClosingPayload(
      closing({ actualRemainingQty: '', vehicleCountQty: '26', otherCustodyInVanQty: '20' }),
      quantities(),
    );
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.payload.vehicleCountQty).toBe('26.0000');
    expect(verdict.payload.actualRemainingQty).toBeUndefined();
  });

  it('سقفُ العهدة يُقاس بالنصيب المشتقّ لا بعدد السيارة كلها', () => {
    // العهدة 20 والمحسوب 14 ⇒ المتوقع 6. وعددُ السيارة 26 منه 20 لغيره ⇒ النصيب 6 ⇒ لا تجاوز،
    // بينما قياسُ السقف بعدد السيارة (‏26 > 20) كان سيرفض عدّاً صحيحاً.
    const within = buildClosingPayload(
      closing({ actualRemainingQty: '', vehicleCountQty: '26', otherCustodyInVanQty: '20' }),
      quantities(),
    );
    expect(within.ok).toBe(true);
    // أمّا ما تجاوز نصيبُه العهدة فيُرفض كما يُرفض اليوم (فائضُ المندوب يُسجَّل عند الاعتماد).
    const over = buildClosingPayload(
      closing({ actualRemainingQty: '', vehicleCountQty: '30', otherCustodyInVanQty: '20' }),
      quantities(),
    );
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.message).toContain('يتجاوز العهدة المستلمة');
    expect(over.field).toBe('actualRemainingQty');
  });

  it('عددٌ دون عهدة الغير ⇒ رفضٌ قبل الإرسال (لا يُشطب ما لا يملكه الأمر)', () => {
    const verdict = buildClosingPayload(
      closing({ actualRemainingQty: '', vehicleCountQty: '5', otherCustodyInVanQty: '20' }),
      quantities(),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.message).toContain('أقلّ من عهدة أوامرَ أخرى');
    expect(verdict.field).toBe('vehicleCountQty');
  });

  it('نصٌّ غير رقمي في عدد المركبة ⇒ رفض، لا صفرٌ يشطب رصيد السيارة', () => {
    const verdict = buildClosingPayload(
      closing({ actualRemainingQty: '', vehicleCountQty: 'عشرون', otherCustodyInVanQty: '20' }),
      quantities(),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.field).toBe('vehicleCountQty');
    expect(verdict.message).toContain('عددُ الصنف في السيارة كلها');
  });

  it('الاعتماد يسلك المسلك نفسه، ومصيرُ المتبقي يُقاس بالنصيب المشتقّ', () => {
    const verdict = buildApprovalPayload(
      approval({ actualRemainingQty: '', vehicleCountQty: '26', otherCustodyInVanQty: '20' }),
      quantities(),
    );
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.payload.vehicleCountQty).toBe('26.0000');
    expect(verdict.payload.actualRemainingQty).toBeUndefined();

    const noDestination = buildApprovalPayload(
      approval({
        actualRemainingQty: '',
        vehicleCountQty: '26',
        otherCustodyInVanQty: '20',
        remainingAction: '',
      }),
      quantities(),
    );
    expect(noDestination.ok).toBe(false);
    if (noDestination.ok) return;
    expect(noDestination.message).toBe(APPROVAL_MESSAGES.remainingActionRequired('6.00'));

    const refused = buildApprovalPayload(
      approval({ actualRemainingQty: '', vehicleCountQty: '5', otherCustodyInVanQty: '20' }),
      quantities(),
    );
    expect(refused.ok).toBe(false);
  });

  it('بلا عدد مركبة ⇒ حمولةُ اليوم حرفياً (فلا يتغيّر شيءٌ على `apps/staff`)', () => {
    const verdict = buildClosingPayload(closing(), quantities());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.payload.actualRemainingQty).toBe('6.0000');
    expect(verdict.payload.vehicleCountQty).toBeUndefined();
    expect(CLOSING_MESSAGES.qtyNotNumeric('عددُ الصنف في السيارة كلها')).toContain('رقمًا موجبًا');
  });
});
