'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, CardBody, CardHeader, Input } from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';
import { useSubmissionKey } from '@erp/web-core/use-submission-key';

import {
  accountLabel,
  cashLocationLabel,
  numberText,
  type AccountOption,
  type CashLocationOption,
} from '../../lib/lookups';
import { windowNote } from '../../lib/dashboard-windows';
import {
  ageDays,
  buildCollectionPayload,
  buildReconciliationPayload,
  COLLECTION_MESSAGES,
  COLLECTION_PERMISSION,
  COLLECTIONS_WINDOW_NOTE,
  collectionOutcome,
  collectionVerdict,
  emptyCollectionDraft,
  emptyReconciliationDraft,
  latestCollectionReceipt,
  movementTypeLabel,
  RECONCILIATION_BATCH_MAX,
  RECONCILIATION_BATCH_MIN,
  RECONCILIATION_PERMISSION,
  reconciliationHeadline,
  reconciliationVerdict,
  receivablesTotal,
  receivableRows,
  remainingText,
  type CollectionDashboard,
  type CollectionDraft,
  type ReconciliationDraft,
  type ReconciliationResult,
} from '../../lib/collection-screen';
import {
  documentRemainingText,
  invoiceModeLabel,
  invoiceStatusLabel,
  paymentMethodLabel,
  type DocumentRow,
} from '../../lib/sales-screen';

/** الصلاحيات كما يفرضها الخادم على المسارات الثلاثة التي تستعملها هذه الشاشة. */
const VIEW_PERMISSION = 'van_sales.view';

const selectClass = 'w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink';

type Notice = { kind: 'ok' | 'danger' | 'warn'; text: string };

const NOTICE_CLASSES: Record<Notice['kind'], string> = {
  ok: 'border-ok-line bg-ok-soft text-ok-ink',
  danger: 'border-danger-line bg-danger-soft text-danger-ink',
  warn: 'border-warn-line bg-warn-soft text-warn-ink',
};

/**
 * 💵 شاشة «التحصيل» — قبضُ مديونية عميل الخطّ، وقراءةُ ما إذا كان السند وصل الأستاذ.
 *
 * القاعدة المحاسبية التي تحكمها: **تحصيلٌ لا يُرحَّل سندُه ليس مالًا في الدفاتر**. والخادم
 * نفسه يقول ذلك: يُنشئ سند قبضٍ ويرحّله فقط حين ينحلّ حساب ذمم العملاء (بطاقةُ العميل ثمّ
 * ملفُّ ترحيل الفرع)، وإلا بقي السند مسودةً وكتب الجملة في سبب الحركة. ولهذا تعرض الشاشة
 * بعد كلّ سندٍ سببَ الحركة **كما كتبه الخادم** وحالته مقروءةً من كلماته («مُرحَّل» /
 * «غير مُرحَّل» / «بدون سند خزينة») — لا استنتاجًا من وجود معرّفٍ للسند، فمسودةُ السند لها
 * معرّفٌ ولم تصل الأستاذ.
 *
 * والأرقام: المتبقي على الفاتورة (الإجمالي − المدفوع) يُحسب بـ`decimal.js` ويُسمّى محسوبًا؛
 * وجملةُ «مبلغ التحصيل يتجاوز الرصيد المتبقي» تُبنى بأرقام الخادم نفسها (`toFixed(2)`)
 * فتنطبق على رفضه حرفًا؛ وأمّا مجموع القائمة فمجموعُ **نافذة اللوحة** (أحدث ١٢٠ مستندًا)،
 * وذممُ المنشأة من `summary.totalCreditReceivablesSar` الذي حسبه الخادم — ورقمان لا يُخلطان.
 *
 * وأداةُ مطابقة البيانات القديمة (‏`POST /van-sales/legacy-reconciliation`) معاينةٌ (`dry_run`)
 * ما لم يُطلب التنفيذ صراحةً، وهي محميّة بـ`van_sales.override.approve` على الوضعين معًا؛ وما
 * لا يُستكمل بأمان يتخطّاه الخادم ولا يحذفه، والتنفيذ يُستأنف من `nextResumeCursor`.
 *
 * وما **ليس** هنا: سندات الخزينة الأخرى وتحويلاتُ الصندوق وأرصدتُه والأستاذ وتفصيل القيود
 * (في `apps/staff`)، وإقفال العهدة وتسوية فرق المخزون (وحدة `/custody`)، وفواتير الخطّ
 * وإصدارها (وحدة `/sales`).
 */
export default function CollectionPage() {
  const { can } = useSession();
  const canView = can(VIEW_PERMISSION);
  const canCollect = can(COLLECTION_PERMISSION);
  const canOverride = can(RECONCILIATION_PERMISSION);

  const [dashboard, setDashboard] = useState<CollectionDashboard | undefined>();
  const [cashLocations, setCashLocations] = useState<CashLocationOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [lookupWarning, setLookupWarning] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState<CollectionDraft>(emptyCollectionDraft);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>();
  /** نتيجةُ آخر سند: حركةُ `collection_receipt` الأحدث من اللوحة التي أرجعها الخادم. */
  const [outcomeMovementId, setOutcomeMovementId] = useState<string | undefined>();

  const [reconDraft, setReconDraft] = useState<ReconciliationDraft>(emptyReconciliationDraft);
  const [reconResult, setReconResult] = useState<ReconciliationResult | null>(null);
  const [reconBusy, setReconBusy] = useState(false);

  // 🔁 مفتاحٌ لكلّ نيّة: إعادة الإرسال بعد انقطاع الشبكة ترجع بالسند نفسه (الخادم يفرد
  // الحركة على `movement_type='collection_receipt'` مع المفتاح) بدل قبضٍ ثانٍ مضاعف.
  const collectionKey = useSubmissionKey('van-collection');

  const load = useCallback(async (): Promise<CollectionDashboard | undefined> => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const board = await apiData<CollectionDashboard>('/van-sales/dashboard');
      setDashboard(board);

      const [cashResult, accountsResult] = await Promise.allSettled([
        apiList<CashLocationOption>('/cash-locations'),
        apiList<AccountOption>('/accounts'),
      ]);
      const missing: string[] = [];
      if (cashResult.status === 'fulfilled') setCashLocations(cashResult.value);
      else missing.push('الصناديق النقدية');
      if (accountsResult.status === 'fulfilled') setAccounts(accountsResult.value);
      else missing.push('دليل الحسابات');
      setLookupWarning(
        missing.length > 0
          ? `تعذّر جلب ${missing.join(' و')} — تحتاج صلاحية القراءة أو أنّ الخادم رفض. فيبقى الصندوق غير مُسمًّى (ويأخذ الخادم صندوق الفرع الافتراضيّ)، ولا يُقترح حسابُ مقابلةٍ يدويّ.`
          : undefined,
      );
      return board;
    } catch (caught) {
      setLoadError(apiErrorText(caught, 'تعذّر تحميل بيانات التحصيل'));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    void load();
  }, [canView, load]);

  const documents = dashboard?.documents ?? [];
  const receivables = useMemo(() => receivableRows(documents), [documents]);
  const listTotal = useMemo(() => receivablesTotal(receivables), [receivables]);
  const picked = receivables.find((row) => row.id === draft.documentId) ?? null;
  const verdict = useMemo(
    () => collectionVerdict(draft, { documents, postingReadiness: dashboard?.postingReadiness }),
    [draft, documents, dashboard?.postingReadiness],
  );
  const outcomeRow = useMemo(
    () => (dashboard?.movements ?? []).find((row) => row.id === outcomeMovementId) ?? null,
    [dashboard?.movements, outcomeMovementId],
  );
  /**
   * حالةُ السند من **تلك الحركة بعينها** لا من «أحدث حركة قبض»: فلو حُدِّثت اللوحة وجاءت
   * بعدها حركةُ قبضٍ أخرى (لمندوبٍ آخر أو شاشةٍ أخرى) لقيل عن سندك ما قيل عن غيره — والبطاقة
   * عن سندك أنت. وإن سقطت الحركة من نافذة اللوحة (٨٠ حركة) اختفت البطاقة بدل أن تُخمِّن.
   */
  const outcome = useMemo(() => collectionOutcome(outcomeRow), [outcomeRow]);
  const reconVerdict = useMemo(
    () => reconciliationVerdict(reconDraft, { canOverride, lastResult: reconResult }),
    [reconDraft, canOverride, reconResult],
  );

  function pickDocument(row: DocumentRow) {
    // ‏المبلغ الافتراضيّ هو المتبقي كلُّه — ويُترك قابلًا للتحرير للتحصيل الجزئيّ.
    setDraft((current) => ({
      ...current,
      documentId: row.id,
      collectedAmount: remainingText(row),
    }));
  }

  async function submitCollection() {
    if (verdict.blocked.length > 0) {
      setNotice({ kind: 'danger', text: verdict.blocked[0] ?? 'تعذّر تسجيل التحصيل' });
      return;
    }
    setBusy(true);
    setNotice(undefined);
    const payload = buildCollectionPayload(draft);
    try {
      const next = await apiPost<CollectionDashboard>('/van-sales/collections', {
        ...payload,
        idempotencyKey: collectionKey.key(payload),
      });
      setDashboard(next);
      collectionKey.reset();
      const receipt = latestCollectionReceipt(next.movements ?? []);
      setOutcomeMovementId(receipt?.id);
      setDraft(emptyCollectionDraft());
      const state = collectionOutcome(receipt);
      setNotice({
        kind: state?.state === 'posted' ? 'ok' : 'warn',
        text: state
          ? `سُجِّل التحصيل (${receipt?.amount ?? '—'} ريال). ${state.label} — ونصُّ الخادم في سبب الحركة: «${state.reason}»`
          : 'رجعت اللوحة من الخادم بلا حركة سند قبض جديدة في أحدث صفوفها — حدِّث واقرأ ما سُجِّل فعلًا، ولا تُعد الإرسال بلا قراءة.',
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذّر تسجيل التحصيل') });
    } finally {
      setBusy(false);
    }
  }

  async function runReconciliation() {
    if (reconVerdict.blocked.length > 0) {
      setNotice({ kind: 'danger', text: reconVerdict.blocked[0] ?? 'تعذّر تشغيل المطابقة' });
      return;
    }
    setReconBusy(true);
    setNotice(undefined);
    const payload = buildReconciliationPayload(reconDraft);
    try {
      const result = await apiPost<ReconciliationResult>('/van-sales/legacy-reconciliation', payload);
      setReconResult(result);
      if (result.execution.nextResumeCursor) {
        setReconDraft((current) => ({ ...current, resumeFromId: result.execution.nextResumeCursor ?? '' }));
      }
      setNotice({
        kind: result.mode === 'execute' ? 'ok' : 'warn',
        text:
          result.mode === 'execute'
            ? `نفّذت الأداةُ دفعةً: ${result.execution.succeededCount} نجح و${result.execution.failedCount} فشل — واقرأ الفاشل وسببه أدناه قبل الدفعة التالية.`
            : 'معاينةٌ بلا كتابة: اقرأ التعارضات والخطة أدناه، فما يحتاج مراجعةً يدويةً لا تُصلحه الأداة.',
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذّر تشغيل أداة المطابقة') });
    } finally {
      setReconBusy(false);
    }
  }

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
            التحصيل
          </h1>
          <p className="m-0 mt-1 text-[13px] text-muted">
            قبضُ مديونية عملاء الخطّ بسند قبضٍ رسمي. والسؤال المحاسبيّ ليس «هل سُجِّل المبلغ؟»
            بل <strong>«هل وصل السند إلى الأستاذ؟»</strong> — فالشاشة تقرأ جواب الخادم من سبب
            الحركة كما كتبه. وتفصيل القيود وأرصدة الصناديق في <span dir="ltr">staff</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="bak-badge">POST /van-sales/collections</span>
          <Button disabled={loading || !canView} onClick={() => void load()} size="sm">
            تحديث
          </Button>
        </div>
      </header>

      {!canView ? (
        <Card>
          <CardBody>
            <p className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.warn}`}>
              🔒 لا تملك <span dir="ltr">{VIEW_PERMISSION}</span> — والخادم يرفض قراءة الذمم
              والحركات. ولم يُرسل هذا التطبيق طلبًا سيُرفض حتمًا، ولا عرض أرقامًا من المتصفّح
              بدلها.
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
              تعذّر تحميل بيانات التحصيل: {loadError}
            </p>
            <p className="m-0 mt-2 text-[12.5px] text-muted">
              السبب المعتاد: لا تملك <span dir="ltr">{VIEW_PERMISSION}</span>، أو أنّ الـAPI غير
              متاح من هذه الواجهة. ولا تُعرض ذممٌ بديلة من المتصفّح.
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
            subtitle={windowNote(dashboard.windows, 'documents', COLLECTIONS_WINDOW_NOTE)}
            title="الذمم بأرقام الخادم"
          />
          <CardBody>
            <dl className="m-0 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[10px] border border-line bg-surface p-3">
                <dt className="m-0 text-[11.5px] font-bold text-muted">ذمم المنشأة (الخادم)</dt>
                <dd className="m-0 mt-1 text-[18px] font-extrabold text-ink" dir="ltr">
                  {numberText(dashboard.summary.totalCreditReceivablesSar)}
                </dd>
              </div>
              <div className="rounded-[10px] border border-line bg-surface p-3">
                <dt className="m-0 text-[11.5px] font-bold text-muted">محصَّل نقدًا (الخادم)</dt>
                <dd className="m-0 mt-1 text-[18px] font-extrabold text-ink" dir="ltr">
                  {numberText(dashboard.summary.totalCollectedCashSar)}
                </dd>
              </div>
              <div className="rounded-[10px] border border-line bg-surface p-3">
                <dt className="m-0 text-[11.5px] font-bold text-muted">
                  مجموع هذه القائمة (محسوبٌ هنا)
                </dt>
                <dd className="m-0 mt-1 text-[18px] font-extrabold text-ink" dir="ltr">
                  {listTotal.toFixed(2)}
                </dd>
                <dd className="m-0 text-[11px] text-muted">{receivables.length} فاتورة آجلة</dd>
              </div>
            </dl>
            {dashboard.postingReadiness.receiptVoucher ? null : (
              <p className={`m-0 mt-3 rounded-[10px] border px-4 py-2.5 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
                ⚠️ ملفُّ ترحيل الفرع لا يغطّي سند القبض: قد يُقبض المال ويبقى السند مسودةً غير
                مُرحَّلة (يلزم حساب ذمم العملاء على بطاقة العميل أو في ملف الترحيل) — فيزيد
                الصندوق ولا يعرف الأستاذ.
                {dashboard.postingReadiness.message ? ` وقولُ الخادم: ${dashboard.postingReadiness.message}` : ''}
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {canView && !canCollect ? (
        <Card>
          <CardBody>
            <p className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.warn}`}>
              🔒 تملك القراءة (<span dir="ltr">{VIEW_PERMISSION}</span>) لا التحصيل (
              <span dir="ltr">{COLLECTION_PERMISSION}</span>) — فتُعرض الذمم، ولا يُرسل سندٌ
              سيُرفض 403.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {canCollect ? (
        <Card>
          <CardHeader
            subtitle="الحقول كما يقرأها الخادم في POST /van-sales/collections. والمحظورات أدناه هي ما يحسبه الخادم بالحساب نفسه؛ وما يُقال تحذيرًا يُرسل معه الطلب، فالخادم هو الذي يقبض أو يرفض."
            title="سند قبض من عميل الخطّ"
          />
          <CardBody>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCollection();
              }}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-[12.5px] font-bold text-ink">
                  الفاتورة الآجلة
                  <select
                    className={selectClass}
                    onChange={(event) => {
                      const row = receivables.find((item) => item.id === event.target.value);
                      if (row) pickDocument(row);
                      else setDraft((current) => ({ ...current, documentId: event.target.value }));
                    }}
                    value={draft.documentId}
                  >
                    <option value="">— اختر الفاتورة —</option>
                    {receivables.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.number} — {row.customerName} · متبقٍّ {remainingText(row)} ·{' '}
                        {row.docDate}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  dir="ltr"
                  hint={`بلا مبلغٍ موجب يرفض الخادم: «${COLLECTION_MESSAGES.documentAndAmountRequired}».`}
                  inputMode="decimal"
                  label="مبلغ التحصيل"
                  onChange={(event) => setDraft((current) => ({ ...current, collectedAmount: event.target.value }))}
                  placeholder="0.00"
                  value={draft.collectedAmount}
                />
              </div>

              {picked ? (
                <p className="m-0 text-[12.5px] text-muted">
                  الفاتورة المختارة: {picked.number} — {picked.customerName} ·{' '}
                  {invoiceModeLabel(picked.invoiceMode)} · {paymentMethodLabel(picked.paymentMethod)} ·
                  الإجمالي <span dir="ltr">{picked.total}</span> والمدفوع{' '}
                  <span dir="ltr">{picked.paidAmount}</span> والمتبقي{' '}
                  <strong dir="ltr">{remainingText(picked)}</strong> (محسوبٌ هنا) · المندوب{' '}
                  {picked.salesmanName} · عمر الدين{' '}
                  {numberText(ageDays(picked) === null ? null : `${ageDays(picked)} يومًا`)} ·
                  الفاتورة الرسمية <span dir="ltr">{numberText(picked.invoiceNumber)}</span> (
                  {invoiceStatusLabel(picked.invoiceStatus)}).
                </p>
              ) : null}

              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-[12.5px] font-bold text-ink">
                  الصندوق الذي قُبض فيه المال
                  <select
                    className={selectClass}
                    onChange={(event) => setDraft((current) => ({ ...current, cashLocationId: event.target.value }))}
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
                <label className="grid gap-1 text-[12.5px] font-bold text-ink">
                  حسابُ المقابلة (اختياريّ — اتركه فارغًا إلا لقصد)
                  <select
                    className={selectClass}
                    onChange={(event) => setDraft((current) => ({ ...current, offsetAccountId: event.target.value }))}
                    value={draft.offsetAccountId}
                  >
                    <option value="">— ترتيب الخادم: ذمم العميل ثمّ ملفّ الترحيل —</option>
                    {accounts.map((row) => (
                      <option key={row.id} value={row.id}>
                        {accountLabel(row)}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  label="ملاحظات السند"
                  onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="تحصيلٌ نقديّ من العميل"
                  value={draft.notes}
                />
              </div>

              {verdict.blocked.map((line) => (
                <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}>
                  ⛔ {line}
                </p>
              ))}
              {verdict.warnings.map((line) => (
                <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
                  ⚠️ {line}
                </p>
              ))}

              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={busy || verdict.blocked.length > 0} loading={busy} type="submit" variant="primary">
                  تسجيل سند القبض
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDraft(emptyCollectionDraft());
                    setNotice(undefined);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  تفريغ النموذج
                </Button>
                <span className="text-[12px] text-muted">
                  مفتاحُ عدم التكرار يُحسب من الحمولة لحظة الإرسال — فإعادة الإرسال بعد انقطاع
                  الشبكة لا تُنشئ سند قبضٍ ثانٍ.
                </span>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {outcomeRow ? (
        <Card>
          <CardHeader
            subtitle="سببُ الحركة كما كتبه الخادم — الدليلُ لا الاستنتاج. وتصنيفُ الحالة مقروءٌ من كلماته."
            title="آخر سند قبضٍ سجّلته هذه الشاشة"
          />
          <CardBody>
            <p
              className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${
                outcome?.state === 'posted' ? NOTICE_CLASSES.ok : NOTICE_CLASSES.warn
              }`}
            >
              {outcome?.label ?? '—'}
            </p>
            <p className="m-0 mt-2 text-[12.5px] text-ink">«{outcomeRow.reason}»</p>
            <dl className="m-0 mt-3 grid gap-3 text-[12.5px] sm:grid-cols-3">
              <div>
                <dt className="m-0 font-bold text-muted">الحركة</dt>
                <dd className="m-0">
                  {movementTypeLabel(outcomeRow.movementType)} · <span dir="ltr">{outcomeRow.amount}</span> ريال
                </dd>
              </div>
              <div>
                <dt className="m-0 font-bold text-muted">السند والصندوق</dt>
                <dd className="m-0" dir="ltr">
                  voucher: {numberText(outcomeRow.voucherId)}
                </dd>
                <dd className="m-0 text-[11.5px] text-muted">
                  الصندوق من القائمة أعلاه؛ ووجودُ معرّفٍ للسند لا يعني ترحيله.
                </dd>
              </div>
              <div>
                <dt className="m-0 font-bold text-muted">من سجّله ومتى</dt>
                <dd className="m-0">
                  {numberText(outcomeRow.actorLabel)} · <span dir="ltr">{outcomeRow.createdAt}</span>
                </dd>
              </div>
            </dl>
            <p className="m-0 mt-3 text-[12px] text-muted">
              {outcome?.state === 'draft'
                ? 'المال قُبض والصندوق زاد، لكن الأستاذ لم يعرف بعد: حدّد حساب ذمم العملاء على بطاقة العميل أو في ملف ترحيل الفرع، ثمّ رحّل السند من شاشة الخزينة في staff.'
                : outcome?.state === 'none'
                  ? 'لم يُنشأ سند خزينة لهذه الحركة: التحصيل مسجَّلٌ على المستند وحده — راجع المحاسب قبل أن يُعدَّ المال مقبوضًا محاسبيًّا.'
                  : outcome?.state === 'posted'
                    ? 'السند مُرحَّل: الصندوق مدينٌ وذمم العميل دائنة، وتفصيلُ القيد في الأستاذ داخل staff.'
                    : 'حالةُ السند غير مقروءة من سبب الحركة — اقرأ السبب كما كتبه الخادم أعلاه ولا تُخمّن.'}
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          subtitle="المستندات الآجلة التي بقي عليها شيء، الأقدم أولًا — فالتحصيل يبدأ من أطول دينٍ عمرًا. والمتبقي محسوبٌ هنا (الإجمالي − المدفوع) ويُتحقّق منه الخادم عند السند."
          title={`ذمم العملاء في نافذة اللوحة (${receivables.length})`}
        />
        <CardBody>
          {loading ? (
            <p aria-busy="true" className="m-0 text-[13px] text-muted">
              جارٍ تحميل الذمم…
            </p>
          ) : receivables.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">
              لا دينَ قائمًا على عملاء الخطّ في نافذة اللوحة — ولا يُعرض هنا رقمٌ تجريبيّ.
              (وذممُ المنشأة كما يقولها الخادم معروضةٌ أعلاه.)
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-muted">
                    <th className="border-b border-line p-2 text-start font-bold">الفاتورة</th>
                    <th className="border-b border-line p-2 text-start font-bold">التاريخ</th>
                    <th className="border-b border-line p-2 text-start font-bold">عمر الدين</th>
                    <th className="border-b border-line p-2 text-start font-bold">العميل</th>
                    <th className="border-b border-line p-2 text-start font-bold">المندوب</th>
                    <th className="border-b border-line p-2 text-start font-bold">الإجمالي</th>
                    <th className="border-b border-line p-2 text-start font-bold">المدفوع</th>
                    <th className="border-b border-line p-2 text-start font-bold">المتبقي</th>
                    <th className="border-b border-line p-2 text-start font-bold">الفاتورة الرسمية</th>
                    <th className="border-b border-line p-2 text-start font-bold">سند قبضٍ سابق</th>
                    <th className="border-b border-line p-2 text-start font-bold">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {receivables.map((row) => (
                    <tr key={row.id}>
                      <td className="border-b border-line p-2" dir="ltr">
                        {row.number}
                      </td>
                      <td className="border-b border-line p-2" dir="ltr">
                        {row.docDate}
                      </td>
                      <td className="border-b border-line p-2">
                        {ageDays(row) === null ? '—' : `${ageDays(row)} يومًا`}
                      </td>
                      <td className="border-b border-line p-2">{numberText(row.customerName)}</td>
                      <td className="border-b border-line p-2">{numberText(row.salesmanName)}</td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.total)}
                      </td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.paidAmount)}
                      </td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        <strong>{documentRemainingText(row)}</strong>
                      </td>
                      <td className="border-b border-line p-2">
                        <span dir="ltr">{numberText(row.invoiceNumber)}</span>
                        <div className="text-[11px] text-muted">{invoiceStatusLabel(row.invoiceStatus)}</div>
                      </td>
                      <td className="border-b border-line p-2" dir="ltr">
                        {numberText(row.receiptVoucherId)}
                      </td>
                      <td className="border-b border-line p-2">
                        {canCollect ? (
                          <Button onClick={() => pickDocument(row)} size="sm" type="button" variant="secondary">
                            💵 تحصيل
                          </Button>
                        ) : (
                          <span className="text-[11.5px] text-muted">بلا صلاحية تحصيل</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          subtitle="أداةُ فحصٍ ومطابقة للبيانات السابقة: معاينةٌ (dry_run) بلا كتابةٍ إطلاقًا، وتنفيذٌ يربط المستندات القديمة بفواتيرها الرسمية ويستأنف من nextResumeCursor. ولا تُصنِّف الأداة سجلًّا باسمه أو تاريخه، ولا تحذف شيئًا: ما لا يُستكمل بأمان يُتخطّى ويُقال سببُه."
          title="مطابقة بيانات التوزيع القديمة"
        />
        <CardBody>
          {!canOverride ? (
            <p className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.warn}`}>
              🔒 المسار محميٌّ بـ<span dir="ltr">{RECONCILIATION_PERMISSION}</span> على الوضعين
              معًا (المعاينة والتنفيذ) — فلا تُرسل الشاشة طلبًا مآله 403.
            </p>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-[12.5px] font-bold text-ink">
                  الوضع
                  <select
                    className={selectClass}
                    onChange={(event) =>
                      setReconDraft((current) => ({
                        ...current,
                        mode: event.target.value === 'execute' ? 'execute' : 'dry_run',
                      }))
                    }
                    value={reconDraft.mode}
                  >
                    <option value="dry_run">معاينة (بلا كتابة)</option>
                    <option value="execute">تنفيذ الدفعة</option>
                  </select>
                </label>
                <Input
                  dir="ltr"
                  hint={`الخادم يقصّها بين ${RECONCILIATION_BATCH_MIN} و${RECONCILIATION_BATCH_MAX}، وافتراضيُّه ٥٠.`}
                  inputMode="numeric"
                  label="حدُّ الدفعة"
                  onChange={(event) => setReconDraft((current) => ({ ...current, batchLimit: event.target.value }))}
                  value={reconDraft.batchLimit}
                />
                <Input
                  dir="ltr"
                  hint="يُملأ تلقائيًّا من nextResumeCursor الذي أرجعته الدفعة السابقة."
                  label="الاستئناف من مستند"
                  onChange={(event) => setReconDraft((current) => ({ ...current, resumeFromId: event.target.value }))}
                  value={reconDraft.resumeFromId}
                />
              </div>

              {reconVerdict.blocked.map((line) => (
                <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}>
                  ⛔ {line}
                </p>
              ))}
              {reconVerdict.warnings.map((line) => (
                <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
                  ⚠️ {line}
                </p>
              ))}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={reconBusy || reconVerdict.blocked.length > 0}
                  loading={reconBusy}
                  onClick={() => void runReconciliation()}
                  type="button"
                  variant={reconDraft.mode === 'execute' ? 'danger' : 'secondary'}
                >
                  {reconDraft.mode === 'execute' ? 'تنفيذ الدفعة' : 'تشغيل المعاينة'}
                </Button>
                <span className="text-[12px] text-muted">
                  المعاينة أولًا دائمًا: فما تُصلحه الأداة ربطُ مستنداتٍ قديمة بفواتيرها، وما
                  تحتاج مراجعتَه يدويًّا يُعرض ولا يُلمس.
                </span>
              </div>

              {reconResult ? (
                <div className="grid gap-3">
                  <p className={`m-0 rounded-[10px] border px-4 py-2.5 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
                    {reconciliationHeadline(reconResult)}
                  </p>
                  <dl className="m-0 grid gap-2 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-[8px] border border-line bg-surface p-2">
                      <dt className="m-0 font-bold text-muted">دفعات الإنتاج</dt>
                      <dd className="m-0" dir="ltr">
                        {reconResult.counts.linkedProductionBatches}/
                        {reconResult.counts.totalProductionBatches} مربوطة · غير مربوطة{' '}
                        {reconResult.counts.unlinkedProductionBatches}
                      </dd>
                    </div>
                    <div className="rounded-[8px] border border-line bg-surface p-2">
                      <dt className="m-0 font-bold text-muted">أوامر التحميل</dt>
                      <dd className="m-0" dir="ltr">
                        {reconResult.counts.linkedLoadOrders}/{reconResult.counts.totalLoadOrders}{' '}
                        مربوطة · بلا سياسة عجز{' '}
                        {reconResult.counts.pendingShortagePolicyOrders}
                      </dd>
                    </div>
                    <div className="rounded-[8px] border border-line bg-surface p-2">
                      <dt className="m-0 font-bold text-muted">المستندات</dt>
                      <dd className="m-0" dir="ltr">
                        {reconResult.counts.linkedDocuments}/{reconResult.counts.totalDocuments}{' '}
                        مربوطة · تسليم داخليّ {reconResult.counts.internalDeliveryDocuments}
                      </dd>
                    </div>
                    <div className="rounded-[8px] border border-line bg-surface p-2">
                      <dt className="m-0 font-bold text-muted">أسعار العملاء</dt>
                      <dd className="m-0" dir="ltr">
                        بلا تاريخ تدقيق: {reconResult.counts.customerPricesWithoutHistory}
                      </dd>
                    </div>
                  </dl>

                  {reconResult.conflicts.length > 0 ? (
                    <div className="grid gap-1.5">
                      <p className="m-0 text-[12.5px] font-bold text-ink">
                        تعارضاتٌ تحتاج مراجعةً يدوية ({reconResult.conflicts.length}) — لا تُصلحها
                        الأداة:
                      </p>
                      {reconResult.conflicts.map((item) => (
                        <p
                          key={`${item.entityType}-${item.entityId}-${item.code}`}
                          className={`m-0 rounded-[8px] border px-3 py-2 text-[12px] ${NOTICE_CLASSES.danger}`}
                        >
                          <span dir="ltr">{item.code}</span> · {item.entityType} · {item.detail}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {reconResult.plan.length > 0 ? (
                    <div className="overflow-x-auto">
                      <p className="m-0 text-[12.5px] font-bold text-ink">
                        خطةُ الأداة ({reconResult.plan.length} بندًا):
                      </p>
                      <table className="w-full border-collapse text-[12px]">
                        <thead>
                          <tr className="text-muted">
                            <th className="border-b border-line p-2 text-start font-bold">الكيان</th>
                            <th className="border-b border-line p-2 text-start font-bold">الرقم</th>
                            <th className="border-b border-line p-2 text-start font-bold">الإجراء</th>
                            <th className="border-b border-line p-2 text-start font-bold">يُستكمل بأمان؟</th>
                            <th className="border-b border-line p-2 text-start font-bold">مانع</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reconResult.plan.map((item) => (
                            <tr key={`${item.entityType}-${item.entityId}-${item.action}`}>
                              <td className="border-b border-line p-2">{item.entityType}</td>
                              <td className="border-b border-line p-2" dir="ltr">
                                {numberText(item.number)}
                              </td>
                              <td className="border-b border-line p-2" dir="ltr">
                                {item.action}
                              </td>
                              <td className="border-b border-line p-2">
                                {item.canBackfillSafely ? 'نعم' : 'لا — يُتخطّى'}
                              </td>
                              <td className="border-b border-line p-2" dir="ltr">
                                {numberText(item.blockingReason)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <p className="m-0 text-[12px] text-muted">
                    تنفيذُ الدفعة: نجح <span dir="ltr">{reconResult.execution.succeededCount}</span> ·
                    فشل <span dir="ltr">{reconResult.execution.failedCount}</span> · الاستئناف
                    التالي <span dir="ltr">{numberText(reconResult.execution.nextResumeCursor)}</span>
                    {reconResult.execution.failed.length > 0
                      ? ` — وأسباب الفشل: ${reconResult.execution.failed
                          .map((item) => `${item.entityType}/${item.entityId}: ${item.reason}`)
                          .join(' · ')}`
                      : ''}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>

      {dashboard && dashboard.movements.length > 0 ? (
        <Card>
          <CardHeader
            subtitle="أحدث حركات العهدة كما أرجعها الخادم (٨٠ حركة) — ومنها يُقرأ أثرُ كلّ سندٍ في المخزون والنقد، وتفصيلُ القيود في staff."
            title="حركات الخطّ الأخيرة"
          />
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="text-muted">
                    <th className="border-b border-line p-2 text-start font-bold">النوع</th>
                    <th className="border-b border-line p-2 text-start font-bold">العميل</th>
                    <th className="border-b border-line p-2 text-start font-bold">المندوب</th>
                    <th className="border-b border-line p-2 text-start font-bold">كمية</th>
                    <th className="border-b border-line p-2 text-start font-bold">قيمة</th>
                    <th className="border-b border-line p-2 text-start font-bold">السبب كما كتبه الخادم</th>
                    <th className="border-b border-line p-2 text-start font-bold">سند</th>
                    <th className="border-b border-line p-2 text-start font-bold">متى</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.movements.slice(0, 25).map((row) => (
                    <tr key={row.id}>
                      <td className="border-b border-line p-2">{movementTypeLabel(row.movementType)}</td>
                      <td className="border-b border-line p-2">{numberText(row.customerName)}</td>
                      <td className="border-b border-line p-2">{numberText(row.salesmanName)}</td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.qty)}
                      </td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.amount)}
                      </td>
                      <td className="border-b border-line p-2">{numberText(row.reason)}</td>
                      <td className="border-b border-line p-2" dir="ltr">
                        {numberText(row.voucherId)}
                      </td>
                      <td className="border-b border-line p-2" dir="ltr">
                        {numberText(row.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </section>
  );
}
