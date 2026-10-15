'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, CardBody, CardHeader, Input } from '@erp/ui';
import { apiData, apiErrorText, apiPost, apiPut } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';
import { stockSettlementStatusLabel } from '@erp/web-van/distribution';
import {
  buildApprovalPayload,
  buildClosingPayload,
  canApproveClosing,
  canCloseTransitDifference,
  canSettleStock,
  canSubmitClosing,
  chargePreview,
  fourWaySeparation,
  REMAINING_ACTIONS,
  remainingActionLabel,
  shortagePolicyStatusLabel,
  unsettledStockReason,
  VALUATION_BASES,
  valuationBasisLabel,
  type ApprovalDraft,
  type ClosingDraft,
} from '@erp/web-van/custody';

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
  type CustodyDashboard,
  type CustodyRow,
  type ShortagePolicyRow,
  vanCustodyCoverage,
  vehicleCountPreview,
} from '../../lib/custody-screen';
import { numberText } from '../../lib/lookups';

/** أسماء اتجاهات فرق الجرد — كلمةٌ لا رقمٌ يُخمَّن معناه. */
const VARIANCE_KIND_LABELS = { shortage: 'عجز', surplus: 'فائض', exact: 'مطابق' } as const;

/** الصلاحيات كما يفرضها الخادم على كلّ مسارٍ تستعمله هذه الشاشة (`@RequiresPermission`). */
const VIEW_PERMISSION = 'van_sales.view';
const SUBMIT_PERMISSION = 'van_sales.closing.submit';
const APPROVE_PERMISSION = 'van_sales.closing.approve';
const OVERRIDE_PERMISSION = 'van_sales.override.approve';
const LOAD_PERMISSION = 'van_sales.load.manage';

const selectClass = 'w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink';
const checkClass = 'flex items-start gap-2 text-[12.5px] font-semibold text-ink';

type ActionKind = 'submit' | 'approve' | 'settle' | 'transit';

const ACTION_LABELS: Record<ActionKind, string> = {
  submit: 'تقديم إقفال الوردية',
  approve: 'اعتماد الإقفال',
  settle: 'استكمال تسوية المخزون',
  transit: 'حسم فرق العبور',
};

const ACTION_ROUTES: Record<ActionKind, (id: string) => string> = {
  submit: (id) => `/van-sales/load-orders/${id}/submit-closing`,
  approve: (id) => `/van-sales/load-orders/${id}/approve-closing`,
  settle: (id) => `/van-sales/load-orders/${id}/settle-stock`,
  transit: (id) => `/van-sales/load-orders/${id}/close-transit-difference`,
};

/**
 * 📋 شاشة إقفال العهدة — الجرد الفعلي، فالفصل الرباعي، فقرارٌ ماليّ صريح لكلّ حالة.
 *
 * ثلاث قواعد أمانة تحكمها (هي نفسها في شاشتَي الإنتاج والتوزيع):
 *   1. **العقد من الحزمة المشتركة**: `buildClosingPayload` و`buildApprovalPayload` من
 *      `@erp/web-van/custody` — لا نسخة ثانية هنا. ونصوص الرفض نصوصُ الخادم حرفاً
 *      (‏`submitClosing`/`approveClosing` في `van-sales.service.ts`، ومثبّتةٌ في
 *      `apps/api/test/van-sales-stock-acceptance.spec.ts`). وما ترفضه الشاشة أشدّ من الخادم في
 *      موضعٍ واحد مقصود: النصّ غير الرقمي، لأنّ الخادم يقرأه صفراً بصمت فتُغلق العهدة على
 *      رقمٍ لم يكتبه أحد.
 *   2. **الفصل الرباعي لا يُدمج**: مرتجعٌ سليم، وتالف، وعجز، ومتبقٍ فعلي — أربعة أرقام من
 *      صفّ الخادم (`returnedQty`/`damagedQty`/`shortageQty`/`actualRemainingQty`)، ولكلٍّ مصيرٌ
 *      ومسؤولية. والغائب `—` لا صفر، والحالة غير المعروفة تُعرض خاماً.
 *   3. **القرار الماليّ يُقال أثره قبل الضغط**: تحميل العجز على المندوب
 *      (`salaryDeductionApproved`) يرحّل منذ الشريحة 4 قيداً مدينُه حسابُ الموظف نفسه — فتُعرض
 *      الكمية والقيمة والأساس والطرفان ومانعُ الاعتماد **قبل** الإرسال (`GET
 *      /van-sales/policy?salesmanId=`)، ولا يُرفع العلم افتراضاً ولا يُورَّث من محاولةٍ سابقة.
 *
 * والضابط في الخادم دائماً: الصلاحيات تُفحص هنا كي لا تُعرض شاشةٌ سيُرفض طلبها، وإخفاء زرٍّ
 * ليس ضبطاً للوصول. وما **ليس** هنا: الأستاذ وتفصيل القيود وتسوية الرواتب — في لوحة `staff`
 * بتسليم جلسة، فلا محرّك محاسبياً ثانياً في هذه الواجهة.
 */
export default function CustodyPage() {
  const { can } = useSession();
  const canView = can(VIEW_PERMISSION);
  const canSubmit = can(SUBMIT_PERMISSION);
  const canApprove = can(APPROVE_PERMISSION);
  const canOverride = can(OVERRIDE_PERMISSION);
  const canManageLoad = can(LOAD_PERMISSION);

  const [dashboard, setDashboard] = useState<CustodyDashboard | undefined>();
  const [policy, setPolicy] = useState<ShortagePolicyRow | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  // سياسة تقييم العجز (تُكتب بـ`van_sales.override.approve` وحدها)
  const [basisValue, setBasisValue] = useState('');
  const [priceValue, setPriceValue] = useState('');
  const [selfApprovalValue, setSelfApprovalValue] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyError, setPolicyError] = useState<string | undefined>();
  const [policyDone, setPolicyDone] = useState<string | undefined>();

  // الإجراء على صفٍّ بعينه
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [actionKind, setActionKind] = useState<ActionKind | undefined>();
  const [closing, setClosing] = useState<ClosingDraft>(emptyClosingDraft());
  const [flags, setFlags] = useState({
    damageInspected: false,
    salaryDeductionApproved: false,
    settleStockAdjustment: false,
    surplusAcknowledged: false,
    selfApprovalOverride: false,
  });
  const [remainingAction, setRemainingAction] = useState('');
  const [notes, setNotes] = useState('');
  const [transitMode, setTransitMode] = useState('return');
  const [transitReason, setTransitReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [actionDone, setActionDone] = useState<string | undefined>();

  const rows = useMemo(() => mapCustodyRows(dashboard), [dashboard]);
  const pending = useMemo(() => openCustodies(rows), [rows]);
  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId),
    [rows, selectedId],
  );
  const readiness = policy?.chargeReadiness ?? null;
  const summary = useMemo(() => policySummary(policy), [policy]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const dash = await apiData<CustodyDashboard>('/van-sales/dashboard');
      setDashboard(dash);
    } catch (caught) {
      setLoadError(apiErrorText(caught, 'تعذّر تحميل لوحة العهدة'));
    } finally {
      setLoading(false);
    }
  }, []);

  /** السياسة تُقرأ وحدها، وتُقرأ مع المندوب حين يُختار صفٌّ — فالمسبار يقول المانع قبل الضغط. */
  const loadPolicy = useCallback(async (salesmanId?: string | null): Promise<void> => {
    try {
      const query = salesmanId ? `?salesmanId=${encodeURIComponent(salesmanId)}` : '';
      setPolicy(await apiData<ShortagePolicyRow>(`/van-sales/policy${query}`));
    } catch (caught) {
      // ‏لا سياسة تُخترع محلياً: تُعرض اللوحة ويُسأل المسار مرة أخرى عند التحديث.
      setPolicyError(apiErrorText(caught, 'تعذّر قراءة سياسة العجز'));
    }
  }, []);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    void load();
    void loadPolicy();
  }, [canView, load, loadPolicy]);

  useEffect(() => {
    if (!selected?.salesmanId) return;
    void loadPolicy(selected.salesmanId);
  }, [loadPolicy, selected?.salesmanId]);

  const pick = (row: CustodyRow, kind: ActionKind): void => {
    setSelectedId(row.id ?? undefined);
    setActionKind(kind);
    setActionError(undefined);
    setActionDone(undefined);
    setTransitReason('');
    setTransitMode('return');
    setNotes('');
    setFlags({
      damageInspected: false,
      salaryDeductionApproved: false,
      settleStockAdjustment: false,
      surplusAcknowledged: false,
      selfApprovalOverride: false,
    });
    if (kind === 'submit') {
      setClosing({
        ...emptyClosingDraft(),
        // 🚐 عهدةُ الأوامر الأخرى من اللوحة — بها يشتقّ المتصفّح نصيبَ هذه العهدة ويعاينه،
        // وبها يرفض عدداً دونها قبل الإرسال (والخادم يعيد الاشتقاق من الرصيد الحيّ).
        otherCustodyInVanQty:
          row.otherCustodyInVanQty === null || row.otherCustodyInVanQty === undefined
            ? ''
            : String(row.otherCustodyInVanQty),
      });
      setRemainingAction('');
    } else {
      const draft = approvalDraftFromRow(row);
      setClosing({
        returnedQty: draft.returnedQty,
        damagedQty: draft.damagedQty,
        damageReason: draft.damageReason,
        collectedCash: draft.collectedCash,
        actualRemainingQty: draft.actualRemainingQty,
        vehicleCountQty: draft.vehicleCountQty,
        otherCustodyInVanQty: draft.otherCustodyInVanQty,
        closingNotes: '',
      });
      setRemainingAction(draft.remainingAction);
    }
    if (row.salesmanId) void loadPolicy(row.salesmanId);
  };

  const closeAction = (): void => {
    setActionKind(undefined);
    setSelectedId(undefined);
    setActionError(undefined);
  };

  const writePolicy = async (): Promise<void> => {
    setPolicyBusy(true);
    setPolicyError(undefined);
    setPolicyDone(undefined);
    try {
      const body: Record<string, unknown> = {};
      if (basisValue) body.shortageValuationBasis = basisValue;
      if (priceValue.trim()) body.shortageUnitPrice = priceValue.trim();
      body.preventSelfApproval = selfApprovalValue;
      if (Object.keys(body).length === 1 && !basisValue && !priceValue.trim()) {
        setPolicyError('اختر أساساً أو اكتب سعراً صريحاً — لا تُرسل كتابةٌ فارغة.');
        return;
      }
      const written = await apiPut<ShortagePolicyRow>('/van-sales/policy', body);
      setPolicy(written);
      setPolicyDone(
        `كُتبت السياسة: الأساس «${valuationBasisLabel(written.shortageValuationBasis ?? null)}» وما ينفّذ فعلاً «${valuationBasisLabel(
          written.valuationSource ?? null,
        )}» — والكتابة دمجٌ لا استبدال، ومعها سطر تدقيق قبل/بعد.`,
      );
      await loadPolicy(selected?.salesmanId ?? null);
    } catch (caught) {
      setPolicyError(apiErrorText(caught, 'تعذّرت كتابة سياسة العجز'));
    } finally {
      setPolicyBusy(false);
    }
  };

  /** بناء الحمولة من العقد المشترك، ثمّ إرسالها — ورفضُ العقد لا يُرسل شيئاً أصلاً. */
  const runAction = async (): Promise<void> => {
    if (!selected?.id || !actionKind) return;
    setBusy(true);
    setActionError(undefined);
    setActionDone(undefined);
    try {
      let body: Record<string, unknown>;
      if (actionKind === 'submit') {
        const verdict = buildClosingPayload(closing, selected);
        if (!verdict.ok) {
          setActionError(verdict.message);
          return;
        }
        body = { ...verdict.payload };
      } else if (actionKind === 'approve' || actionKind === 'settle') {
        const draft: ApprovalDraft = {
          ...closing,
          damageInspected: flags.damageInspected,
          salaryDeductionApproved: flags.salaryDeductionApproved,
          remainingAction,
          settleStockAdjustment: flags.settleStockAdjustment,
          surplusAcknowledged: flags.surplusAcknowledged,
          selfApprovalOverride: flags.selfApprovalOverride,
          notes,
        };
        const verdict = buildApprovalPayload(draft, selected);
        if (!verdict.ok) {
          setActionError(verdict.message);
          return;
        }
        body = { ...verdict.payload };
      } else {
        body = { mode: transitMode, reason: transitReason.trim() || undefined };
      }

      await apiPost<unknown>(ACTION_ROUTES[actionKind](selected.id), body);
      const label = ACTION_LABELS[actionKind];
      setActionDone(
        actionKind === 'approve' && flags.salaryDeductionApproved
          ? `${label} — ${custodyLabel(selected)}: اعتمد الخادم الكميات، ورُحِّل قيد تحميل العجز على ذمّة الموظف. الجدول أدناه من اللوحة المحدَّثة (لا من المتصفح).`
          : `${label} — ${custodyLabel(selected)}: نُفِّذ في الخادم، والجدول أدناه من اللوحة المحدَّثة.`,
      );
      closeAction();
      await load();
      await loadPolicy(selected.salesmanId ?? null);
    } catch (caught) {
      setActionError(apiErrorText(caught, `تعذّر ${ACTION_LABELS[actionKind]}`));
    } finally {
      setBusy(false);
    }
  };

  const separation = selected ? fourWaySeparation(selected) : null;
  const preview = selected
    ? chargePreview(selected, readiness, flags.salaryDeductionApproved)
    : null;
  const blockers = selected ? approvalBlockers(selected, readiness, flags.salaryDeductionApproved) : [];
  const evidence = selected ? chargeEvidence(selected) : null;
  const cash = selected ? cashPosition(selected) : null;
  const unsettled = selected ? unsettledStockReason(selected) : null;
  const selectedAudit = selected ? countSettlementAudit(selected) : null;
  /**
   * 🧾 ما امتصّه مستند الجرد خارج الاعتماد — من **كلّ** الصفوف لا المعلّقة وحدها: المستند
   * يُرحَّل عند الإقفال، فصفُّه `settled` ولم يعد في «عهدات تنتظر قراراً». والأرقام من الخادم
   * (‏`countDocumentExpectedQty` / `countDocumentVarianceQty` مقابل `countVarianceQty`).
   */
  const absorbedAudits = useMemo(
    () =>
      rows
        .map((row) => ({ row, audit: countSettlementAudit(row) }))
        .filter((entry) => entry.audit.absorbed),
    [rows],
  );
  /**
   * 🚐 تغطيةُ الرصيد الرسمي للعهدة المختارة — تُقال **قبل** إدخال العدد، لأنّ مستند الجرد يضبط
   * رصيد السيارة كله: إن كانت فيها عهدةٌ لأمرٍ آخر فالعدد المُعلن هنا يجب ألّا يشملها.
   */
  const coverage = selected ? vanCustodyCoverage(selected) : null;
  /** 🚐 معاينةُ اشتقاق نصيب هذه العهدة من عدد السيارة كلها — قبل الإرسال لا بعده. */
  const countPreview = selected ? vehicleCountPreview(selected, closing) : null;
  /** عهدةٌ مفتوحة لا يغطّيها رصيد السيارة الرسمي — أثرُ مستندات جردٍ صدرت لأوامرَ أخرى. */
  const uncovered = useMemo(() => uncoveredCustodySummary(rows), [rows]);

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
            إقفال العهدة
          </h1>
          <p className="m-0 mt-1 text-[13px] text-muted">
            جردٌ فعليّ في السيارة، ثمّ فصلٌ رباعيّ لا يُدمج (مرتجع سليم · تالف · عجز · متبقٍ)، ثمّ
            تسويةٌ رسمية للمخزون. وتحميل العجز على المندوب <strong>قرارٌ لكلّ حالة</strong>: بلا
            علمٍ صريح لا يُرحَّل قيد، ومع العلم يُقال أثره هنا قبل الضغط.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {uncovered.count > 0 ? (
            <span className="rounded-[8px] border border-danger-line bg-danger-soft px-2 py-1 text-[12px] font-semibold text-danger-ink">
              🚐 الرصيد الرسمي لا يغطي {uncovered.count} عهدة مفتوحة — نقص{' '}
              <span dir="ltr">{uncovered.shortfallText}</span> كجم
            </span>
          ) : null}
          <span className="bak-badge">POST …/submit-closing · …/approve-closing</span>
          <Button disabled={loading || !canView} onClick={() => void load()} size="sm">
            تحديث
          </Button>
        </div>
      </header>

      {!canView ? (
        <Card>
          <CardBody>
            <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] font-semibold text-warn-ink">
              🔒 لا تملك `{VIEW_PERMISSION}` — والخادم يرفض قراءة لوحة العهدة وسياسة العجز. ولم
              يُرسل هذا التطبيق طلباً سيُرفض حتماً، ولا عرض أرقاماً من المتصفح بدلها.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {loadError ? (
        <Card>
          <CardBody>
            <p
              className="m-0 rounded-[10px] border border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger-ink"
              role="alert"
            >
              تعذّر تحميل بيانات العهدة: {loadError}
            </p>
            <Button className="mt-3" onClick={() => void load()} size="sm">
              إعادة المحاولة
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {policyDone ? (
        <p className="m-0 rounded-[10px] border border-ok-line bg-ok-soft px-4 py-2.5 text-[13px] font-semibold text-ok-ink">
          ✅ {policyDone}
        </p>
      ) : null}

      {actionDone ? (
        <p className="m-0 rounded-[10px] border border-ok-line bg-ok-soft px-4 py-2.5 text-[13px] font-semibold text-ok-ink">
          ✅ {actionDone}
        </p>
      ) : null}

      {/* ⚖️ سياسة تقييم العجز — القرار الماليّ الذي يُقاس به كلّ عجز لاحق. */}
      <Card>
        <CardHeader
          subtitle="تُقرأ من GET /van-sales/policy وتُكتب بـPUT نفسها. والسعر الصريح المكتوب يتقدّم على الأساس، فـ«ما ينفّذ فعلاً» هو الحقيقة لا الأساس وحده. وallowInternalDeliveryWithoutTax قرارٌ ضريبيّ في موضعٍ آخر: الخادم يرفض كتابته من هذا الباب (422)."
          title="سياسة تقييم العجز"
        />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1 text-[12.5px]">
              <span className="font-bold text-ink">الأساس المضبوط</span>
              <span className="text-muted">{summary.basisText}</span>
              <span className="font-bold text-ink">ما ينفّذ فعلاً عند الاعتماد</span>
              <span className="text-muted">{summary.sourceText}</span>
              <span className="font-bold text-ink">سعرٌ صريح في السياسة</span>
              <span className="text-muted" dir="ltr">
                {summary.explicitPriceText}
              </span>
              <span className="font-bold text-ink">الحساب الدائن المربوط (van_shortage_charge)</span>
              <span className="text-muted">{summary.creditAccountText}</span>
              <span className="font-bold text-ink">منع الاعتماد الذاتي</span>
              <span className="text-muted">{summary.preventSelfApproval ? 'مفعّل' : 'غير مفعّل'}</span>
            </div>

            {canOverride ? (
              <div className="grid gap-3">
                <label className="grid gap-1 text-[12.5px] font-bold text-ink">
                  أساس التقييم
                  <select
                    className={selectClass}
                    onChange={(event) => setBasisValue(event.target.value)}
                    value={basisValue}
                  >
                    <option value="">— لا تغيير —</option>
                    {VALUATION_BASES.map((basis) => (
                      <option key={basis} value={basis}>
                        {valuationBasisLabel(basis)} ({basis})
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  dir="ltr"
                  hint="يُكتب لمسح السعر أن يُترك فارغاً ويُختار أساسٌ — والمسح الصريح بـnull من API."
                  label="سعرٌ صريح للعجز (يتقدّم على الأساس)"
                  onChange={(event) => setPriceValue(event.target.value)}
                  value={priceValue}
                />
                <label className={checkClass}>
                  <input
                    checked={selfApprovalValue}
                    onChange={(event) => setSelfApprovalValue(event.target.checked)}
                    type="checkbox"
                  />
                  منع الاعتماد الذاتي (من قدّم الإقفال لا يعتمده)
                </label>
                <div className="flex items-center gap-2">
                  <Button disabled={policyBusy} onClick={() => void writePolicy()} size="sm">
                    كتابة السياسة
                  </Button>
                  <span className="text-[12px] text-muted">PUT /van-sales/policy · {OVERRIDE_PERMISSION}</span>
                </div>
              </div>
            ) : (
              <p className="m-0 rounded-[10px] border border-line bg-surface px-3 py-2 text-[12.5px] text-muted">
                🔒 الكتابة تحتاج `{OVERRIDE_PERMISSION}` — الأساس قرارٌ ماليّ، فلا يُكتب لمن يقرأ.
                والقراءة معروضة أعلاه كما هي في الخادم.
              </p>
            )}
          </div>
          {policyError ? (
            <p
              className="m-0 mt-3 rounded-[10px] border border-danger-line bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger-ink"
              role="alert"
            >
              {policyError}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* 📋 العهدات التي تنتظر قراراً */}
      <Card>
        <CardHeader
          subtitle="صفوف loadOrders من GET /van-sales/dashboard كما هي، مُصفّاة إلى ما ينتظر قراراً (تقديم/اعتماد/تسوية معلّقة/فرق عبور). والأرقام من الخادم: لا يُعاد حسابها هنا."
          title={`عهدات تنتظر قراراً (${pending.length})`}
        />
        <CardBody>
          {pending.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">
              لا عهدة معلّقة الآن — {loading ? '(جارٍ القراءة…)' : 'اقرأ اللوحة بالتحديث إن تغيّر شيء.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-muted">
                    <th className="border-b border-line p-2 text-start font-bold">الأمر</th>
                    <th className="border-b border-line p-2 text-start font-bold">الحالة</th>
                    <th className="border-b border-line p-2 text-start font-bold">العهدة</th>
                    <th className="border-b border-line p-2 text-start font-bold">متوقع</th>
                    <th className="border-b border-line p-2 text-start font-bold">فعلي</th>
                    <th className="border-b border-line p-2 text-start font-bold">فرق الجرد</th>
                    <th className="border-b border-line p-2 text-start font-bold">مرتجع</th>
                    <th className="border-b border-line p-2 text-start font-bold">تالف</th>
                    <th className="border-b border-line p-2 text-start font-bold">عجز</th>
                    <th className="border-b border-line p-2 text-start font-bold">متبقٍ</th>
                    <th className="border-b border-line p-2 text-start font-bold">تسوية المخزون</th>
                    <th className="border-b border-line p-2 text-start font-bold">سياسة العجز</th>
                    <th className="border-b border-line p-2 text-start font-bold">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((row) => {
                    const split = fourWaySeparation(row);
                    return (
                      <tr key={row.id ?? row.number ?? custodyLabel(row)}>
                        <td className="border-b border-line p-2">{custodyLabel(row)}</td>
                        <td className="border-b border-line p-2" dir="ltr">
                          {row.status ?? '—'}
                        </td>
                        <td className="border-b border-line p-2 num" dir="ltr">
                          {numberText(row.receivedQty)} / {numberText(row.loadedQty)}
                        </td>
                        <td className="border-b border-line p-2 num" dir="ltr">
                          {split.expectedRemaining}
                        </td>
                        <td className="border-b border-line p-2 num" dir="ltr">
                          {split.actualRemaining}
                        </td>
                        <td className="border-b border-line p-2 num" dir="ltr">
                          {split.countVariance}
                        </td>
                        <td className="border-b border-line p-2 num" dir="ltr">
                          {split.returned}
                        </td>
                        <td className="border-b border-line p-2 num" dir="ltr">
                          {split.damaged}
                        </td>
                        <td className="border-b border-line p-2 num" dir="ltr">
                          {split.shortage}
                        </td>
                        <td className="border-b border-line p-2 num" dir="ltr">
                          {split.surplus}
                        </td>
                        <td className="border-b border-line p-2">
                          {stockSettlementStatusLabel(row.stockSettlementStatus ?? '')}
                        </td>
                        <td className="border-b border-line p-2">
                          {shortagePolicyStatusLabel(row.shortagePolicyStatus ?? null)}
                        </td>
                        <td className="border-b border-line p-2">
                          <div className="flex flex-wrap gap-1">
                            {canSubmitClosing(row) && canSubmit ? (
                              <Button onClick={() => pick(row, 'submit')} size="sm" variant="secondary">
                                تقديم إقفال
                              </Button>
                            ) : null}
                            {canApproveClosing(row) && canApprove ? (
                              <Button onClick={() => pick(row, 'approve')} size="sm">
                                اعتماد
                              </Button>
                            ) : null}
                            {canSettleStock(row) && canApprove ? (
                              <Button onClick={() => pick(row, 'settle')} size="sm" variant="secondary">
                                استكمال التسوية
                              </Button>
                            ) : null}
                            {canCloseTransitDifference(row) && canManageLoad ? (
                              <Button onClick={() => pick(row, 'transit')} size="sm" variant="secondary">
                                فرق العبور
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="m-0 mt-2 text-[12px] text-muted">
            العمود «متبقٍ» في هذا الجدول هو <strong>الفائض</strong> عن المستندات (فرق جردٍ سالب) —
            لا يُدمج مع العجز ولا مع التالف، ولا يُقلب إيراداً أو هدية: يُسجَّل في مستند الجرد
            الرسمي بإقرارٍ صريح.
          </p>
        </CardBody>
      </Card>

      {/* 🧾 ما رُحِّل من ذمم — دليلٌ لا وصف */}
      <Card>
        <CardHeader
          subtitle="من أعمدة van_load_orders نفسها (shortage_charge_amount / shortage_charge_basis / shortage_journal_entry_id): ما رُحِّل فعلاً وبأيّ أساس، لا ما تقوله السياسة اليوم."
          title="عيون العهدة: ما اعتُمد وما رُحِّل"
        />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="text-muted">
                  <th className="border-b border-line p-2 text-start font-bold">الأمر</th>
                  <th className="border-b border-line p-2 text-start font-bold">الحالة</th>
                  <th className="border-b border-line p-2 text-start font-bold">سياسة العجز</th>
                  <th className="border-b border-line p-2 text-start font-bold">علم التحميل</th>
                  <th className="border-b border-line p-2 text-start font-bold">العجز</th>
                  <th className="border-b border-line p-2 text-start font-bold">المبلغ المُرحَّل</th>
                  <th className="border-b border-line p-2 text-start font-bold">الأساس الفعلي</th>
                  <th className="border-b border-line p-2 text-start font-bold">القيد</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((row) => {
                  const proof = chargeEvidence(row);
                  return (
                    <tr key={row.id ?? row.number ?? custodyLabel(row)}>
                      <td className="border-b border-line p-2">{custodyLabel(row)}</td>
                      <td className="border-b border-line p-2" dir="ltr">
                        {row.status ?? '—'}
                      </td>
                      <td className="border-b border-line p-2">
                        {shortagePolicyStatusLabel(row.shortagePolicyStatus ?? null)}
                      </td>
                      <td className="border-b border-line p-2">
                        {row.salaryDeductionApproved === true ? 'معتمد صراحةً' : 'لم يُعتمد'}
                      </td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.shortageQty)}
                      </td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {proof ? proof.amount : '—'}
                      </td>
                      <td className="border-b border-line p-2">{proof ? proof.basisText : '—'}</td>
                      <td className="border-b border-line p-2" dir="ltr">
                        {proof ? proof.journalEntryId.slice(0, 8) : '—'}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td className="border-b border-line p-2 text-muted" colSpan={8}>
                      لا صفوف في اللوحة بعد {loading ? '(جارٍ القراءة…)' : ''}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          subtitle="مستند الجرد الرسمي مطلق: يضبط رصيد السيارة على العدد المُعلن، وفرقه يُحسب من الرصيد الرسمي لحظة الترحيل — بينما فرق الاعتماد محسوبٌ من عهدة هذا الأمر وحده. فما زاد خرج من المخزون إلى حساب التسويات ولم يقع في عهدة أحد، والخادم نفسه يكتبه تحذيراً في stock_settlement_note. والأرقام هنا أرقامه، لا تقدير الشاشة."
          title={`تدقيق مستندات الجرد: ما امتصّه المستند خارج أمره (${absorbedAudits.length})`}
        />
        <CardBody>
          {absorbedAudits.length === 0 ? (
            <p className="m-0 text-[13px] leading-relaxed text-muted">
              لا مستند جردٍ مُرحَّل امتصّ حركةً خارج أمره. وما لم يُرحَّل بعد لا يُعرض هنا كأنّه
              مُرحَّل: غياب أرقام المستند عن الصفّ يعني مسودةً أو أمراً لم يُسوَّ مخزونياً.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-muted">
                    <th className="border-b border-line p-2 text-right font-bold">الأمر</th>
                    <th className="border-b border-line p-2 text-right font-bold">
                      رصيد السيارة عند الترحيل
                    </th>
                    <th className="border-b border-line p-2 text-right font-bold">فرق المستند (كمية)</th>
                    <th className="border-b border-line p-2 text-right font-bold">قيمته</th>
                    <th className="border-b border-line p-2 text-right font-bold">فرق الاعتماد</th>
                    <th className="border-b border-line p-2 text-right font-bold">الممتصّ خارج الأمر</th>
                    <th className="border-b border-line p-2 text-right font-bold">ملاحظة الخادم</th>
                  </tr>
                </thead>
                <tbody>
                  {absorbedAudits.map(({ row, audit }) => (
                    <tr key={row.id}>
                      <td className="border-b border-line p-2">{custodyLabel(row)}</td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {audit.documentExpectedText}
                      </td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {audit.documentVarianceQtyText}
                      </td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {audit.documentVarianceValueText}
                      </td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {audit.approvedVarianceText}
                      </td>
                      <td className="border-b border-line p-2 num font-extrabold text-warn-ink" dir="ltr">
                        {audit.absorbedQtyText}
                      </td>
                      <td className="border-b border-line p-2 text-muted">{audit.noteText ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ✍️ لوحة الإجراء — الأثر قبل الضغط */}
      {selected && actionKind ? (
        <Card>
          <CardHeader
            subtitle={`${ACTION_LABELS[actionKind]} · ${selected.number ?? selected.id} · ${
              ACTION_ROUTES[actionKind](selected.id ?? '')
            }`}
            title={custodyLabel(selected)}
          />
          <CardBody>
            <div className="grid gap-3">
              {separation ? (
                <div className="grid gap-2 rounded-[10px] border border-line bg-surface p-3 text-[12.5px] md:grid-cols-4">
                  <span className="font-bold text-ink">
                    مرتجع سليم: <span dir="ltr">{separation.returned}</span>
                  </span>
                  <span className="font-bold text-ink">
                    تالف: <span dir="ltr">{separation.damaged}</span>
                  </span>
                  <span className="font-bold text-ink">
                    عجز: <span dir="ltr">{separation.shortage}</span>
                  </span>
                  <span className="font-bold text-ink">
                    متبقٍ فعلي: <span dir="ltr">{separation.actualRemaining}</span>
                  </span>
                  <span className="text-muted">
                    مباع <span dir="ltr">{separation.sold}</span> + بونص{' '}
                    <span dir="ltr">{separation.bonus}</span> — المتوقع{' '}
                    <span dir="ltr">{separation.expectedRemaining}</span> — فرق الجرد{' '}
                    <span dir="ltr">{separation.countVariance}</span>
                    {separation.hasSurplus ? ` (منه فائض ${separation.surplus})` : ''}
                  </span>
                  {cash ? (
                    <span className="text-muted">
                      النقد: محصَّل <span dir="ltr">{cash.collected}</span> / متوقع{' '}
                      <span dir="ltr">{cash.expected}</span> / فرق{' '}
                      <span dir="ltr">{cash.variance}</span>
                    </span>
                  ) : null}
                  {selected.damageReason ? (
                    <span className="text-muted">سبب التلف كما كتبه المندوب: {selected.damageReason}</span>
                  ) : null}
                  {unsettled ? (
                    <span className="rounded-[8px] border border-warn-line bg-warn-soft px-2 py-1 font-semibold text-warn-ink">
                      ⚠️ {unsettled}
                    </span>
                  ) : null}
                  {selectedAudit?.absorbed ? (
                    <span className="rounded-[8px] border border-warn-line bg-warn-soft px-2 py-1 font-semibold text-warn-ink">
                      ⚠️ مستند الجرد امتصّ <span dir="ltr">{selectedAudit.absorbedQtyText}</span> كجم
                      خارج هذا الأمر — رصيد السيارة عند الترحيل{' '}
                      <span dir="ltr">{selectedAudit.documentExpectedText}</span> مقابل فرقٍ معتمد{' '}
                      <span dir="ltr">{selectedAudit.approvedVarianceText}</span>
                    </span>
                  ) : null}
                  {selected.vehicleCountQty === null || selected.vehicleCountQty === undefined ? null : (
                    <span className="text-muted">
                      🚐 عُدّت السيارة كلها: <span dir="ltr">{numberText(selected.vehicleCountQty)}</span>{' '}
                      كجم، منها <span dir="ltr">{numberText(selected.otherCustodyQty)}</span> كجم
                      عهدةُ أوامرَ أخرى ⇒ نصيبُ هذه العهدة{' '}
                      <span dir="ltr">{numberText(selected.actualRemainingQty)}</span> كجم.
                    </span>
                  )}
                  {coverage?.warning ? (
                    <span
                      className={
                        coverage.tone === 'danger'
                          ? 'rounded-[8px] border border-danger-line bg-danger-soft px-2 py-1 font-semibold text-danger-ink'
                          : 'rounded-[8px] border border-warn-line bg-warn-soft px-2 py-1 font-semibold text-warn-ink'
                      }
                    >
                      🚐 {coverage.warning}
                    </span>
                  ) : coverage?.open ? (
                    <span className="text-muted">
                      🚐 الرصيد الرسمي للسيارة <span dir="ltr">{coverage.officialText}</span> كجم —
                      يغطي عهدة هذا الأمر، ولا عهدةَ أخرى في السيارة.
                    </span>
                  ) : null}
                </div>
              ) : null}

              {actionKind === 'transit' ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-[12.5px] font-bold text-ink">
                    قرار فرق العبور
                    <select
                      className={selectClass}
                      onChange={(event) => setTransitMode(event.target.value)}
                      value={transitMode}
                    >
                      <option value="return">return — إرجاع الباقي إلى المصدر</option>
                      <option value="shortage">shortage — عجز تحويل رسمي</option>
                    </select>
                  </label>
                  <Input
                    hint="قرارٌ ماليّ صريح ينفّذه محرّك المخزون بقيوده وحساباته من ملف الترحيل."
                    label="سبب القرار"
                    onChange={(event) => setTransitReason(event.target.value)}
                    value={transitReason}
                  />
                  <p className="m-0 text-[12.5px] text-muted">
                    الفرق عند الاستلام: <span dir="ltr">{numberText(selected.discrepancyQty)}</span>{' '}
                    — ولا تُغلق العهدة وفرقُ العبور معلّق (`{LOAD_PERMISSION}`).
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    dir="ltr"
                    hint={
                      actionKind === 'submit'
                        ? 'ما عاد سليماً إلى المستودع — يُسجَّل بمناقلة رسمية.'
                        : 'ما قدّمه المندوب؛ للمحاسب تصحيحه إن عدّ بنفسه.'
                    }
                    label="مرتجع سليم (كجم)"
                    onChange={(event) => setClosing({ ...closing, returnedQty: event.target.value })}
                    value={closing.returnedQty}
                  />
                  <Input
                    dir="ltr"
                    hint="بلا سببٍ واضح يرفض الخادم 422 (إحالةٌ للفحص الفعلي)."
                    label="تالف (كجم)"
                    onChange={(event) => setClosing({ ...closing, damagedQty: event.target.value })}
                    value={closing.damagedQty}
                  />
                  <Input
                    hint="إلزامي مع أيّ كمية تالفة — نصّ الخادم لا نصّنا."
                    label="سبب التلف"
                    onChange={(event) => setClosing({ ...closing, damageReason: event.target.value })}
                    value={closing.damageReason}
                  />
                  <Input
                    dir="ltr"
                    label="النقد المحصَّل"
                    onChange={(event) => setClosing({ ...closing, collectedCash: event.target.value })}
                    value={closing.collectedCash}
                  />
                  <Input
                    dir="ltr"
                    hint="قرار المالك: العددُ للسيارة كلها. يطرح الخادم عهدةَ الأوامر الأخرى ويشتقّ نصيبَ هذه العهدة، ويُرسل مستند الجرد بالعدد كله — فلا يُشطب ما لا تملكه هذه العهدة. فارغ ⇒ عددٌ لهذا الأمر وحده (السلوك السابق)."
                    label="عددُ الصنف في السيارة كلها (كجم)"
                    onChange={(event) =>
                      setClosing({ ...closing, vehicleCountQty: event.target.value })
                    }
                    value={closing.vehicleCountQty ?? ''}
                  />
                  <Input
                    dir="ltr"
                    hint={
                      countPreview?.declared
                        ? 'يُشتقّ منه نصيبُ هذه العهدة — لا يُرسل للخادم مع عدد السيارة (جمعهما يُرفض 422).'
                        : 'الرقم الذي يُقاس به العجز/الفائض. فارغ ⇒ لا جردَ مكتوباً (ولا يُفترض صفر).'
                    }
                    label="المتبقي الفعلي بالجرد (كجم)"
                    onChange={(event) =>
                      setClosing({ ...closing, actualRemainingQty: event.target.value })
                    }
                    value={closing.actualRemainingQty}
                  />
                  {countPreview?.declared ? (
                    <p
                      className={
                        countPreview.belowOtherCustody
                          ? 'm-0 rounded-[8px] border border-danger-line bg-danger-soft px-2 py-1 text-[12.5px] font-semibold leading-relaxed text-danger-ink md:col-span-2'
                          : 'm-0 rounded-[8px] border border-line bg-surface px-2 py-1 text-[12.5px] leading-relaxed text-muted md:col-span-2'
                      }
                    >
                      🚐 {countPreview.note} وفرقُها{' '}
                      <span dir="ltr">{countPreview.varianceText}</span> كجم (
                      {VARIANCE_KIND_LABELS[countPreview.varianceKind]}).
                    </p>
                  ) : null}
                  {actionKind === 'submit' ? (
                    <Input
                      label="ملاحظات الإقفال"
                      onChange={(event) => setClosing({ ...closing, closingNotes: event.target.value })}
                      value={closing.closingNotes}
                    />
                  ) : (
                    <label className="grid gap-1 text-[12.5px] font-bold text-ink">
                      مصير المتبقي الفعلي (إلزامي إن وُجد)
                      <select
                        className={selectClass}
                        onChange={(event) => setRemainingAction(event.target.value)}
                        value={remainingAction}
                      >
                        <option value="">— لم يُحدَّد —</option>
                        {REMAINING_ACTIONS.map((action) => (
                          <option key={action} value={action}>
                            {remainingActionLabel(action)} ({action})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}

              {actionKind === 'approve' || actionKind === 'settle' ? (
                <div className="grid gap-2 rounded-[10px] border border-line bg-surface p-3">
                  <label className={checkClass}>
                    <input
                      checked={flags.damageInspected}
                      onChange={(event) =>
                        setFlags({ ...flags, damageInspected: event.target.checked })
                      }
                      type="checkbox"
                    />
                    تأكّد الفحص الفعلي للتالف (بلا تأكيدٍ وكميةٍ تالفة يرفض الخادم 422)
                  </label>
                  <label className={checkClass}>
                    <input
                      checked={flags.settleStockAdjustment}
                      onChange={(event) =>
                        setFlags({ ...flags, settleStockAdjustment: event.target.checked })
                      }
                      type="checkbox"
                    />
                    تفويض ترحيل مستند الجرد الرسمي (بدونه يبقى مسودةً وتبقى العهدة معلّقة)
                  </label>
                  <label className={checkClass}>
                    <input
                      checked={flags.surplusAcknowledged}
                      onChange={(event) =>
                        setFlags({ ...flags, surplusAcknowledged: event.target.checked })
                      }
                      type="checkbox"
                    />
                    إقرارٌ صريح بفائض الجرد عن العهدة (يُرفض الرقم بدونه حمايةً من خطأ الإدخال)
                  </label>
                  <label className={checkClass}>
                    <input
                      checked={flags.selfApprovalOverride}
                      onChange={(event) =>
                        setFlags({ ...flags, selfApprovalOverride: event.target.checked })
                      }
                      type="checkbox"
                    />
                    تجاوز منع الاعتماد الذاتي (يُكتب في سجلّ التدقيق)
                  </label>

                  {/* ⚖️ القرار الماليّ: أثرُه قبل الضغط لا بعده بخطأ. */}
                  <div className="mt-1 grid gap-1 rounded-[10px] border border-warn-line bg-warn-soft p-3">
                    <label className={checkClass}>
                      <input
                        checked={flags.salaryDeductionApproved}
                        onChange={(event) =>
                          setFlags({ ...flags, salaryDeductionApproved: event.target.checked })
                        }
                        type="checkbox"
                      />
                      تحميل العجز على المندوب — <strong>مديونية موظف</strong> تُرحَّل قيداً
                    </label>
                    {preview ? (
                      <div className="grid gap-1 text-[12.5px] text-warn-ink">
                        <span>
                          العجز <span dir="ltr">{numberText(selected.shortageQty)}</span> كجم · القيمة
                          بحسب السياسة <span dir="ltr">{preview.amountText}</span> · وعلى أساس
                          التكلفة <span dir="ltr">{preview.costValueText}</span>
                        </span>
                        <span>
                          الأساس المتوقع: {summary.sourceText} · المدين: {preview.debitText} · الدائن:{' '}
                          {preview.creditText}
                        </span>
                        <span>
                          {preview.posted
                            ? 'قيدٌ مُرحَّل من قبل — تُعرض نتيجته أدناه ولا يُعاد ترحيله (مفتاح عدم تكرار).'
                            : preview.willPost
                              ? 'سيُرحَّل قيدٌ واحد عند هذا الاعتماد — وبلا هذا العلم لا يُرحَّل شيء.'
                              : 'لن يُرحَّل أيّ قيد: العلم غير مرفوع (أو لا عجز في هذا الأمر).'}
                        </span>
                        {evidence ? (
                          <span>
                            الدليل المُرحَّل: <span dir="ltr">{evidence.amount}</span> · الأساس{' '}
                            {evidence.basisText} · قيد <span dir="ltr">{evidence.journalEntryId}</span>
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {blockers.length > 0 ? (
                      <div className="grid gap-1 text-[12.5px] font-semibold text-danger-ink">
                        {blockers.map((text) => (
                          <span key={text}>⛔ {text}</span>
                        ))}
                        <span className="font-normal text-muted">
                          الخادم يرفض الاعتماد 422 ما دام هذا المانع قائماً — ولا تُغلق العهدة بنصف
                          كتابة.
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <Input
                    label="ملاحظات الاعتماد"
                    onChange={(event) => setNotes(event.target.value)}
                    value={notes}
                  />
                </div>
              ) : null}

              {actionError ? (
                <p
                  className="m-0 rounded-[10px] border border-danger-line bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger-ink"
                  role="alert"
                >
                  {actionError}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={busy} onClick={() => void runAction()} size="sm">
                  {busy ? 'جارٍ التنفيذ…' : ACTION_LABELS[actionKind]}
                </Button>
                <Button disabled={busy} onClick={closeAction} size="sm" variant="secondary">
                  إغلاق
                </Button>
                <span className="text-[12px] text-muted">
                  {actionKind === 'submit'
                    ? `POST · ${SUBMIT_PERMISSION}`
                    : actionKind === 'transit'
                      ? `POST · ${LOAD_PERMISSION}`
                      : `POST · ${APPROVE_PERMISSION}`}{' '}
                  — والحكم النهائي للخادم.
                </span>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </section>
  );
}
