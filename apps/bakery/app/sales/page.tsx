'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, CardBody, CardHeader, Input } from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';
import { useSubmissionKey } from '@erp/web-core/use-submission-key';
import {
  openVanDocumentPrintWindow,
  type VanDocumentPrintView,
} from '@erp/web-van/document-print';

import {
  cashLocationLabel,
  numberText,
  partyLabel,
  partyTaxNo,
  type CashLocationOption,
  type PartyOption,
} from '../../lib/lookups';
import { windowNote } from '../../lib/dashboard-windows';
import {
  anomalyNote,
  buildDocumentPayload,
  buildReturnPayload,
  DASHBOARD_WINDOW_NOTE,
  documentKindLabel,
  documentRemainingText,
  documentVerdict,
  emptyDocumentDraft,
  invoiceModeLabel,
  invoiceStatusLabel,
  loadOrderBlockReason,
  loadOrderRemaining,
  OVERRIDE_PERMISSIONS,
  paymentMethodLabel,
  priceAgreement,
  returnableNow,
  returnCeiling,
  returnVerdict,
  SALES_MESSAGES,
  saleableLoadOrders,
  type DocumentDraft,
  type DocumentRow,
  type ReturnDraft,
  type SalesDashboard,
} from '../../lib/sales-screen';

/** الصلاحيات كما يفرضها الخادم على كلّ مسارٍ تستعمله هذه الشاشة (`@RequiresPermission`). */
const VIEW_PERMISSION = 'van_sales.view';
const CREATE_PERMISSION = 'van_sales.invoice.create';

const selectClass = 'w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink';
const checkClass = 'flex items-start gap-2 text-[12.5px] font-semibold text-ink';

type Notice = { kind: 'ok' | 'danger' | 'warn'; text: string };

const NOTICE_CLASSES: Record<Notice['kind'], string> = {
  ok: 'border-ok-line bg-ok-soft text-ok-ink',
  danger: 'border-danger-line bg-danger-soft text-danger-ink',
  warn: 'border-warn-line bg-warn-soft text-warn-ink',
};

function emptyReturnDraft(): ReturnDraft {
  return { documentId: '', returnedQty: '', reason: '', notes: '' };
}

/**
 * شاشة «فواتير الخطّ» — إصدار مستند بيعٍ من عهدة مندوب، ومرتجعه، وطباعة نسختيه.
 *
 * أربع قواعد أمانة تحكمها (وهي نفسها في شاشتي التوزيع وإقفال العهدة):
 *   1. **سندٌ واحد بنسختين، لا فاتورتان.** الطباعة من `GET /van-sales/documents/:id/print-view`
 * ومُصيِّرها `@erp/web-van/document-print` — المُصيِّر نفسه الذي تطبع به لوحة staff،
 * حرفًا بحرف: الخادم يقرّر عدد النسخ ونوع كلّ نسخة، والأرقام أرقامه (لا يُعاد حساب
 * إجماليٍّ أو ضريبة هنا)، ورمز ZATCA يُرسم من الحمولة الصادرة على الفاتورة وحدها؛ فإن
 * لم تصدر يُطبع قولٌ صريح بدل مربّعٍ زائف.
 *   2. **نصوص الرفض نصوصُ الخادم.** ما يُقال قبل الضغط منقولٌ من `createDocument` و
 *      `createReturnDocument` (‏`lib/sales-screen.ts` ‏`SALES_MESSAGES`)، وتقيسه اختبارات الـAPI
 * من طرفه. وما لا يستطيع المتصفّح حسابه كحساب الخادم (المتبقي في العهدة بعد كلّ
 * المستندات المعلّقة، ومجموع مرتجعات المستند، وسقف الائتمان) **تحذيرٌ** يُقال معه إنّ
 * الحكم النهائي للخادم — لا حظرٌ يمنع بيعًا صحيحًا بحجّة نافذةٍ ناقصة.
 *   3. **الضابط في الخادم.** الصلاحيات تُقرأ كي لا تُعرض شاشةٌ سيُرفض طلبها، لكن إخفاء الزرّ
 * ليس ضبطًا للوصول: فالتجاوز (سعر/خصم/بونص) يُرسل علمُه فقط حين يُقصد، والخادم يفحص
 * الرمزين (`van_sales.override.approve` أو `sales.discount.override`) ويرفض 403.
 *   4. **لا رقمَ مختلَع.** الجدول صفوف `documents` من `GET /van-sales/dashboard` كما هي (أحدث
 * ١٢٠ مستندًا — ويُقال ذلك)، والمتبقي على الفاتورة يُحسب بـ`decimal.js` ويُسمّى محسوبًا،
 * ومجاميع اليوم من `summary` الذي حسبه الخادم، والحالة غير المعروفة تُعرض خامًا،
 * والغائب «—» لا صفر.
 *
 * وما **ليس** هنا: الإيصال الحراريّ ٨٠مم (بقي في `apps/staff`)، والأستاذ وتفصيل القيود
 * وأرصدة الصناديق وتسعير العملاء (في `apps/staff`)، وإقفال العهدة (وحدة `/custody`)،
 * وتحميل العهدة (وحدة `/distribution`).
 */
export default function SalesPage() {
  const { can } = useSession();
  const canView = can(VIEW_PERMISSION);
  const canCreate = can(CREATE_PERMISSION);
  const canOverride = OVERRIDE_PERMISSIONS.some((code) => can(code));

  const [dashboard, setDashboard] = useState<SalesDashboard | undefined>();
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [cashLocations, setCashLocations] = useState<CashLocationOption[]>([]);
  const [lookupWarning, setLookupWarning] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState<DocumentDraft>(emptyDocumentDraft);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [returnDraft, setReturnDraft] = useState<ReturnDraft>(emptyReturnDraft);
  const [returnOpen, setReturnOpen] = useState(false);

  // مفتاحٌ لكلّ نيّة: إعادة الإرسال بعد انقطاع الشبكة ترجع بالمستند نفسه (الخادم يفرد
  // ‏`van_sales_documents.idempotency_key`) بدل فاتورةٍ ثانية وخصمٍ ثانٍ من العهدة.
  // والنمط «الحمولة لحظة الإرسال» (`key(payload)`) لا «المسودة المتتبَّعة» — فلا يُخلطان.
  const documentKey = useSubmissionKey('van-document');
  const returnKey = useSubmissionKey('van-return');

  const load = useCallback(async (): Promise<SalesDashboard | undefined> => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const board = await apiData<SalesDashboard>('/van-sales/dashboard');
      setDashboard(board);

      // ‏القوائم المساندة: فشلها لا يُسقط الشاشة، بل يُقال صراحةً ماذا ينقص.
      const [partiesResult, cashResult] = await Promise.allSettled([
        apiList<PartyOption>('/parties?kind=customer'),
        apiList<CashLocationOption>('/cash-locations'),
      ]);
      const missing: string[] = [];
      if (partiesResult.status === 'fulfilled') setParties(partiesResult.value);
      else missing.push('العملاء');
      if (cashResult.status === 'fulfilled') setCashLocations(cashResult.value);
      else missing.push('الصناديق النقدية');
      setLookupWarning(
        missing.length > 0
          ? `تعذّر جلب ${missing.join(' و')} — تحتاج صلاحية القراءة أو أنّ الخادم رفض. الشاشة تعرض ما وصلها فقط: فيبقى البيع النقديّ بلا اسم عميلٍ مُسجَّل، ويبقى الصندوق غير مُسمًّى فيأخذ الخادم صندوق الفرع الافتراضيّ.`
          : undefined,
      );
      return board;
    } catch (caught) {
      setLoadError(apiErrorText(caught, 'تعذّر تحميل بيانات المبيعات'));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  // ‏بلا `van_sales.view` لا يُرسل طلبٌ سيُرفض حتمًا (403): يُقال للمستخدم سببُ الفراغ.
  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    void load();
  }, [canView, load]);

  const documents = dashboard?.documents ?? [];
  const loadOrders = dashboard?.loadOrders ?? [];
  const saleable = useMemo(() => saleableLoadOrders(loadOrders), [loadOrders]);
  /** أوامرٌ في اللوحة لا يُباع منها الآن — تُقال أسبابُها فلا يختفي أمرٌ بلا تفسير. */
  const blockedLoadOrders = useMemo(
    () =>
      loadOrders
        .map((row) => ({ row, reason: loadOrderBlockReason(row) }))
        .filter((entry): entry is { row: (typeof loadOrders)[number]; reason: string } => entry.reason !== null)
        .slice(0, 4),
    [loadOrders],
  );

  const pickedLoadOrder = loadOrders.find((row) => row.id === draft.loadOrderId) ?? null;
  const pickedParty = parties.find((row) => row.id === draft.partyId) ?? null;
  const agreement = useMemo(
    () => priceAgreement(dashboard?.customerPrices ?? [], draft.partyId, pickedLoadOrder?.itemId ?? null),
    [dashboard?.customerPrices, draft.partyId, pickedLoadOrder?.itemId],
  );
  const verdict = useMemo(
    () => documentVerdict(draft, { dashboard, canOverride }),
    [draft, dashboard, canOverride],
  );
  const selected = documents.find((row) => row.id === selectedId) ?? null;
  const returnJudgement = useMemo(() => returnVerdict(returnDraft, documents), [returnDraft, documents]);

  function patchDraft(next: Partial<DocumentDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  /** اختيار العهدة: يُملأ السعر من اتفاق العميل إن كان، ولا يُكتب فوق ما قصده المشرف. */
  function pickLoadOrder(id: string) {
    const row = loadOrders.find((order) => order.id === id) ?? null;
    const agreed = row ? priceAgreement(dashboard?.customerPrices ?? [], draft.partyId, row.itemId) : null;
    patchDraft({ loadOrderId: id });
    if (agreed) {
      setDraft((current) =>
        current.unitPrice.trim().length > 0 ? current : { ...current, unitPrice: agreed.unitPrice },
      );
    }
  }

  async function submitDocument() {
    if (verdict.blocked.length > 0) {
      setNotice({ kind: 'danger', text: verdict.blocked[0] ?? 'تعذّر إصدار المستند' });
      return;
    }
    setBusy(true);
    setNotice(undefined);
    const payload = buildDocumentPayload(draft);
    try {
      const next = await apiPost<SalesDashboard>('/van-sales/documents', {
        ...payload,
        idempotencyKey: documentKey.key(payload),
      });
      setDashboard(next);
      documentKey.reset();
      // ‏الاستجابة هي اللوحة كاملة، وأحدثُ مستندٍ هو `documents[0]` منها (ترتيب الخادم
      // ‏`created_at DESC`) — ولا يُخترع رقمُ مستندٍ في المتصفّح أبدًا.
      const newest = next.documents[0] ?? null;
      setSelectedId(newest?.id);
      setDraft(emptyDocumentDraft());
      setNotice({
        kind: 'ok',
        text: newest
          ? `أُصدر المستند ${newest.number} — ${invoiceModeLabel(newest.invoiceMode)}، ${paymentMethodLabel(newest.paymentMethod)}، الإجمالي ${newest.total} والمدفوع ${newest.paidAmount}. الفاتورة الرسمية: ${newest.invoiceNumber ?? '—'} (${invoiceStatusLabel(newest.invoiceStatus)}). وطباعة النسختين من صفّه أدناه.`
          : 'رجعت اللوحة من الخادم بلا مستندٍ جديد في أوّل صفوفها — حدِّث واقرأ ما أُصدر فعلًا.',
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذّر إصدار مستند البيع') });
    } finally {
      setBusy(false);
    }
  }

  async function printCopies(documentId: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      const view = await apiData<VanDocumentPrintView>(
        `/van-sales/documents/${documentId}/print-view?copies=2`,
      );
      if (!openVanDocumentPrintWindow(view)) {
        setNotice({
          kind: 'danger',
          text: 'لم يفتح المتصفّح نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذه الواجهة ثمّ أعد المحاولة.',
        });
        return;
      }
      setNotice({
        kind: 'ok',
        text: `فُتحت نافذة الطباعة: ${view.copiesCount} نسخةً من المستند ${view.documentNumber} — مستندٌ واحد بنسختين (للعميل، وللمندوب تعود موقّعة إلى المحاسب)، لا فاتورتان. والأرقام من الخادم.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذّر تجهيز نسخة الطباعة') });
    } finally {
      setBusy(false);
    }
  }

  function openReturn(row: DocumentRow) {
    setSelectedId(row.id);
    setReturnDraft({ ...emptyReturnDraft(), documentId: row.id });
    setReturnOpen(true);
  }

  async function submitReturn() {
    if (returnJudgement.blocked.length > 0) {
      setNotice({ kind: 'danger', text: returnJudgement.blocked[0] ?? 'تعذّر تسجيل المرتجع' });
      return;
    }
    setBusy(true);
    setNotice(undefined);
    const payload = buildReturnPayload(returnDraft);
    try {
      const next = await apiPost<SalesDashboard>(
        `/van-sales/documents/${returnDraft.documentId}/returns`,
        { ...payload, idempotencyKey: returnKey.key({ documentId: returnDraft.documentId, ...payload }) },
      );
      setDashboard(next);
      returnKey.reset();
      const newest = next.documents[0] ?? null;
      setSelectedId(newest?.id);
      setReturnDraft(emptyReturnDraft());
      setReturnOpen(false);
      setNotice({
        kind: 'ok',
        text: newest
          ? `سُجِّل مستند المرتجع ${newest.number} (${newest.soldQty} كجم). وأثرُه في العهدة والأستاذ يُقرأ من حركات اللوحة، وتفصيلُ القيود في staff.`
          : 'رجعت اللوحة من الخادم بلا مرتجعٍ في أوّل صفوفها — حدِّث واقرأ ما سُجِّل فعلًا.',
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذّر تسجيل المرتجع') });
    } finally {
      setBusy(false);
    }
  }

  return (
 <section className="grid gap-4">
 <header className="flex flex-wrap items-end justify-between gap-3">
 <div className="min-w-0">
 <h1 className="m-0 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
 فواتير الخطّ
 </h1>
 <p className="m-0 mt-1 text-[13px] text-muted">
 مستند بيعٍ من عهدة مندوب: <strong>سندٌ واحد بنسختين مطبوعتين</strong> — نسخة للعميل
 ونسخة للمندوب تعود موقّعة إلى المحاسب — لا فاتورتان. ورمز ZATCA يُرسم من الحمولة
 الصادرة على الفاتورة، فإن لم تصدر يُطبع قولٌ صريح بدل رمزٍ زائف. والأستاذ وتفصيل
 القيود في <span dir="ltr">staff</span>.
 </p>
 </div>
 <div className="flex items-center gap-2">
 <span className="bak-badge">POST /van-sales/documents</span>
 <Button disabled={loading || !canView} onClick={() => void load()} size="sm">
 تحديث
 </Button>
 </div>
 </header>

      {!canView ? (
 <Card>
 <CardBody>
 <p className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.warn}`}>
 لا تملك <span dir="ltr">{VIEW_PERMISSION}</span> — والخادم يرفض قراءة لوحة
 المبيعات وطباعة أيّ مستند. ولم يُرسل هذا التطبيق طلبًا سيُرفض حتمًا، ولا عرض
 أرقامًا من المتصفّح بدلها.
 </p>
 </CardBody>
 </Card>
      ) : null}

      {loadError ? (
 <Card>
 <CardBody>
 <p
              className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.danger}`}
              role="alert"
            >
 تعذّر تحميل بيانات المبيعات: {loadError}
 </p>
 <p className="m-0 mt-2 text-[12.5px] text-muted">
 السبب المعتاد: لا تملك <span dir="ltr">{VIEW_PERMISSION}</span>، أو أنّ الـAPI غير
 متاح من هذه الواجهة. ولا تُعرض مستنداتٌ بديلة من المتصفّح.
 </p>
 <Button className="mt-3" onClick={() => void load()} size="sm">
 إعادة المحاولة
 </Button>
 </CardBody>
 </Card>
      ) : null}

      {lookupWarning ? (
 <p className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.warn}`}>
          {lookupWarning}
 </p>
      ) : null}

      {notice ? (
 <p
          className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES[notice.kind]}`}
          role={notice.kind === 'danger' ? 'alert' : 'status'}
        >
          {notice.text}
 </p>
      ) : null}

      {dashboard ? (
 <Card>
 <CardHeader
            subtitle={windowNote(dashboard.windows, 'documents', DASHBOARD_WINDOW_NOTE)}
            title="اليوم بأرقام الخادم"
          />
 <CardBody>
 <dl className="m-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
 <div className="rounded-[10px] border border-line bg-surface p-3">
 <dt className="m-0 text-[11.5px] font-bold text-muted">مبيعات ضريبية (ZATCA)</dt>
 <dd className="m-0 mt-1 text-[17px] font-extrabold text-ink" dir="ltr">
                  {numberText(dashboard.summary.totalZatcaSalesSar)}
 </dd>
 </div>
 <div className="rounded-[10px] border border-line bg-surface p-3">
 <dt className="m-0 text-[11.5px] font-bold text-muted">تسليم داخليّ</dt>
 <dd className="m-0 mt-1 text-[17px] font-extrabold text-ink" dir="ltr">
                  {numberText(dashboard.summary.totalInternalSalesSar)}
 </dd>
 </div>
 <div className="rounded-[10px] border border-line bg-surface p-3">
 <dt className="m-0 text-[11.5px] font-bold text-muted">محصَّل نقدًا</dt>
 <dd className="m-0 mt-1 text-[17px] font-extrabold text-ink" dir="ltr">
                  {numberText(dashboard.summary.totalCollectedCashSar)}
 </dd>
 </div>
 <div className="rounded-[10px] border border-line bg-surface p-3">
 <dt className="m-0 text-[11.5px] font-bold text-muted">ذمم العملاء الآجلة</dt>
 <dd className="m-0 mt-1 text-[17px] font-extrabold text-ink" dir="ltr">
                  {numberText(dashboard.summary.totalCreditReceivablesSar)}
 </dd>
 </div>
              {/**
                * ↩ طرفا المرتجعات ظاهران بجانب الأرقام الصافية: فالأرقامُ الأربعة أعلاه
                * صافيةٌ من المرتجعات (معالجةُ الخادم في `VAN_MONEY_SQL`، ومرجعُها قيودُ
                * المرتجع الرسمية)، ورقمٌ صافٍ بلا طرفَيه يُقرأ كأنّ المرتجع لم يحدث.
                */}
 <div className="rounded-[10px] border border-line bg-surface p-3">
 <dt className="m-0 text-[11.5px] font-bold text-muted">مردودات المبيعات</dt>
 <dd className="m-0 mt-1 text-[17px] font-extrabold text-ink" dir="ltr">
                  {numberText(dashboard.summary.totalReturnsSar)}
 </dd>
 </div>
 <div className="rounded-[10px] border border-line bg-surface p-3">
 <dt className="m-0 text-[11.5px] font-bold text-muted">ضريبةُ المرتجعات المعكوسة</dt>
 <dd className="m-0 mt-1 text-[17px] font-extrabold text-ink" dir="ltr">
                  {numberText(dashboard.summary.totalReturnsVatSar)}
 </dd>
 </div>
 </dl>
 <p className="m-0 mt-3 text-[12.5px] text-muted">
 مبيع {numberText(dashboard.summary.totalSoldKg)} كجم · مجانيّ{' '}
              {numberText(dashboard.summary.totalBonusKg)} كجم · صافي الربح{' '}
 <span dir="ltr">{numberText(dashboard.summary.totalNetProfitSar)}</span> · تنبيهات
 الرقابة {numberText(dashboard.summary.anomalyCount)} — وكلّها من{' '}
 <span dir="ltr">summary</span> الذي حسبه الخادم، لا من جمع صفوف الجدول أدناه.
 </p>
            {dashboard.summary.returnDocumentCount > 0 ? (
 <p className="m-0 mt-2 text-[12.5px] text-muted">
 الأرقامُ أعلاه صافيةٌ من المرتجعات: إجماليُّ المبيعات{' '}
 <span dir="ltr">{numberText(dashboard.summary.totalSalesGrossSar)}</span> −
 مرتجعات <span dir="ltr">{numberText(dashboard.summary.totalReturnsSar)}</span>{' '}
 وضريبتُها{' '}
 <span dir="ltr">{numberText(dashboard.summary.totalReturnsVatSar)}</span> ·{' '}
                {numberText(dashboard.summary.returnDocumentCount)} مستند مرتجع
                {dashboard.summary.returnsWithoutCostCount > 0
                  ? `، منها ${numberText(dashboard.summary.returnsWithoutCostCount)} إشعارُه الدائن غير مُرحَّل فتكلفتُه مجهولةٌ ولم يُخصم له أثرٌ في الربح`
                  : ''}
                .
 </p>
            ) : null}
            {dashboard.postingReadiness.message ? (
 <p className={`m-0 mt-3 rounded-[10px] border px-4 py-2.5 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
 {dashboard.postingReadiness.message}
 </p>
            ) : null}
 </CardBody>
 </Card>
      ) : null}

      {canView && !canCreate ? (
 <Card>
 <CardBody>
 <p className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.warn}`}>
 تملك القراءة (<span dir="ltr">{VIEW_PERMISSION}</span>) لا الإصدار (
 <span dir="ltr">{CREATE_PERMISSION}</span>) — فتُعرض المستندات وتُطبع نسختاها، ولا
 يُرسل إصدارٌ سيُرفض 403.
 </p>
 </CardBody>
 </Card>
      ) : null}

      {canCreate ? (
 <Card>
 <CardHeader
            subtitle="الحقول كما يقرأها الخادم في POST /van-sales/documents. ونصوص الرفض نصوصُه حرفًا؛ وما يُقال تحذيرًا ممّا لا يستطيع المتصفّح حسابه كحسابه يُرسل مع ذلك، فالخادم هو الذي يُصدر المستند أو يرفضه."
            title="إصدار مستند بيع من عهدة مندوب"
          />
 <CardBody>
 <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitDocument();
              }}
            >
 <div className="grid gap-3 md:grid-cols-2">
 <label className="grid gap-1 text-[12.5px] font-bold text-ink">
 عهدة المندوب (أمر التحميل / الدفعة)
 <select
                    className={selectClass}
                    onChange={(event) => pickLoadOrder(event.target.value)}
                    value={draft.loadOrderId}
                  >
 <option value="">— اختر أمر التحميل —</option>
                    {saleable.map((row) => (
 <option key={row.id} value={row.id}>
                        {row.number} — {row.salesmanName} · {row.itemName} · متبقٍّ{' '}
                        {loadOrderRemaining(row).toFixed(2)} كجم · {row.productionBatchNo}
 </option>
                    ))}
 </select>
 </label>

 <label className="grid gap-1 text-[12.5px] font-bold text-ink">
 العميل (أو بيعٌ نقديّ بلا بطاقة)
 <select
                    className={selectClass}
                    onChange={(event) => patchDraft({ partyId: event.target.value })}
                    value={draft.partyId}
                  >
 <option value="">— عميل نقديّ (بلا بطاقة) —</option>
                    {parties.map((row) => (
 <option key={row.id} value={row.id}>
                        {partyLabel(row)}
 </option>
                    ))}
 </select>
 </label>
 </div>

              {blockedLoadOrders.length > 0 ? (
 <p className="m-0 text-[12px] text-muted">
 أوامرٌ في اللوحة لا يُباع منها الآن: {blockedLoadOrders.length} — منها{' '}
                  {blockedLoadOrders
                    .map((entry) => `${entry.row.number} (${entry.reason})`)
                    .join(' · ')}
 </p>
              ) : null}

              {pickedLoadOrder ? (
 <p className="m-0 text-[12.5px] text-muted">
 العهدة المختارة: {pickedLoadOrder.number} — {pickedLoadOrder.salesmanName} ·{' '}
                  {pickedLoadOrder.itemName} · الحالة <span className="bak-badge">{pickedLoadOrder.status}</span> ·
 محمّل {numberText(pickedLoadOrder.loadedQty)} ومستلم{' '}
                  {numberText(pickedLoadOrder.receivedQty)} ومبيع {numberText(pickedLoadOrder.soldQty)} +
 مجانيّ {numberText(pickedLoadOrder.bonusQty)} · المتبقي{' '}
 <strong dir="ltr">{loadOrderRemaining(pickedLoadOrder).toFixed(2)}</strong> كجم ·
 سقف البونص على الأمر {numberText(pickedLoadOrder.maxBonusQty)} كجم (
                  {numberText(pickedLoadOrder.maxBonusPct)}%).
 </p>
              ) : null}

              {pickedParty ? (
 <p className="m-0 text-[12.5px] text-muted">
 بطاقة العميل: {partyLabel(pickedParty)} · الرقم الضريبي{' '}
 <span dir="ltr">{numberText(partyTaxNo(pickedParty))}</span> · الجوال{' '}
 <span dir="ltr">{numberText(pickedParty.phone)}</span>
 </p>
              ) : null}

              {agreement ? (
 <p className="m-0 rounded-[10px] border border-line bg-surface px-3 py-2 text-[12.5px] text-ink">
 اتفاقُ هذا العميل على هذا الصنف ({agreement.priceTierLabel}): السعر{' '}
 <span dir="ltr">{agreement.unitPrice}</span> ريال/كجم
                  {agreement.lockPrice ? ' — مثبَّت، والخادم يمنع البيع بأقلّ إلا باعتماد التجاوز' : ''} ·
 سقف الخصم <span dir="ltr">{agreement.maxDiscountPct}%</span> · سقف البونص{' '}
 <span dir="ltr">{agreement.maxBonusPct}%</span> أو{' '}
 <span dir="ltr">{agreement.maxBonusKgPerInvoice}</span> كجم · الحدّ الائتماني{' '}
 <span dir="ltr">{agreement.creditLimit}</span> · الأجل{' '}
                  {numberText(agreement.paymentTermsDays)} يومًا · ويفضّل{' '}
                  {invoiceModeLabel(agreement.preferredInvoiceMode)}.
 </p>
              ) : null}

 <div className="grid gap-3 md:grid-cols-3">
 <Input
                  dir="ltr"
                  hint={`بالكيلو — تُخصم من عهدة المندوب. وبلا كميةٍ يرفض الخادم: «${SALES_MESSAGES.soldQtyRequired}».`}
                  inputMode="decimal"
                  label="الكمية المباعة"
                  onChange={(event) => patchDraft({ soldQty: event.target.value })}
                  placeholder="0.00"
                  value={draft.soldQty}
                />
 <Input
                  dir="ltr"
                  hint={agreement?.lockPrice ? 'السعر المثبَّت في اتفاق العميل مُقترحٌ عليك.' : 'ريال/كجم.'}
                  inputMode="decimal"
                  label="سعر الوحدة"
                  onChange={(event) => patchDraft({ unitPrice: event.target.value })}
                  placeholder="0.00"
                  value={draft.unitPrice}
                />
 <label className="grid gap-1 text-[12.5px] font-bold text-ink">
 طريقة الدفع
 <select
                    className={selectClass}
                    onChange={(event) =>
                      patchDraft({ paymentMethod: event.target.value as DocumentDraft['paymentMethod'] })
                    }
                    value={draft.paymentMethod}
                  >
 <option value="cash">نقدًا — يُسجَّل مدفوعًا بالكامل</option>
 <option value="card">شبكة — يُسجَّل مدفوعًا بالكامل</option>
 <option value="credit">آجل — يبقى دينًا على العميل</option>
 </select>
 </label>
 </div>

 <div className="grid gap-3 md:grid-cols-3">
 <label className="grid gap-1 text-[12.5px] font-bold text-ink">
 نوع المستند
 <select
                    className={selectClass}
                    onChange={(event) =>
                      patchDraft({ invoiceMode: event.target.value as DocumentDraft['invoiceMode'] })
                    }
                    value={draft.invoiceMode}
                  >
 <option value="zatca_tax">فاتورة ضريبية إلكترونية (ZATCA)</option>
 <option value="internal_delivery">إشعار تسليم / توزيع داخلي</option>
 </select>
 </label>
 <label className="grid gap-1 text-[12.5px] font-bold text-ink">
 الصندوق النقديّ (للنقد والشبكة)
 <select
                    className={selectClass}
                    onChange={(event) => patchDraft({ cashLocationId: event.target.value })}
                    value={draft.cashLocationId}
                  >
 <option value="">— صندوق الفرع الافتراضيّ —</option>
                    {cashLocations.map((row) => (
 <option key={row.id} value={row.id}>
                        {cashLocationLabel(row)}
 </option>
                    ))}
 </select>
 </label>
 <Input
                  label="اسم العميل النقديّ"
                  hint="يُستعمل فقط حين لا تُختار بطاقة عميل؛ والفراغ يعني نصّ الخادم «محل تجزئة نقدي»."
                  onChange={(event) => patchDraft({ customerName: event.target.value })}
                  value={draft.customerName}
                />
 </div>

 <div className="grid gap-3 md:grid-cols-4">
 <Input
                  dir="ltr"
                  inputMode="decimal"
                  label="كمية مجانية (بونص)"
                  hint="تُسلَّم بلا قيمةٍ وبلا ضريبة، وتُخصم من المخزون بالتكلفة."
                  onChange={(event) => patchDraft({ bonusQty: event.target.value })}
                  placeholder="0.00"
                  value={draft.bonusQty}
                />
 <Input
                  label="سبب البونص"
                  hint={`إلزاميّ عند الخادم متى كانت الكمية المجانية أكبر من صفر: «${SALES_MESSAGES.bonusReasonRequired}».`}
                  onChange={(event) => patchDraft({ bonusReason: event.target.value })}
                  placeholder="ترويجي / عينات / تعويض تلف"
                  value={draft.bonusReason}
                />
 <Input
                  dir="ltr"
                  inputMode="decimal"
                  label="الخصم (ريال)"
                  onChange={(event) => patchDraft({ discountAmount: event.target.value })}
                  placeholder="0.00"
                  value={draft.discountAmount}
                />
 <Input
                  label="سبب الخصم"
                  onChange={(event) => patchDraft({ discountReason: event.target.value })}
                  value={draft.discountReason}
                />
 </div>

 <div className="grid gap-3 md:grid-cols-2">
 <label className={checkClass}>
 <input
                    checked={draft.customerBonusConfirmed}
                    onChange={(event) => patchDraft({ customerBonusConfirmed: event.target.checked })}
                    type="checkbox"
                  />
 <span>
 العميل أكّد استلام الكمية المجانية — ويُسجَّل تأكيدُه على المستند.
 </span>
 </label>
 <Input
                  dir="ltr"
                  label="رمز تأكيد استلام العميل"
                  hint="تطلبه رقابةُ البونص حين تتجاوز الكمية المجانية سقفَ أمر التحميل."
                  onChange={(event) => patchDraft({ customerConfirmationCode: event.target.value })}
                  value={draft.customerConfirmationCode}
                />
 </div>

              {canOverride ? (
 <div className="grid gap-3 rounded-[10px] border border-warn-line bg-warn-soft p-3 md:grid-cols-2">
 <label className={checkClass}>
 <input
                      checked={draft.allowPriceDiscountOverride}
                      onChange={(event) => patchDraft({ allowPriceDiscountOverride: event.target.checked })}
                      type="checkbox"
                    />
 <span>
 اعتماد تجاوز السعر/الخصم — يُرسل العلم فيسأل الخادم الصلاحية، ويُسجَّل
 الاعتماد على المستند.
 </span>
 </label>
 <label className={checkClass}>
 <input
                      checked={draft.allowBonusOverride}
                      onChange={(event) => patchDraft({ allowBonusOverride: event.target.checked })}
                      type="checkbox"
                    />
 <span>اعتماد تجاوز رقابة البونص (بديل رمز تأكيد العميل).</span>
 </label>
 </div>
              ) : (
 <p className="m-0 text-[12.5px] text-muted">
 تجاوز السعر/الخصم/البونص يحتاج <span dir="ltr">{OVERRIDE_PERMISSIONS[0]}</span> أو{' '}
 <span dir="ltr">{OVERRIDE_PERMISSIONS[1]}</span> — وليست لك، فلا تُرسل الشاشة
 علمَ تجاوزٍ مآله 403. والحكم للخادم على أيّ حال، لا لإخفاء الزرّ.
 </p>
              )}

 <Input
                label="ملاحظات على المستند"
                onChange={(event) => patchDraft({ notes: event.target.value })}
                value={draft.notes}
              />

              {/*
                قائمةُ التحقّق قبل الإصدار. كانت كلُّ ملاحظةٍ صندوقاً أحمرَ بعرض الشاشة، فيصل
                المستندُ الفارغ إلى أربعة صناديقَ حمراء قبل أن يكتب المندوب حرفاً. الآن عنوانٌ
                واحدٌ يقول «كم بنداً ناقص»، وتحته سطورٌ مُرقَّمة بلا إطار — تُقرأ كقائمةِ مهامّ
                لا كأربعِ أخطاءٍ مستقلّة، والنصُّ نفسه (نصُّ الخادم) لم يتغيّر.
              */}
              {verdict.blocked.length > 0 ? (
 <div className={`rounded-[10px] border px-3 py-2.5 ${NOTICE_CLASSES.danger}`}>
 <p className="m-0 flex items-center gap-1.5 text-[12px] font-bold">
                    <span className="grid size-4 flex-none place-items-center rounded-full bg-current/15 text-[10px]">{verdict.blocked.length}</span>
                    لإصدار المستند، أكمل ما يلي
 </p>
 <ol className="m-0 mt-1.5 grid list-none gap-1 ps-0 text-[12px] font-medium leading-relaxed">
                    {verdict.blocked.map((line) => (
 <li key={line} className="flex gap-1.5">
 <span aria-hidden className="mt-[7px] size-1 flex-none rounded-full bg-current/60" />
 <span>{line}</span>
 </li>
                    ))}
 </ol>
 </div>
              ) : null}

              {verdict.warnings.length > 0 ? (
 <div className="grid gap-1.5">
                  {verdict.warnings.map((line) => (
 <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
 {line}
 </p>
                  ))}
 </div>
              ) : null}

 <div className="flex flex-wrap items-center gap-2">
 <Button
                  disabled={busy || verdict.blocked.length > 0}
                  loading={busy}
                  type="submit"
                  variant="primary"
                >
 إصدار المستند
 </Button>
 <Button
                  disabled={busy}
                  onClick={() => {
                    setDraft(emptyDocumentDraft());
                    setNotice(undefined);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
 تفريغ النموذج
 </Button>
 <span className="text-[12px] text-muted">
 مفتاحُ عدم التكرار يُحسب من الحمولة لحظة الإرسال — فالضغط مرّتين أو إعادة
 الإرسال بعد انقطاع الشبكة لا تُصدر مستندًا ثانيًا.
 </span>
 </div>
 </form>
 </CardBody>
 </Card>
      ) : null}

 <Card>
 <CardHeader
          subtitle="صفوف documents من اللوحة كما أرجعها الخادم — والمتبقي (الإجمالي − المدفوع) محسوبٌ هنا للعرض بـdecimal.js، والخادم يتحقّق منه عند سند القبض."
          title={`مستندات الخطّ (${documents.length})`}
        />
 <CardBody>
          {loading ? (
 <p aria-busy="true" className="m-0 text-[13px] text-muted">
 جارٍ تحميل المستندات…
 </p>
          ) : documents.length === 0 ? (
 <p className="m-0 text-[13px] text-muted">
 لا مستند بيع بعد{canCreate ? ' — أصدر الأوّل أعلاه' : ''}. ولا يُعرض هنا رقمٌ
 تجريبيّ.
 </p>
          ) : (
 <div className="bak-table-wrap">
 <table className="bak-table">
 <thead>
 <tr className="text-muted">
 <th className="border-b border-line p-2 text-start font-bold">المستند</th>
 <th className="border-b border-line p-2 text-start font-bold">النوع</th>
 <th className="border-b border-line p-2 text-start font-bold">العميل</th>
 <th className="border-b border-line p-2 text-start font-bold">المندوب</th>
 <th className="border-b border-line p-2 text-start font-bold">الصنف</th>
 <th className="border-b border-line p-2 text-start font-bold">مبيع</th>
 <th className="border-b border-line p-2 text-start font-bold">مجانيّ</th>
 <th className="border-b border-line p-2 text-start font-bold">السعر</th>
 <th className="border-b border-line p-2 text-start font-bold">الإجمالي</th>
 <th className="border-b border-line p-2 text-start font-bold">المدفوع</th>
 <th className="border-b border-line p-2 text-start font-bold">المتبقي</th>
 <th className="border-b border-line p-2 text-start font-bold">الدفع</th>
 <th className="border-b border-line p-2 text-start font-bold">الفاتورة الرسمية</th>
 <th className="border-b border-line p-2 text-start font-bold">إجراء</th>
 </tr>
 </thead>
 <tbody>
                  {documents.map((row) => (
 <tr key={row.id}>
 <td className="border-b border-line p-2">
 <button
                          className="m-0 border-0 bg-transparent p-0 text-[12.5px] font-bold text-ink underline decoration-dotted"
                          onClick={() => setSelectedId(row.id)}
                          type="button"
                        >
                          {row.number}
 </button>
 <div className="text-xs text-muted" dir="ltr">
                          {row.docDate}
 </div>
 </td>
 <td className="border-b border-line p-2">{documentKindLabel(row.documentKind)}</td>
 <td className="border-b border-line p-2">{numberText(row.customerName)}</td>
 <td className="border-b border-line p-2">{numberText(row.salesmanName)}</td>
 <td className="border-b border-line p-2">{numberText(row.itemName)}</td>
 <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.soldQty)}
 </td>
 <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.bonusQty)}
 </td>
 <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.unitPrice)}
 </td>
 <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.total)}
 </td>
 <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.paidAmount)}
 </td>
 <td className="border-b border-line p-2 num" dir="ltr">
                        {documentRemainingText(row)}
 </td>
 <td className="border-b border-line p-2">{paymentMethodLabel(row.paymentMethod)}</td>
 <td className="border-b border-line p-2">
 <span dir="ltr">{numberText(row.invoiceNumber)}</span>
 <div className="text-xs text-muted">{invoiceStatusLabel(row.invoiceStatus)}</div>
 </td>
 <td className="border-b border-line p-2">
 <div className="flex flex-wrap gap-1">
 <Button onClick={() => setSelectedId(row.id)} size="sm" type="button" variant="ghost">
 تفاصيل
 </Button>
 <Button
                            disabled={busy}
                            onClick={() => void printCopies(row.id)}
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
 نسختان
 </Button>
                          {row.documentKind === 'sale' && canCreate ? (
 <Button onClick={() => openReturn(row)} size="sm" type="button" variant="secondary">
 مرتجع
 </Button>
                          ) : null}
 </div>
                        {anomalyNote(row) ? (
 <p className={`m-0 mt-1 rounded-[8px] border px-2 py-1 text-[11.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
 {anomalyNote(row)}
 </p>
                        ) : null}
 </td>
 </tr>
                  ))}
 </tbody>
 </table>
 </div>
          )}
 </CardBody>
 </Card>

      {selected ? (
 <Card>
 <CardHeader
            subtitle="كلّ ما رجعه الخادم عن هذا المستند — بلا حقلٍ مُختلَع. وتفصيل القيود والأستاذ وصندوق النقد في staff."
            title={`المستند ${selected.number}`}
          />
 <CardBody>
 <dl className="m-0 grid gap-3 text-[12.5px] sm:grid-cols-2 lg:grid-cols-3">
 <div>
 <dt className="m-0 font-bold text-muted">النوع وحالة الفاتورة</dt>
 <dd className="m-0">
                  {documentKindLabel(selected.documentKind)} · {invoiceModeLabel(selected.invoiceMode)} ·{' '}
                  {invoiceStatusLabel(selected.invoiceStatus)}
 </dd>
 <dd className="m-0 text-[11.5px] text-muted" dir="ltr">
                  invoice: {numberText(selected.invoiceNumber)} · سياسة الضريبة:{' '}
                  {numberText(selected.taxPolicyStatus)}
 </dd>
 </div>
 <div>
 <dt className="m-0 font-bold text-muted">العميل</dt>
 <dd className="m-0">
                  {numberText(selected.customerName)} · الرقم الضريبي{' '}
 <span dir="ltr">{numberText(selected.customerTaxNo)}</span>
 </dd>
 </div>
 <div>
 <dt className="m-0 font-bold text-muted">المندوب والعهدة</dt>
 <dd className="m-0">
                  {numberText(selected.salesmanName)} · الدفعة{' '}
 <span dir="ltr">{numberText(selected.productionBatchNo)}</span>
 </dd>
 <dd className="m-0 text-[11.5px] text-muted" dir="ltr">
                  loadOrder: {numberText(selected.loadOrderId)}
 </dd>
 </div>
 <div>
 <dt className="m-0 font-bold text-muted">الكميات</dt>
 <dd className="m-0" dir="ltr">
                  {selected.soldQty} + bonus {selected.bonusQty}
                  {selected.bonusReason ? ` (${selected.bonusReason})` : ''}
 </dd>
 <dd className="m-0 text-[11.5px] text-muted">
 سقفُ المرتجع (مبيع + مجانيّ): {returnCeiling(selected).toFixed(2)} · المتاح
 للإرجاع من نافذة اللوحة: {returnableNow(documents, selected).toFixed(2)}
 </dd>
 </div>
 <div>
 <dt className="m-0 font-bold text-muted">القيم</dt>
 <dd className="m-0" dir="ltr">
                  {selected.subtotal} − discount {selected.discountAmount} + vat {selected.taxTotal} (
                  {selected.taxRate}%) = {selected.total}
 </dd>
 <dd className="m-0 text-[11.5px] text-muted" dir="ltr">
                  paid {selected.paidAmount} · remaining {documentRemainingText(selected)} · unitCost{' '}
                  {selected.unitCost} · netProfit {selected.netProfit}
 </dd>
 </div>
 <div>
 <dt className="m-0 font-bold text-muted">الرقابة والتأكيد</dt>
 <dd className="m-0">
 تأكيدُ العميل للبونص: {selected.customerBonusConfirmed ? 'نعم' : 'لا'} · رمز
 التأكيد: <span dir="ltr">{numberText(selected.customerConfirmationCode)}</span>
 </dd>
 <dd className="m-0 text-[11.5px] text-muted">
 حمولة ZATCA على المستند: {selected.qrPayload ? 'موجودة (تُطبع رمزًا)' : 'لا حمولةَ صادرة بعد'}
 </dd>
 </div>
 </dl>

            {selected.notes ? (
 <p className="m-0 mt-3 text-[12.5px] text-muted">ملاحظات المستند: {selected.notes}</p>
            ) : null}

 <div className="mt-3 flex flex-wrap items-center gap-2">
 <Button disabled={busy} onClick={() => void printCopies(selected.id)} size="sm" type="button" variant="primary">
 طباعة نسختي المستند
 </Button>
              {selected.documentKind === 'sale' && canCreate ? (
 <Button onClick={() => openReturn(selected)} size="sm" type="button" variant="secondary">
 تسجيل مرتجع
 </Button>
              ) : null}
 <span className="text-[12px] text-muted">
 الإيصال الحراريّ ٨٠مم في <span dir="ltr">apps/staff</span> — ومُصيِّر هذه الورقة
 الرسميّة مشتركٌ بين اللوحتين.
 </span>
 </div>

            {returnOpen && returnDraft.documentId === selected.id ? (
 <form
                className="mt-4 grid gap-3 rounded-[10px] border border-line bg-surface p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitReturn();
                }}
              >
 <p className="m-0 text-[12.5px] font-bold text-ink">
 مرتجعٌ من {selected.number} — سقفُه (مبيع + مجانيّ){' '}
 <span dir="ltr">{returnCeiling(selected).toFixed(2)}</span> كجم، وما أُرجع سابقًا
 من نافذة اللوحة{' '}
 <span dir="ltr">
                    {(returnCeiling(selected).minus(returnableNow(documents, selected))).toFixed(2)}
 </span>{' '}
 كجم.
 </p>
 <div className="grid gap-3 md:grid-cols-3">
 <Input
                    dir="ltr"
                    inputMode="decimal"
                    label="الكمية المرتجعة"
                    onChange={(event) => setReturnDraft((current) => ({ ...current, returnedQty: event.target.value }))}
                    placeholder="0.00"
                    value={returnDraft.returnedQty}
                  />
 <Input
                    label="سبب المرتجع"
                    hint="بلا سببٍ يُقبل عند الخادم، لكن مرتجعًا بلا سببٍ لا يُراجَع."
                    onChange={(event) => setReturnDraft((current) => ({ ...current, reason: event.target.value }))}
                    value={returnDraft.reason}
                  />
 <Input
                    label="ملاحظات"
                    onChange={(event) => setReturnDraft((current) => ({ ...current, notes: event.target.value }))}
                    value={returnDraft.notes}
                  />
 </div>

                {returnJudgement.blocked.map((line) => (
 <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}>
 {line}
 </p>
                ))}
                {returnJudgement.warnings.map((line) => (
 <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
 {line}
 </p>
                ))}

 <div className="flex flex-wrap items-center gap-2">
 <Button
                    disabled={busy || returnJudgement.blocked.length > 0}
                    loading={busy}
                    type="submit"
                    variant="primary"
                  >
 تسجيل المرتجع
 </Button>
 <Button
                    onClick={() => {
                      setReturnOpen(false);
                      setReturnDraft(emptyReturnDraft());
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
 إلغاء
 </Button>
 <span className="text-[12px] text-muted">
 المرتجع مستندٌ واحد برقمه (documentKind=return) — لا يُلغي مستند البيع ولا
 يُصدر فاتورةً ثانية.
 </span>
 </div>
 </form>
            ) : null}
 </CardBody>
 </Card>
      ) : null}
 </section>
  );
}
