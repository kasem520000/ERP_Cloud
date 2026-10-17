'use client';

import { useMemo, useState } from 'react';
import { Button, Card, CardBody, CardHeader, Input, Kpi, Select, type SortState } from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';
import { useSubmissionKey } from '@erp/web-core/use-submission-key';
import {
  openVanDocumentPrintWindow,
  type VanDocumentPrintView,
} from '@erp/web-van/document-print';

import { DataTable, Notice } from '../../components/data-view';
import { Screen } from '../../components/screen';
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
  buildDocumentPayload,
  buildReturnPayload,
  DASHBOARD_WINDOW_NOTE,
  DOCUMENT_COLUMNS,
  documentCellText,
  documentKindLabel,
  documentRemainingText,
  documentViewRows,
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
  type DocumentViewRow,
  type ReturnDraft,
  type SalesDashboard,
} from '../../lib/sales-screen';
import { useQuery } from '../../lib/use-query';
import { listState, rowKeyFrom, tableColumns } from '../../lib/ui-kit';

/** الصلاحيات كما يفرضها الخادم على كلّ مسارٍ تستعمله هذه الشاشة (`@RequiresPermission`). */
const VIEW_PERMISSION = 'van_sales.view';
const CREATE_PERMISSION = 'van_sales.invoice.create';

const checkClass = 'flex items-start gap-2 text-[12.5px] font-semibold text-ink';

type MutationNotice = { kind: 'ok' | 'danger' | 'warn'; text: string };

function emptyReturnDraft(): ReturnDraft {
  return { documentId: '', returnedQty: '', reason: '', notes: '' };
}

/**
 * 🧾 شاشة «فواتير الخطّ» — إصدار مستند بيعٍ من عهدة مندوب، ومرتجعه، وطباعة نسختيه.
 *
 * أربع قواعد أمانة تحكمها (وهي نفسها في شاشتي التوزيع وإقفال العهدة):
 *   1. **سندٌ واحد بنسختين، لا فاتورتان.** الطباعة من `GET /van-sales/documents/:id/print-view`
 *      ومُصيِّرها `@erp/web-van/document-print` — المُصيِّر نفسه الذي تطبع به لوحة staff،
 *      حرفًا بحرف: الخادم يقرّر عدد النسخ ونوع كلّ نسخة، والأرقام أرقامه (لا يُعاد حساب
 *      إجماليٍّ أو ضريبة هنا)، ورمز ZATCA يُرسم من الحمولة الصادرة على الفاتورة وحدها؛ فإن
 *      لم تصدر يُطبع قولٌ صريح بدل مربّعٍ زائف.
 *   2. **نصوص الرفض نصوصُ الخادم.** ما يُقال قبل الضغط منقولٌ من `createDocument` و
 *      `createReturnDocument` (‏`lib/sales-screen.ts` ‏`SALES_MESSAGES`)، وتقيسه اختبارات الـAPI
 *      من طرفه. وما لا يستطيع المتصفّح حسابه كحساب الخادم (المتبقي في العهدة بعد كلّ
 *      المستندات المعلّقة، ومجموع مرتجعات المستند، وسقف الائتمان) **تحذيرٌ** يُقال معه إنّ
 *      الحكم النهائي للخادم — لا حظرٌ يمنع بيعًا صحيحًا بحجّة نافذةٍ ناقصة.
 *   3. **الضابط في الخادم.** الصلاحيات تُقرأ كي لا تُعرض شاشةٌ سيُرفض طلبها، لكن إخفاء الزرّ
 *      ليس ضبطًا للوصول: فالتجاوز (سعر/خصم/بونص) يُرسل علمُه فقط حين يُقصد، والخادم يفحص
 *      الرمزين (`van_sales.override.approve` أو `sales.discount.override`) ويرفض 403.
 *   4. **لا رقمَ مختلَع.** الجدول صفوف `documents` من `GET /van-sales/dashboard` كما هي (أحدث
 *      ١٢٠ مستندًا — ويُقال ذلك)، والمتبقي على الفاتورة يُحسب بـ`decimal.js` ويُسمّى محسوبًا،
 *      ومجاميع اليوم من `summary` الذي حسبه الخادم، والحالة غير المعروفة تُعرض خامًا،
 *      والغائب «—» لا صفر.
 *
 * وما **ليس** هنا: الإيصال الحراريّ ٨٠مم (بقي في `apps/staff`)، والأستاذ وتفصيل القيود
 * وأرصدة الصناديق وتسعير العملاء (في `apps/staff`)، وإقفال العهدة (وحدة `/custody`)،
 * وتحميل العهدة (وحدة `/distribution`).
 *
 * والتنظيم كما في `apps/staff`: غلافُ الشاشة من `Screen`، والطلب من `useQuery`
 * (لا يُرسل طلبٌ بلا صلاحية — والسبب موثّقٌ أدناه)، والتغذيةُ الراجعة من `Notice`،
 * والجدول من `DataTable` عبر `lib/ui-kit.ts`، والقوائم من `Select`.
 */
export default function SalesPage() {
  const { can } = useSession();
  const canView = can(VIEW_PERMISSION);
  const canCreate = can(CREATE_PERMISSION);
  const canOverride = OVERRIDE_PERMISSIONS.some((code) => can(code));

  /**
   * اللوحةُ بطلبٍ واحد — ولا يُرسل الطلبُ بلا صلاحيةٍ (٤٠٣ محتوم): فالخادمُ
   * هو الضابط، وهذه الواجهة لا تستطلع رأيه بلا وجه. وحين يُمنح الحسابُ
   * الصلاحيةَ لاحقًا يُعيد `useQuery` الطلبَ بعينه (`canView` في الاعتماديات).
   */
  const board = useQuery<SalesDashboard | undefined>(
    () => (canView ? apiData<SalesDashboard>('/van-sales/dashboard') : Promise.resolve(undefined)),
    [canView],
  );
  /** القائمتان auxiliary: فشلُ كلٍّ منهما يُقال في `lookupWarning` ولا يُسقط الشاشة. */
  const partiesQuery = useQuery<PartyOption[]>(
    () => (canView ? apiList<PartyOption>('/parties?kind=customer') : Promise.resolve([])),
    [canView],
  );
  const cashLocationsQuery = useQuery<CashLocationOption[]>(
    () => (canView ? apiList<CashLocationOption>('/cash-locations') : Promise.resolve([])),
    [canView],
  );
  const parties = useMemo(() => partiesQuery.data ?? [], [partiesQuery.data]);
  const cashLocations = useMemo(
    () => cashLocationsQuery.data ?? [],
    [cashLocationsQuery.data],
  );

  const [draft, setDraft] = useState<DocumentDraft>(emptyDocumentDraft);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<MutationNotice | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [returnDraft, setReturnDraft] = useState<ReturnDraft>(emptyReturnDraft);
  const [returnOpen, setReturnOpen] = useState(false);
  /** فرزُ جدول المستندات — حالةٌ يملكها العميل لا الخادم (ترتيبُ الخادم هو الافتراضي). */
  const [documentSort, setDocumentSort] = useState<SortState>(null);

  // 🔁 مفتاحٌ لكلّ نيّة: إعادة الإرسال بعد انقطاع الشبكة ترجع بالمستند نفسه (الخادم يفرد
  // ‏`van_sales_documents.idempotency_key`) بدل فاتورةٍ ثانية وخصمٍ ثانٍ من العهدة.
  // والنمط «الحمولة لحظة الإرسال» (`key(payload)`) لا «المسودة المتتبَّعة» — فلا يُخلطان.
  const documentKey = useSubmissionKey('van-document');
  const returnKey = useSubmissionKey('van-return');

  const dashboard = board.data;
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
  const documentRows = useMemo(() => documentViewRows(documents), [documents]);

  const lookupWarning = useMemo(() => {
    const missing: string[] = [];
    if (partiesQuery.status === 'error') missing.push('العملاء');
    if (cashLocationsQuery.status === 'error') missing.push('الصناديق النقدية');
    return missing.length > 0
      ? `تعذّر جلب ${missing.join(' و')} — تحتاج صلاحية القراءة أو أنّ الخادم رفض. الشاشة تعرض ما وصلها فقط: فيبقى البيع النقديّ بلا اسم عميلٍ مُسجَّل، ويبقى الصندوق غير مُسمًّى فيأخذ الخادم صندوق الفرع الافتراضيّ.`
      : undefined;
  }, [partiesQuery.status, cashLocationsQuery.status]);

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
      documentKey.reset();
      // ‏الاستجابة هي اللوحة كاملة، وأحدثُ مستندٍ هو `documents[0]` منها (ترتيب الخادم
      // ‏`created_at DESC`) — ولا يُخترع رقمُ مستندٍ في المتصفّح أبدًا. تُقرأ هنا
      // لبطاقةِ النجاح، واللوحةُ تُعاد قراءتُها من الخادم كما يفعل staff.
      const newest = next.documents[0] ?? null;
      setSelectedId(newest?.id);
      setDraft(emptyDocumentDraft());
      setNotice({
        kind: 'ok',
        text: newest
          ? `أُصدر المستند ${newest.number} — ${invoiceModeLabel(newest.invoiceMode)}، ${paymentMethodLabel(newest.paymentMethod)}، الإجمالي ${newest.total} والمدفوع ${newest.paidAmount}. الفاتورة الرسمية: ${newest.invoiceNumber ?? '—'} (${invoiceStatusLabel(newest.invoiceStatus)}). وطباعة النسختين من صفّه أدناه.`
          : 'رجعت اللوحة من الخادم بلا مستندٍ جديد في أوّل صفوفها — حدِّث واقرأ ما أُصدر فعلًا.',
      });
      void board.reload();
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
        text: `فُتحت نافذة الطباعة: ${view.copiesCount} نسخةً من المستند ${view.documentNumber} — مستندٌ واحد بنسختين (للعميل، وللمندوب تعود موقّعة إلى المحاسب)، لا فاتورتان. والأرقام من الخادم.`
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
      returnKey.reset();
      // ‏كما في الإصدار: أحدثُ مستندٍ من استجابة اللوحة، والجدول يُعاد تحميله.
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
      void board.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذّر تسجيل المرتجع') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      actions={
        <>
          <span className="bak-badge">POST /van-sales/documents</span>
          <Button
            disabled={board.status === 'loading' || !canView}
            onClick={() => void board.reload()}
            size="sm"
          >
            تحديث
          </Button>
        </>
      }
      subtitle="مستند بيعٍ من عهدة مندوب: سندٌ واحد بنسختين مطبوعتين — نسخة للعميل ونسخة للمندوب تعود موقّعة إلى المحاسب — لا فاتورتان. ورمز ZATCA يُرسم من الحمولة الصادرة على الفاتورة، فإن لم تصدر يُطبع قولٌ صريح بدل رمزٍ زائف. والأستاذ وتفصيل القيود في staff."
      title="فواتير الخطّ"
    >
      <Notice
        notice={
          !canView
            ? {
                kind: 'warn',
                text: `🔒 لا تملك \`${VIEW_PERMISSION}\` — والخادم يرفض قراءة لوحة المبيعات وطباعة أيّ مستند. ولم يُرسل هذا التطبيق طلبًا سيُرفض حتمًا، ولا عرض أرقامًا من المتصفّح بدلها.`,
              }
            : undefined
        }
      />

      {board.status === 'error' ? (
        <Card>
          <CardBody>
            <p
              className="m-0 rounded-[10px] border border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger-ink"
              role="alert"
            >
              تعذّر تحميل بيانات المبيعات: {board.error}
            </p>
            <p className="m-0 mt-2 text-[12.5px] text-muted">
              السبب المعتاد: لا تملك <span dir="ltr">{VIEW_PERMISSION}</span>، أو أنّ الـAPI غير
              متاح من هذه الواجهة. ولا تُعرض مستنداتٌ بديلة من المتصفّح.
            </p>
            <Button className="mt-3" onClick={() => void board.reload()} size="sm">
              إعادة المحاولة
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <Notice notice={lookupWarning ? { kind: 'warn', text: lookupWarning } : undefined} />

      <Notice notice={notice} />

      {dashboard ? (
        <Card>
          <CardHeader
            subtitle={windowNote(dashboard.windows, 'documents', DASHBOARD_WINDOW_NOTE)}
            title="اليوم بأرقام الخادم"
          />
          <CardBody>
            <div className="m-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Kpi
                hint="صافي المرتجعات — من summary الذي حسبه الخادم"
                title="مبيعات ضريبية (ZATCA)"
                tone="brand"
                value={numberText(dashboard.summary.totalZatcaSalesSar)}
              />
              <Kpi
                hint="تسليمٌ داخليّ بلا ضريبة"
                title="تسليم داخليّ"
                tone="neutral"
                value={numberText(dashboard.summary.totalInternalSalesSar)}
              />
              <Kpi
                hint="سندات قبضٍ مُرحَّلة إلى الأستاذ"
                title="محصَّل نقدًا"
                tone="ok"
                value={numberText(dashboard.summary.totalCollectedCashSar)}
              />
              <Kpi
                hint="بعد خصم المدفوع — يزيد الصندوق ولا يعرف الأستاذ إن لم يُرحَّل السند"
                title="ذمم العملاء الآجلة"
                tone={Number(dashboard.summary.totalCreditReceivablesSar) > 0 ? 'warn' : 'neutral'}
                value={numberText(dashboard.summary.totalCreditReceivablesSar)}
              />
              <Kpi
                hint="إشعارات دائنة — تُخصم من ذمّة العميل كما يخصمها القيد"
                title="مردودات المبيعات"
                tone="neutral"
                value={numberText(dashboard.summary.totalReturnsSar)}
              />
              <Kpi
                hint="ضريبةُ المرتجعات المعكوسة على الإجمالي"
                title="ضريبة المرتجعات"
                tone="neutral"
                value={numberText(dashboard.summary.totalReturnsVatSar)}
              />
            </div>
            <p className="m-0 mt-3 text-[12.5px] text-muted">
              مبيع {numberText(dashboard.summary.totalSoldKg)} كجم · مجانيّ{' '}
              {numberText(dashboard.summary.totalBonusKg)} كجم · صافي الربح{' '}
              <span dir="ltr">{numberText(dashboard.summary.totalNetProfitSar)}</span> · تنبيهات
              الرقابة {numberText(dashboard.summary.anomalyCount)} — وكلّها من{' '}
              <span dir="ltr">summary</span> الذي حسبه الخادم، لا من جمع صفوف الجدول أدناه.
            </p>
            {dashboard.summary.returnDocumentCount > 0 ? (
              <p className="m-0 mt-2 text-[12.5px] text-muted">
                ↩️ الأرقامُ أعلاه صافيةٌ من المرتجعات: إجماليُّ المبيعات{' '}
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
              <Notice notice={{ kind: 'warn', text: `⚠️ ${dashboard.postingReadiness.message}` }} />
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {canView && !canCreate ? (
        <Card>
          <CardBody>
            <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] font-semibold text-warn-ink">
              🔒 تملك القراءة (<span dir="ltr">{VIEW_PERMISSION}</span>) لا الإصدار (
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
                <Select
                  label="عهدة المندوب (أمر التحميل / الدفعة)"
                  onChange={(event) => pickLoadOrder(event.target.value)}
                  options={saleable.map((row) => ({
                    label: `${row.number} — ${row.salesmanName} · ${row.itemName} · متبقٍّ ${loadOrderRemaining(row).toFixed(2)} كجم · ${row.productionBatchNo}`,
                    value: row.id ?? '',
                  }))}
                  placeholder="— اختر أمر التحميل —"
                  value={draft.loadOrderId}
                />

                <Select
                  label="العميل (أو بيعٌ نقديّ بلا بطاقة)"
                  onChange={(event) => patchDraft({ partyId: event.target.value })}
                  options={parties.map((row) => ({
                    label: partyLabel(row),
                    value: row.id,
                  }))}
                  placeholder="— عميل نقديّ (بلا بطاقة) —"
                  value={draft.partyId}
                />
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
                  🏷️ اتفاقُ هذا العميل على هذا الصنف ({agreement.priceTierLabel}): السعر{' '}
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
                <Select
                  label="طريقة الدفع"
                  onChange={(event) =>
                    patchDraft({ paymentMethod: event.target.value as DocumentDraft['paymentMethod'] })
                  }
                  options={[
                    { label: 'نقدًا — يُسجَّل مدفوعًا بالكامل', value: 'cash' },
                    { label: 'شبكة — يُسجَّل مدفوعًا بالكامل', value: 'card' },
                    { label: 'آجل — يبقى دينًا على العميل', value: 'credit' },
                  ]}
                  value={draft.paymentMethod}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <Select
                  label="نوع المستند"
                  onChange={(event) =>
                    patchDraft({ invoiceMode: event.target.value as DocumentDraft['invoiceMode'] })
                  }
                  options={[
                    { label: 'فاتورة ضريبية إلكترونية (ZATCA)', value: 'zatca_tax' },
                    { label: 'إشعار تسليم / توزيع داخلي', value: 'internal_delivery' },
                  ]}
                  value={draft.invoiceMode}
                />
                <Select
                  label="الصندوق النقديّ (للنقد والشبكة)"
                  onChange={(event) => patchDraft({ cashLocationId: event.target.value })}
                  options={cashLocations.map((row) => ({
                    label: cashLocationLabel(row),
                    value: row.id,
                  }))}
                  placeholder="— صندوق الفرع الافتراضيّ —"
                  value={draft.cashLocationId}
                />
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

              {verdict.blocked.map((line) => (
                <Notice key={line} notice={{ kind: 'danger', text: `⛔ ${line}` }} />
              ))}
              {verdict.warnings.map((line) => (
                <Notice key={line} notice={{ kind: 'warn', text: `⚠️ ${line}` }} />
              ))}

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
                  الإرسال بعد انقطاع الشبكة لا يُصدر مستندًا ثانيًا.
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
          <DataTable<DocumentViewRow>
            actions={(row) => [
              { label: 'تفاصيل', onClick: () => setSelectedId(row.id) },
              { label: '🖨️ نسختان', onClick: () => void printCopies(row.id) },
              ...(row.documentKind === 'sale' && canCreate
                ? [{ label: '↩️ مرتجع', onClick: () => openReturn(row) }]
                : []),
            ]}
            columns={tableColumns<DocumentViewRow>(DOCUMENT_COLUMNS, documentCellText)}
            dense
            empty={
              <span className="m-0 text-[13px] text-muted">
                لا مستند بيع بعد{canCreate ? ' — أصدر الأوّل أعلاه' : ''}. ولا يُعرض هنا رقمٌ
                تجريبيّ.
              </span>
            }
            onSortChange={setDocumentSort}
            pageSize={25}
            rowKey={rowKeyFrom(['id', 'number'])}
            rows={documentRows}
            sort={documentSort}
            sortable
            state={listState({
              loading: board.status === 'loading',
              error: board.status === 'error' ? board.error : undefined,
            })}
            storageKey="bakery-sales-documents"
          />
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
                🖨️ طباعة نسختي المستند
              </Button>
              {selected.documentKind === 'sale' && canCreate ? (
                <Button onClick={() => openReturn(selected)} size="sm" type="button" variant="secondary">
                  ↩️ تسجيل مرتجع
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
                  <Notice key={line} notice={{ kind: 'danger', text: `⛔ ${line}` }} />
                ))}
                {returnJudgement.warnings.map((line) => (
                  <Notice key={line} notice={{ kind: 'warn', text: `⚠️ ${line}` }} />
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
    </Screen>
  );
}
