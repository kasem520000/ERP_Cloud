import { describe, expect, it } from 'vitest';

import {
  buildLinkPayload,
  custodyHeadline,
  decimalOrNull,
  emailLooksValid,
  emptyLinkDraft,
  hasOpenCustody,
  isReadyToWork,
  LINK_ACCOUNT_PERMISSION,
  linkOutcome,
  linkVerdict,
  membershipStatusLabel,
  ratePercentText,
  readinessNotes,
  REPS_MESSAGES,
  REPS_VIEW_PERMISSION,
  repsSummary,
  salesmanLabel,
  STAFF_SALESMEN_PATH,
  type LinkAccountReceipt,
  type SalesmanCard,
} from '../lib/reps-screen';

import { freshRep, readyRep } from './fixtures/salesmen';

function receipt(overrides: Partial<LinkAccountReceipt> = {}): LinkAccountReceipt {
  return {
    salesmanId: '66666666-6666-4666-8666-666666666666',
    salesmanName: 'مندوب بلا حساب',
    membershipId: '77777777-7777-4777-8777-777777777777',
    email: 'rep.login@bakery.test',
    requestedEmail: 'rep.login@bakery.test',
    reusedExistingAccount: false,
    status: 'invited',
    roleId: '88888888-8888-4888-8888-888888888888',
    roleName: 'مندوب توزيع',
    employeeLinked: true,
    scopedToVanWarehouse: true,
    activationRequired: true,
    ...overrides,
  };
}

describe('reps screen — أرقام الخادم كما هي', () => {
  it('decimalOrNull يميّز الصفر الشرعيّ من الفراغ والفاسد', () => {
    expect(decimalOrNull('0.0000')?.toString()).toBe('0');
    expect(decimalOrNull('120.5000')?.toString()).toBe('120.5');
    expect(decimalOrNull('')).toBeNull();
    expect(decimalOrNull(null)).toBeNull();
    expect(decimalOrNull('abc')).toBeNull();
    expect(decimalOrNull('Infinity')).toBeNull();
  });

  it('النسب مئوية تُعرض بلا أصفارٍ زائدة وبلا تغييرٍ في القيمة', () => {
    expect(ratePercentText('5.0000')).toBe('5٪');
    expect(ratePercentText('2.5000')).toBe('2.5٪');
    expect(ratePercentText('0.0000')).toBe('0٪');
    expect(ratePercentText('')).toBe('—');
    expect(ratePercentText('ليس رقمًا')).toBe('—');
  });

  it('حالة العضوية من مفردات @erp/contracts وحدها، والمجهول خام', () => {
    expect(membershipStatusLabel('active')).toBe('نشط');
    expect(membershipStatusLabel('invited')).toContain('بانتظار التفعيل');
    expect(membershipStatusLabel('suspended')).toBe('موقوف');
    expect(membershipStatusLabel('مبتكر')).toBe('مبتكر');
    expect(membershipStatusLabel(null)).toBe('—');
  });

  it('custodyHeadline ينقل كميات الخادم بأربعة كسور ولا يقرّبها', () => {
    const headline = custodyHeadline(readyRep());
    expect(headline).toContain('2 أمر تحميل مفتوح');
    expect(headline).toContain('1 بانتظار استلامه');
    expect(headline).toContain('1 بانتظار إقفاله');
    expect(headline).toContain('120.5000 كجم تحت يده');
    expect(headline).toContain('450.2500 ريال نقدًا لم يُحصّل');
    expect(headline).not.toContain('120.5 كجم');
  });

  it('hasOpenCustody: لا عهدة تعني أصفارًا لا فراغًا، والكمية وحدها تكفي', () => {
    expect(hasOpenCustody(freshRep())).toBe(false);
    expect(hasOpenCustody(readyRep())).toBe(true);
    expect(
      hasOpenCustody(
        freshRep({ custody: { ...freshRep().custody, custodyQty: '3.0000', outstandingCash: '0.0000' } }),
      ),
    ).toBe(true);
    expect(
      hasOpenCustody(
        freshRep({ custody: { ...freshRep().custody, custodyQty: '0.0000', outstandingCash: '12.5000' } }),
      ),
    ).toBe(true);
    expect(custodyHeadline(freshRep())).toBe('لا عهدة مفتوحة على هذا المندوب');
  });

  it('salesmanLabel يذكر الموظف واللوحة إن وُجدا', () => {
    expect(salesmanLabel(readyRep())).toContain('سالم المندوب');
    expect(salesmanLabel(readyRep())).toContain('موظف رقم EMP-7');
    expect(salesmanLabel(readyRep())).toContain('لوحة أ ب ج 1234');
    const bare = salesmanLabel(freshRep());
    expect(bare).toBe('مندوب بلا حساب');
  });
});

describe('reps screen — الجاهزية بأثرها لا بوصفها', () => {
  it('البطاقة الكاملة جاهزة، وكلّ نقصٍ يسقطها', () => {
    expect(isReadyToWork(readyRep())).toBe(true);
    expect(isReadyToWork(readyRep({ active: false }))).toBe(false);
    expect(isReadyToWork(freshRep())).toBe(false);
    const noScope = readyRep({
      readiness: { ...readyRep().readiness, hasVanWarehouse: false },
    });
    expect(isReadyToWork(noScope)).toBe(false);
  });

  it('readinessNotes: الجاهز سطرٌ واحد أخضر، والناقص أسطرٌ تقول ماذا يتعطّل', () => {
    const okNotes = readinessNotes(readyRep());
    expect(okNotes).toHaveLength(1);
    expect(okNotes[0]?.tone).toBe('ok');

    const notes = readinessNotes(freshRep());
    const texts = notes.map((note) => note.text).join(' ');
    expect(texts).toContain('٤٢٢'); // النقص على مديونية الموظف مرفوض
    expect(texts).toContain('van-sales/me'); // لا مساحة عمل بلا عضوية
    expect(texts).toContain('٤٠٣'); // حارس الصلاحيات
    expect(notes.every((note) => note.tone === 'danger' || note.tone === 'warn')).toBe(true);
  });

  it('حسابٌ مدعوّ ليس حسابًا غائبًا: تحذيرُ تفعيل لا سطرُ انعدام', () => {
    const invited = readyRep({
      membershipStatus: 'invited',
      userStatus: 'invited',
      readiness: { ...readyRep().readiness, loginActive: false },
    });
    const notes = readinessNotes(invited);
    const texts = notes.map((note) => note.text).join(' ');
    expect(texts).toContain('مدعوّ');
    expect(texts).toContain('رابطُ التفعيل');
    expect(texts).not.toContain('بلا حساب دخول');
    expect(isReadyToWork(invited)).toBe(false);
  });

  it('بطاقةٌ موقوفة تُقال، وبلا `readiness` لا تُخترع ملاحظات', () => {
    const stopped = readinessNotes(readyRep({ active: false }));
    expect(stopped.some((note) => note.tone === 'warn' && note.text.includes('موقوفة'))).toBe(true);
    expect(readinessNotes({ ...readyRep(), readiness: undefined as never })).toEqual([]);
    expect(isReadyToWork({ ...readyRep(), readiness: undefined as never })).toBe(false);
  });

  it('repsSummary يعدّ النواقص ويجمع أرقامَ القائمة كلّها (لا نافذة هنا)', () => {
    const rows: SalesmanCard[] = [
      readyRep(),
      freshRep(),
      freshRep({
        id: '99999999-9999-4999-8999-999999999999',
        name: 'ثالث بلا مستودع',
        warehouseId: null,
        warehouseName: null,
        readiness: { ...freshRep().readiness, hasEmployee: true, hasVanWarehouse: false },
        custody: { ...freshRep().custody, custodyQty: '0.2500', outstandingCash: '9.7500' },
      }),
    ];
    const summary = repsSummary(rows);
    expect(summary.total).toBe(3);
    expect(summary.readyToWork).toBe(1);
    expect(summary.missingEmployee).toBe(1); // الثالثُ له بطاقةُ موظف، والثاني فقط بلا بطاقة
    expect(summary.missingLogin).toBe(2);
    expect(summary.missingVanWarehouse).toBe(1);
    expect(summary.missingPermissions).toBe(2);
    expect(summary.withOpenCustody).toBe(2);
    expect(summary.custodyItemsTotal).toBe(1);
    expect(summary.custodyQtyTotal.toFixed(4)).toBe('120.7500');
    expect(summary.outstandingCashTotal.toFixed(4)).toBe('460.0000');
  });

  it('قائمةٌ فارغة: أصفارٌ لا `NaN` ولا استثناء', () => {
    const summary = repsSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.custodyQtyTotal.toFixed(4)).toBe('0.0000');
    expect(summary.outstandingCashTotal.toFixed(4)).toBe('0.0000');
  });
});

describe('reps screen — الحمولة والحكم قبل الإرسال', () => {
  it('البريد يُقَصّ ويُصغَّر كما يفعل الخادم، والاسم الفارغ لا يُرسل', () => {
    const payload = buildLinkPayload({
      salesmanId: 'x',
      email: '  Rep.Login@Bakery.TEST ',
      fullName: '   ',
      restrictToVanWarehouse: true,
    });
    expect(payload.email).toBe('rep.login@bakery.test');
    expect(payload.fullName).toBeUndefined();
    expect(payload.restrictToVanWarehouse).toBe(true);
    expect(Object.keys(payload)).toEqual(['email', 'restrictToVanWarehouse']);
  });

  it('الاسم يُرسل مقصوصًا، والتقييد الملغى يبقى `false` صريحًا', () => {
    const payload = buildLinkPayload({
      salesmanId: 'x',
      email: 'a@b.co',
      fullName: '  المندوب الثاني  ',
      restrictToVanWarehouse: false,
    });
    expect(payload.fullName).toBe('المندوب الثاني');
    expect(payload.restrictToVanWarehouse).toBe(false);
  });

  it('emailLooksValid تحذيرٌ لا حظر', () => {
    expect(emailLooksValid('rep@bakery.test')).toBe(true);
    expect(emailLooksValid('rep@bakery')).toBe(false);
    expect(emailLooksValid('rep bakery.test')).toBe(false);
  });

  it('emptyLinkDraft: التقييد بمستودع السيارة هو الافتراضي (كافتراضي الخادم)', () => {
    const draft = emptyLinkDraft();
    expect(draft.restrictToVanWarehouse).toBe(true);
    expect(draft.email).toBe('');
    expect(draft.salesmanId).toBe('');
  });

  it('محظورٌ بنصّ الخادم حرفًا: ٤٠٤ و٤٢٢ و٤٠٣', () => {
    const noRow = linkVerdict({ ...emptyLinkDraft(), email: 'a@b.co' }, null, { canLink: true });
    expect(noRow.blocked[0]).toContain(REPS_MESSAGES.salesmanNotFound);
    expect(noRow.blocked[0]).toContain('٤٠٤');

    const noEmail = linkVerdict(emptyLinkDraft(), readyRep(), { canLink: true });
    expect(noEmail.blocked[0]).toContain(REPS_MESSAGES.emailRequired);
    expect(noEmail.blocked[0]).toContain('٤٢٢');

    const noPermission = linkVerdict({ ...emptyLinkDraft(), email: 'a@b.co' }, readyRep(), { canLink: false });
    expect(noPermission.blocked.join(' ')).toContain(REPS_MESSAGES.linkForbidden);
    expect(REPS_MESSAGES.linkForbidden).toBe(`permission ${LINK_ACCOUNT_PERMISSION} required`);
    expect(REPS_MESSAGES.viewForbidden).toBe(`permission ${REPS_VIEW_PERMISSION} required`);
    // الصلاحيةُ المفقودة لا تُخفيها بقيةُ الأحكام: فالخادم يرفض المسار كله.
    expect(noPermission.blocked.length).toBe(1);
  });

  it('بطاقةٌ بلا حساب بعد وبريدٌ صحيح: لا حظر ولا تحذير', () => {
    // الحسابُ القائم يُحذَّر منه دائمًا (إعادةُ استعمال)، فحالةُ «لا تحذير» هي بطاقةٌ
    // مرتبطةٌ بموظفٍ ومستودع سيارة ولا عضويةَ لها بعد.
    const target = freshRep({
      employeeId: '22222222-2222-4222-8222-222222222222',
      readiness: { ...freshRep().readiness, hasEmployee: true },
    });
    const verdict = linkVerdict(
      { ...emptyLinkDraft(), salesmanId: target.id, email: 'rep2@bakery.test' },
      target,
      { canLink: true },
    );
    expect(verdict.blocked).toEqual([]);
    expect(verdict.warnings).toEqual([]);
  });

  it('وبطاقةٌ كاملة ولها حساب: إعادةُ الاستعمال تُقال دائمًا', () => {
    const verdict = linkVerdict(
      { ...emptyLinkDraft(), salesmanId: readyRep().id, email: 'rep2@bakery.test' },
      readyRep(),
      { canLink: true },
    );
    expect(verdict.blocked).toEqual([]);
    expect(verdict.warnings).toHaveLength(1);
  });

  it('حسابٌ قائم ⇒ تحذيرُ إعادة الاستعمال والبريد الفعليّ', () => {
    const verdict = linkVerdict(
      { ...emptyLinkDraft(), salesmanId: readyRep().id, email: 'other@bakery.test' },
      readyRep(),
      { canLink: true },
    );
    expect(verdict.blocked).toEqual([]);
    expect(verdict.warnings.join(' ')).toContain('يُعيد استعماله');
    expect(verdict.warnings.join(' ')).toContain(readyRep().userEmail ?? '');
  });

  it('بلا بطاقة موظف وبلا مستودع سيارة: تحذيران بأثرهما المحاسبيّ', () => {
    const noEmployee = linkVerdict(
      { ...emptyLinkDraft(), salesmanId: freshRep().id, email: 'rep@bakery.test' },
      freshRep(),
      { canLink: true },
    );
    const texts = noEmployee.warnings.join(' ');
    expect(texts).toContain('employeeLinked=false');
    expect(texts).not.toContain('scopedToVanWarehouse=false');

    const noVan = freshRep({
      warehouseId: null,
      warehouseName: null,
      readiness: { ...freshRep().readiness, hasEmployee: true, hasVanWarehouse: false },
    });
    const verdict = linkVerdict(
      { ...emptyLinkDraft(), salesmanId: noVan.id, email: 'rep@bakery.test' },
      noVan,
      { canLink: true },
    );
    expect(verdict.warnings.join(' ')).toContain('scopedToVanWarehouse=false');
    expect(verdict.warnings.join(' ')).not.toContain('employeeLinked=false');
  });

  it('إلغاءُ التقييد توسيعُ وصولٍ مقصود فيُقال، والبطاقة الموقوفة لا يُنشّطها الربط', () => {
    const unrestricted = linkVerdict(
      { ...emptyLinkDraft(), salesmanId: freshRep().id, email: 'rep@bakery.test', restrictToVanWarehouse: false },
      freshRep({ readiness: { ...freshRep().readiness, hasEmployee: true } }),
      { canLink: true },
    );
    expect(unrestricted.warnings.join(' ')).toContain('توسيعُ وصولٍ مقصود');

    const stopped = linkVerdict(
      { ...emptyLinkDraft(), salesmanId: readyRep().id, email: 'rep@bakery.test' },
      readyRep({ active: false }),
      { canLink: true },
    );
    expect(stopped.warnings.join(' ')).toContain('لا يُنشّطها');
  });

  it('بريدٌ لا يُشبه البريد تحذيرٌ، والحكمُ النهائيّ للخادم', () => {
    const verdict = linkVerdict(
      { ...emptyLinkDraft(), salesmanId: freshRep().id, email: 'rep bakery.test' },
      freshRep(),
      { canLink: true },
    );
    expect(verdict.blocked).toEqual([]);
    expect(verdict.warnings.join(' ')).toContain('الذي يقبله أو يرفضه');
  });

  it('الرابط العميق إلى البطاقة الرسمية ثابت', () => {
    expect(STAFF_SALESMEN_PATH).toBe('/sales/salesmen');
  });
});

describe('reps screen — قراءة إيصال الربط بحقوله', () => {
  it('بلا إيصال لا قول', () => {
    expect(linkOutcome(null)).toBeNull();
    expect(linkOutcome(undefined)).toBeNull();
  });

  it('إعادةُ استعمال حسابٍ قائم: البريدان يُذكران حين يختلفان', () => {
    const outcome = linkOutcome(
      receipt({ reusedExistingAccount: true, email: 'rep2@bakery.test', requestedEmail: 'typed@bakery.test' }),
    );
    expect(outcome?.notes.join(' ')).toContain('rep2@bakery.test');
    expect(outcome?.notes.join(' ')).toContain('typed@bakery.test');
    expect(outcome?.notes.join(' ')).toContain('أُعيد استعمالُ الحساب القائم');
  });

  it('والبريد نفسه لا يُثير فرقًا مخترعًا', () => {
    const outcome = linkOutcome(receipt({ reusedExistingAccount: true }));
    expect(outcome?.notes.join(' ')).toContain('أُعيد استعمالُ الحساب القائم');
    expect(outcome?.notes.join(' ')).not.toContain('لا ما كُتب في الطلب');
  });

  it('عضويةٌ جديدة: لا كلمة مرور مخترعة، والتفعيلُ من منصّة الهويّة', () => {
    const outcome = linkOutcome(receipt());
    expect(outcome?.notes.join(' ')).toContain('أُنشئت عضويةٌ جديدة');
    expect(outcome?.notes.join(' ')).toContain('مندوب توزيع');
    expect(outcome?.notes.join(' ')).toContain('لم تُخترع كلمةُ مرور');
    expect(outcome?.notes.join(' ')).toContain('رابطُ التفعيل');
    expect(outcome?.tone).toBe('warn'); // `invited` ⇒ ليس «تمّ» بلا قيد
  });

  it('حسابٌ نشط مقيَّد مربوط: قولٌ أخضر بلا إنذارٍ كاذب', () => {
    const outcome = linkOutcome(receipt({ status: 'active', activationRequired: false }));
    expect(outcome?.tone).toBe('ok');
    expect(outcome?.notes.join(' ')).toContain('لا تفعيلَ مطلوب');
    expect(outcome?.notes.join(' ')).toContain('مقيَّدٌ بمستودع سيارة المندوب');
    expect(outcome?.notes.join(' ')).toContain('رُبطت بطاقةُ الموظف');
    expect(outcome?.headline).toContain('مندوب بلا حساب');
  });

  it('غير مقيَّدٍ بمستودع: يُقال السببان الممكنان لا سببٌ مُخمَّن', () => {
    const outcome = linkOutcome(receipt({ scopedToVanWarehouse: false, status: 'active', activationRequired: false }));
    expect(outcome?.tone).toBe('warn');
    expect(outcome?.notes.join(' ')).toContain('غير مقيَّدٍ بمستودع');
    expect(outcome?.notes.join(' ')).toContain('بلا مستودع سيارة');
    expect(outcome?.notes.join(' ')).toContain('أُلغي في الطلب');
  });

  it('بلا ربطِ موظف: أثرُ تحميل النقص يُقال بعد الربط أيضًا', () => {
    const outcome = linkOutcome(receipt({ employeeLinked: false, status: 'active', activationRequired: false }));
    expect(outcome?.tone).toBe('warn');
    expect(outcome?.notes.join(' ')).toContain('employee_id');
    expect(outcome?.notes.join(' ')).toContain('مرفوضًا عند الخادم');
  });
});
