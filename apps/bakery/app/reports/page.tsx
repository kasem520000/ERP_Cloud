'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, DataTable, EmptyState, Input, Kpi, Panel, type SortState, type TableState } from '@erp/ui';
import { apiData, apiErrorText, apiList } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import {
  BALANCE_CARDS,
  cardValue,
  cellText,
  COLLECTION_COLUMNS,
  currentMonthDraft,
  emptyRangeDraft,
  filterHeadline,
  FROM_LABEL,
  generatedAtText,
  hasPeriodTotals,
  isAnyListTruncated,
  listedSums,
  PERIOD_CARD_GROUPS,
  PRICE_COLUMNS,
  PRODUCTION_COLUMNS,
  rangeVerdict,
  REP_COLUMNS,
  REPORT_LIST_LABELS,
  REPORTS_MESSAGES,
  REPORTS_PERMISSION,
  reportsQuery,
  reportVerdicts,
  summaryValue,
  TO_LABEL,
  TRANSFER_COLUMNS,
  type RepCustodyRow,
  type ReportColumn,
  type ReportRangeDraft,
  type ReportRow,
  type ReportsPayload,
  type Verdict,
} from '../../lib/reports-screen';
import { type SalesmanCard } from '../../lib/reps-screen';
import { listState, rowKeyFrom, tableColumns } from '../../lib/ui-kit';

type Notice = { kind: 'ok' | 'danger' | 'warn'; text: string };

const NOTICE_CLASSES: Record<Notice['kind'], string> = {
  ok: 'border-ok-line bg-ok-soft text-ok-ink',
  danger: 'border-danger-line bg-danger-soft text-danger-ink',
  warn: 'border-warn-line bg-warn-soft text-warn-ink',
};

const selectClass = 'ui-select';

/**
 * جدولٌ واحد من جداول التقرير — على `DataTable` من نظام التصميم لا على `<table>` يدويّ.
 *
 * والأعمدةُ والصفوفُ من الخادم ولا خليةَ تُحسب هنا (`cellText` في `reports-screen` هو
 * القارئُ الوحيد)، وأمّا الرسمُ فللنظام: رأسٌ لاصقٌ في الجدول الطويل، وفرزٌ لكلّ عمود،
 * ومُختارُ أعمدةٍ محفوظٌ في `localStorage` بمفتاحٍ لكلّ جدول (فإخفاءُ عمودٍ في تقرير
 * التحويلات لا يُخفيه في تقرير التحصيل)، وترقيمُ صفحاتٍ «n من m»، و**أربعُ حالاتٍ
 * صادقة** (فارغ/تحميل/خطأ/ممنوع) فلا منطقةَ فارغةً بلا قول.
 *
 * وما كان قبلها: ‏`<table className="w-full border-collapse text-[12.5px]">` برأسٍ غير
 * لاصقٍ وبلا فرزٍ ولا إخفاءَ ولا ترقيم، و`rows.length === 0` ⇒ فقرةٌ رمادية — أي أنّ
 * «يُحمَّل التقرير…» و«لا صلاحية» و«لا صفوف» كانت تُعرض بالشيء نفسه تقريبًا.
 */
function ReportTable({
  columns,
  rows,
  emptyAr,
  state,
  storageKey,
}: {
  columns: readonly ReportColumn[];
  rows: readonly (ReportRow | RepCustodyRow)[];
  emptyAr: string;
  state: TableState;
  storageKey: string;
}) {
  const [sort, setSort] = useState<SortState>(null);
  return (
    <DataTable<ReportRow>
      columns={tableColumns<ReportRow>(columns, cellText)}
      dense
      empty={
        /** ‏`icon` مطلوبٌ في `EmptyState`، و`lucide-react` ليست من اعتمادات هذه الواجهة —
         * فالرمزُ التعبيريّ لغةُ التطبيق القائمة ولا يُضاف اعتمادٌ لأجل أيقونة. */
        <EmptyState description={emptyAr} icon={<span aria-hidden>📄</span>} title="لا صفوف في هذا الجدول" />
      }
      onSortChange={setSort}
      pageSize={25}
      rowKey={rowKeyFrom(['id', 'documentId', 'salesmanId', 'number'])}
      rows={rows as ReportRow[]}
      sort={sort}
      sortable
      state={state}
      storageKey={`bakery-reports-${storageKey}`}
    />
  );
}

/**
 * 📈 شاشة «تقارير الخطّ» — فترةٌ يختارها المحاسب، وأرقامٌ من محرّك التقارير نفسه.
 *
 * السلسلةُ التي تُقاس هنا: **المدى يُطبَّق على الصفوف والمجاميع معًا**، بتواريخ العمل
 * (`load_date`, `doc_date`, `production_date`)، ويقول الخادم ما لا يُطبَّق عليه المرشِّح
 * (الإنتاج والتسعير ليسا منسوبَين إلى مندوب؛ والتسعير بلا تاريخِ عملٍ فيُصفّى بتاريخ
 * الإنشاء) — فتعرض الشاشة `filterNotes` كما رجعت.
 *
 * و`periodTotals` (مجموعُ الفترة) معروضٌ في بطاقة، و`summary` (أرقامُ المنشأة كلّها وأرصدةُ
 * اللحظة) في بطاقةٍ أخرى بعنوانها، ومعها جملةٌ صريحةٌ حين يختلفان — فخلطُ تدفّقِ فترةٍ
 * برصيدٍ أو بإجماليّ عمرٍ هو الخطأ الذي تُبنى عليه تقاريرُ خاطئة.
 *
 * ولكلّ قائمةٍ سقفٌ من الخادم (`rowCap`) و`truncated`: فالقصُّ يُقال، وبجانبه مجموعُ الصفوف
 * **المعروضة** مقابل مجموع الفترة، فيُرى الفرقُ ولا يُظنّ أنّ المعروض كلُّ شيء.
 *
 * وما **ليس** هنا: إصدارُ مستندٍ أو تحصيلٌ أو إقفالُ عهدة (‏`/sales` و`/collection` و
 * `/custody`)، والأستاذُ وتفصيلُ القيود (لوحة الموظفين، وتُفتح بتسليم جلسة)، وحسابُ العمولة
 * (الرواتب في staff). ولا رقمَ في هذه الشاشة إلا من حمولة الخادم.
 */
export default function ReportsPage() {
  const { can } = useSession();
  const canView = can(REPORTS_PERMISSION);

  const [draft, setDraft] = useState<ReportRangeDraft>(emptyRangeDraft);
  const [payload, setPayload] = useState<ReportsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice | undefined>();
  /**
   * حالةُ الجداول كلّها من حالة الطلب: فـ`DataTable` تعرض «يُحمَّل» و«فشل» و«لا صلاحية»
   * بدل منطقةٍ فارغة. والترتيبُ داخل `listState` (ممنوع ← تحميل ← خطأ) مقصودٌ وموثّقٌ هناك.
   */
  const tableState = listState({
    loading,
    error: loadError,
    forbidden: !canView,
    forbiddenMessage: REPORTS_PERMISSION,
  });
  const [salesmen, setSalesmen] = useState<SalesmanCard[]>([]);
  const [salesmenError, setSalesmenError] = useState<string | undefined>();
  const [asked, setAsked] = useState(false);

  const verdict: Verdict = useMemo(() => rangeVerdict(draft), [draft]);
  const screenVerdict: Verdict = useMemo(() => reportVerdicts(payload), [payload]);
  const sums = useMemo(() => listedSums(payload), [payload]);
  const stamped = generatedAtText(payload);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await apiList<SalesmanCard>('/van-sales/salesmen');
        if (!cancelled) setSalesmen(rows);
      } catch (caught) {
        if (!cancelled) {
          setSalesmenError(apiErrorText(caught, 'تعذّر تحميل قائمة المناديب للمرشِّح'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView]);

  const runReport = useCallback(async (next: ReportRangeDraft): Promise<void> => {
    const gate = rangeVerdict(next);
    if (gate.blocked.length > 0) {
      setNotice({ kind: 'danger', text: gate.blocked[0] ?? 'مدى الفترة غير صالح' });
      return;
    }
    setLoading(true);
    setLoadError(undefined);
    setNotice(undefined);
    setAsked(true);
    try {
      const data = await apiData<ReportsPayload>(`/van-sales/reports${reportsQuery(next)}`);
      setPayload(data);
      setNotice({
        kind: isAnyListTruncated(data) ? 'warn' : 'ok',
        text: `${REPORTS_MESSAGES.loaded} المطبَّق: ${filterHeadline(data)}`,
      });
    } catch (caught) {
      setPayload(null);
      setLoadError(apiErrorText(caught, 'تعذّر تحميل التقرير'));
    } finally {
      setLoading(false);
    }
  }, []);

  function apply(next: ReportRangeDraft) {
    setDraft(next);
    void runReport(next);
  }

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">تقارير الخطّ</h1>
          <p className="ui-page-sub">
            مبيعاتُ المندوب ومرتجعُه وهالكُه وتحصيلُه في فترةٍ تختارها — الأرقامُ من محرّك تقارير الخادم نفسه،
            وتواريخُ العمل هي تاريخ التحميل وتاريخ المستند وتاريخ الإنتاج.
          </p>
        </div>
      </header>

      <div className="ui-screen-body">
        {!canView ? (
          <p
            className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.warn}`}
          >
            لا تملك صلاحيةَ قراءة تقارير الخطّ — اطلبها من مسؤول الصلاحيات في منشأتك.
          </p>
        ) : null}

        {canView ? (
          <>
            <div className="ui-filter-bar no-print">
              <div className="ui-filter-fields">
                <div className="grid w-full gap-3 sm:grid-cols-3">
                  <label className="field">
                    <span>{FROM_LABEL}</span>
                    <Input
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, fromDate: event.target.value }))
                      }
                      type="date"
                      value={draft.fromDate}
                    />
                  </label>
                  <label className="field">
                    <span>{TO_LABEL}</span>
                    <Input
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, toDate: event.target.value }))
                      }
                      type="date"
                      value={draft.toDate}
                    />
                  </label>
                  <label className="field">
                    <span>المندوب</span>
                    <select
                      className={selectClass}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, salesmanId: event.target.value }))
                      }
                      value={draft.salesmanId}
                    >
                      <option value="">كلّ المناديب</option>
                      {salesmen.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {salesmenError ? (
                  <p
                    className={`m-0 rounded-[10px] border px-4 py-2.5 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}
                  >
                    قائمةُ المناديب لم تُحمَّل الآن — يعمل التقرير بمرشّح «كلّ المناديب» حتى تُعاد المحاولة.
                  </p>
                ) : null}
              </div>

              <div className="ui-filter-actions">
                <Button
                  disabled={loading || verdict.blocked.length > 0}
                  onClick={() => void runReport(draft)}
                  size="sm"
                >
                  {loading ? 'يُحمَّل التقرير…' : 'اعرض التقرير'}
                </Button>
                <Button
                  disabled={loading}
                  onClick={() => apply(currentMonthDraft())}
                  size="sm"
                  variant="secondary"
                >
                  هذا الشهر
                </Button>
                <Button
                  disabled={loading}
                  onClick={() => apply(emptyRangeDraft())}
                  size="sm"
                  variant="secondary"
                >
                  كلّ السجلّ
                </Button>
                <Button
                  disabled={loading}
                  onClick={() => {
                    setDraft(emptyRangeDraft());
                    setPayload(null);
                    setAsked(false);
                    setNotice(undefined);
                    setLoadError(undefined);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  امسح
                </Button>
              </div>
            </div>

            {verdict.blocked.length > 0 ? (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {verdict.blocked.map((line) => (
                  <li
                    className={`rounded-[10px] border px-4 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}
                    key={line}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}

            {verdict.warnings.length > 0 ? (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {verdict.warnings.map((line) => (
                  <li
                    className={`rounded-[10px] border px-4 py-2 text-[12.5px] ${NOTICE_CLASSES.warn}`}
                    key={line}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {loadError ? (
          <>
            <p
              className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.danger}`}
              role="alert"
            >
              تعذّر تحميل التقرير: {loadError}
            </p>
            <p className="m-0 text-[12.5px] text-muted">
              راجع المدى والمندوب ثمّ أعد المحاولة — ولا تُعرض أرقامٌ بديلة من المتصفح.
            </p>
          </>
        ) : null}

        {notice ? (
          <p
            className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES[notice.kind]}`}
            role={notice.kind === 'danger' ? 'alert' : 'status'}
          >
            {notice.text}
          </p>
        ) : null}

        {canView && !asked && !loading ? (
          <p className="m-0 text-[13px] text-muted">
            {REPORTS_MESSAGES.pickPeriod} وقد يبلغ العرضُ سقفَ الصفوف في منشأةٍ كبيرة، ويُقال حينها إنّ
            القائمة مقصوصة.
          </p>
        ) : null}

        {canView && payload ? (
          <>
            <p className="m-0 text-[12.5px] text-muted">
              المدى المطبَّق: {filterHeadline(payload)}
              {stamped ? ` — وُلِّد في ${stamped}` : ''}
            </p>

            {screenVerdict.warnings.length > 0 ? (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {screenVerdict.warnings.map((line) => (
                  <li
                    className={`rounded-[10px] border px-4 py-2 text-[12.5px] ${NOTICE_CLASSES.warn}`}
                    key={line}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}

            {PERIOD_CARD_GROUPS.map((group) => (
              <Panel hint={group.noteAr} key={group.key} title={group.labelAr}>
                {hasPeriodTotals(payload) ? (
                  <div className="ui-kpi-grid">
                    {group.cards.map((card) => (
                      <Kpi
                        hint={card.hintAr}
                        key={card.key}
                        title={card.labelAr}
                        value={cardValue(payload, card.key)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="m-0 text-[12.5px] text-muted">
                    لم تُرجع هذه الفترة مجاميع — ولا تُحسب بدائل في المتصفح.
                  </p>
                )}
              </Panel>
            ))}

            <Panel
              hint="أرقامُ المنشأة وأرصدتُها في لحظتها — ليست مجاميعَ الفترة أعلاه."
              title="أرصدةُ اللحظة وكلُّ السجلّ"
            >
              <div className="ui-kpi-grid">
                {BALANCE_CARDS.map((card) => (
                  <Kpi
                    hint={card.hintAr}
                    key={card.key}
                    title={card.labelAr}
                    value={summaryValue(payload, card.key)}
                  />
                ))}
              </div>
            </Panel>

            <Panel
              flush
              hint="عهدُ المناديب على المدى نفسه."
              title={`أداءُ المندوبين (${(payload.repCustodyReport ?? []).length})`}
            >
              <ReportTable
                columns={REP_COLUMNS}
                emptyAr="لا مندوبَ له حركةٌ في هذه الفترة."
                rows={payload.repCustodyReport ?? []}
                state={tableState}
                storageKey="reps"
              />
            </Panel>

            <Panel
              flush
              hint={`المعروض من الصفوف: مُحمَّل ${sums.transfersLoadedKg} كجم · متبقٍّ في العهدة ${sums.transfersRemainingKg} كجم — ومجاميعُ الفترة أعلاه هي المرجع.`}
              title={`${REPORT_LIST_LABELS.transfersReport} (${(payload.transfersReport ?? []).length})`}
            >
              <ReportTable
                columns={TRANSFER_COLUMNS}
                emptyAr="لا أمرَ تحميل في هذه الفترة."
                rows={payload.transfersReport ?? []}
                state={tableState}
                storageKey="transfers"
              />
            </Panel>

            <Panel
              flush
              hint={`المعروض من الصفوف: إجماليّ ${sums.collectionsGrandSar} ريال · متبقٍّ ${sums.collectionsOutstandingSar} ريال — وذممُ الفترة أعلاه هي المرجع.`}
              title={`${REPORT_LIST_LABELS.collectionsReport} (${(payload.collectionsReport ?? []).length})`}
            >
              <ReportTable
                columns={COLLECTION_COLUMNS}
                emptyAr="لا مستندَ بيعٍ في هذه الفترة."
                rows={payload.collectionsReport ?? []}
                state={tableState}
                storageKey="collections"
              />
            </Panel>

            <Panel
              flush
              hint={`المعروض من الصفوف: مُنتَج ${sums.productionProducedKg} كجم — والإنتاجُ لا يُنسب إلى مندوب، فلا يقصّه مرشِّحُ المندوب.`}
              title={`${REPORT_LIST_LABELS.productionReport} (${(payload.productionReport ?? []).length})`}
            >
              <ReportTable
                columns={PRODUCTION_COLUMNS}
                emptyAr="لا دفعةَ إنتاج في هذه الفترة."
                rows={payload.productionReport ?? []}
                state={tableState}
                storageKey="production"
              />
            </Panel>

            <Panel
              flush
              footer={
                <span>
                  تقريرُ قراءةٍ فقط: لا يُنشئ قيدًا ولا يُحمِّل نقصًا على أحد. والتقاريرُ المحاسبية الرسمية في
                  لوحة الموظفين.
                </span>
              }
              hint="سجلُّ تغيير أسعار العملاء — يُصفّى بتاريخ الإنشاء لأنّ الجدول بلا تاريخ عمل."
              title={`${REPORT_LIST_LABELS.customerPriceAuditReport} (${(payload.customerPriceAuditReport ?? []).length})`}
            >
              <ReportTable
                columns={PRICE_COLUMNS}
                emptyAr="لا تغييرَ تسعير في هذه الفترة."
                rows={payload.customerPriceAuditReport ?? []}
                state={tableState}
                storageKey="prices"
              />
            </Panel>
          </>
        ) : null}
      </div>
    </section>
  );
}
