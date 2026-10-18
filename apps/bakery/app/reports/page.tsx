'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Input,
  Kpi,
  type SortState,
  type TableState,
} from '@erp/ui';
import { apiData, apiErrorText, apiList } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { BakeryModuleIcon } from '../../components/module-icon';
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
import { STAFF_SALESMEN_PATH, type SalesmanCard } from '../../lib/reps-screen';
import { listState, rowKeyFrom, tableColumns } from '../../lib/ui-kit';

type Notice = { kind: 'ok' | 'danger' | 'warn'; text: string };

const NOTICE_CLASSES: Record<Notice['kind'], string> = {
  ok: 'border-ok-line bg-ok-soft text-ok-ink',
  danger: 'border-danger-line bg-danger-soft text-danger-ink',
  warn: 'border-warn-line bg-warn-soft text-warn-ink',
};

const selectClass =
  'w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink';

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
 <EmptyState
          description={emptyAr}
          icon={<BakeryModuleIcon moduleKey="reports" size={22} />}
          title="لا صفوف في هذا الجدول"
        />
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
 * شاشة «تقارير الخطّ» — فترةٌ يختارها المحاسب، وأرقامٌ من محرّك التقارير نفسه.
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

  const runReport = useCallback(
    async (next: ReportRangeDraft): Promise<void> => {
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
    },
    [],
  );

  function apply(next: ReportRangeDraft) {
    setDraft(next);
    void runReport(next);
  }

  return (
 <section className="grid gap-4">
 <header className="flex flex-wrap items-end justify-between gap-3">
 <div className="min-w-0">
 <h1 className="m-0 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
 تقارير الخطّ
 </h1>
 <p className="m-0 mt-1 text-[13px] text-muted">
 مبيعاتُ المندوب ومرتجعُه وهالكُه وتحصيلُه في فترةٍ تختارها — من محرّك التقارير نفسه
            (<span dir="ltr">GET /van-sales/reports</span>) لا من حسابٍ موازٍ في المتصفح.
 والتواريخُ تواريخُ العمل: <span dir="ltr">load_date</span> و
 <span dir="ltr"> doc_date</span> و<span dir="ltr"> production_date</span>.
 </p>
 </div>
 <div className="flex flex-wrap items-center gap-2">
 <span className="bak-badge">GET /van-sales/reports</span>
 <span className="bak-badge">GET /van-sales/dashboard</span>
 </div>
 </header>

      {!canView ? (
 <Card>
 <CardBody>
 <p
              className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.warn}`}
            >
 لا تملك <span dir="ltr">{REPORTS_PERMISSION}</span> — والخادم يرفض قراءة التقرير
              (الحارسُ يفرض الرموز قبل أيّ منطق). ولم يُرسل هذا التطبيق طلبًا سيُرفض حتمًا، ولا
 عرض أرقامًا من المتصفح بدلها.
 </p>
 </CardBody>
 </Card>
      ) : null}

      {canView ? (
 <Card>
 <CardHeader
            subtitle="المدى يُطبَّق على الصفوف وعلى المجاميع معًا. والفحصُ المسبق هنا مرآةُ قاعدة الخادم (الصيغة، ووجودُ التاريخ، والترتيب) — والحكمُ النهائيّ للخادم."
            title="الفترة والمرشِّحات"
          />
 <CardBody>
 <div className="grid gap-3 sm:grid-cols-3">
 <label className="m-0 grid gap-1.5">
 <span className="text-[12px] font-bold text-muted">{FROM_LABEL}</span>
 <Input
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, fromDate: event.target.value }))
                  }
                  type="date"
                  value={draft.fromDate}
                />
 </label>
 <label className="m-0 grid gap-1.5">
 <span className="text-[12px] font-bold text-muted">{TO_LABEL}</span>
 <Input
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, toDate: event.target.value }))
                  }
                  type="date"
                  value={draft.toDate}
                />
 </label>
 <label className="m-0 grid gap-1.5">
 <span className="text-[12px] font-bold text-muted">المندوب</span>
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
                className={`m-0 mt-3 rounded-[10px] border px-4 py-2.5 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}
              >
 قائمةُ المناديب لم تُحمَّل ({salesmenError}) — فيبقى المرشِّح «كلّ المناديب»،
 والتقريرُ نفسه يعمل بلا مرشِّح مندوب.
 </p>
            ) : null}

 <div className="mt-3 flex flex-wrap items-center gap-2">
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

            {verdict.blocked.length > 0 ? (
 <ul className="m-0 mt-3 grid gap-1.5">
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
 <ul className="m-0 mt-3 grid gap-1.5">
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
 تعذّر تحميل التقرير: {loadError}
 </p>
 <p className="m-0 mt-2 text-[12.5px] text-muted">
 الأسبابُ المعتادة: مدىً رفضه الخادم (٤٢٢ بنصّه أعلاه)، أو مندوبٌ ليس من هذه
 المنشأة (٤٠٤ «المندوب غير موجود»)، أو لا تملك{' '}
 <span dir="ltr">{REPORTS_PERMISSION}</span> (٤٠٣). ولا تُعرض أرقامٌ بديلة من
 المتصفح.
 </p>
 </CardBody>
 </Card>
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
 <Card>
 <CardBody>
 <p className="m-0 text-[13px] text-muted">{REPORTS_MESSAGES.pickPeriod}</p>
 <p className="m-0 mt-2 text-[12.5px] text-muted">
              «هذا الشهر» يملأ أولَ الشهر الجاري وآخرَه بتقويم المتصفح ثمّ يطلب التقرير؛ و«كلّ
 السجلّ» يرسل بلا مدىً — وقد يبلغ سقفَ الصفوف في منشأةٍ كبيرة، والقصُّ يُقال ولا
 يُخفى. والأستاذُ والتقاريرُ المحاسبية الرسمية في لوحة الموظفين (
 <span dir="ltr">apps/staff</span>) وتُفتح بتسليم جلسة.
 </p>
 </CardBody>
 </Card>
      ) : null}

      {canView && payload ? (
 <>
 <Card>
 <CardHeader
              subtitle={
                stamped
                  ? `المطبَّق: ${filterHeadline(payload)} — وُلِّد في ${stamped}`
                  : `المطبَّق: ${filterHeadline(payload)}`
              }
              title="الفترة كما طبّقها الخادم"
            />
 <CardBody>
 <p className="m-0 text-[12.5px] text-muted">
 هذه حقولُ <span dir="ltr">filters</span> التي أرجعها الخادم، لا ما كُتب في الحقول
 أعلاه فحسب: فتاريخٌ مرفوضٌ يُرفض (٤٢٢) ولا يُهمل بصمت.
 </p>
              {screenVerdict.warnings.length > 0 ? (
 <ul className="m-0 mt-3 grid gap-1.5">
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
 </CardBody>
 </Card>

          {PERIOD_CARD_GROUPS.map((group) => (
 <Card key={group.key}>
 <CardHeader subtitle={group.noteAr} title={group.labelAr} />
 <CardBody>
                {hasPeriodTotals(payload) ? (
 <div className="m-0 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
 لم يرجع الخادم <span dir="ltr">periodTotals</span> في هذه الحمولة — ولا تُحسب
 مجاميعُ بديلة في المتصفح.
 </p>
                )}
 </CardBody>
 </Card>
          ))}

 <Card>
 <CardHeader
              subtitle="من summary (لوحة الخطّ): أرقامُ المنشأة كلّها وأرصدتُها في لحظتها — ليست مجاميعَ الفترة أعلاه."
              title="أرصدةُ اللحظة وكلُّ السجلّ"
            />
 <CardBody>
 <div className="m-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {BALANCE_CARDS.map((card) => (
 <Kpi
                    hint={card.hintAr}
                    key={card.key}
                    title={card.labelAr}
                    value={summaryValue(payload, card.key)}
                  />
                ))}
 </div>
 </CardBody>
 </Card>

 <Card>
 <CardHeader
              subtitle="‏repCustodyReport من الخادم على المدى نفسه — لا من نافذة اللوحة ولا بجمعٍ في المتصفح."
              title={`أداءُ المندوبين (${(payload.repCustodyReport ?? []).length})`}
            />
 <CardBody>
 <ReportTable
                columns={REP_COLUMNS}
                state={tableState}
                storageKey="reps"
                emptyAr="لا مندوبَ له حركةٌ في هذه الفترة."
                rows={payload.repCustodyReport ?? []}
              />
 </CardBody>
 </Card>

 <Card>
 <CardHeader
              subtitle={`مجموعُ الصفوف المعروضة: مُحمَّل ${sums.transfersLoadedKg} كجم · متبقٍّ في العهدة ${sums.transfersRemainingKg} كجم — ومجاميعُ الفترة في البطاقات أعلاه هي الحكم.`}
              title={`${REPORT_LIST_LABELS.transfersReport} (${(payload.transfersReport ?? []).length})`}
            />
 <CardBody>
 <ReportTable
                columns={TRANSFER_COLUMNS}
                state={tableState}
                storageKey="transfers"
                emptyAr="لا أمرَ تحميل في هذه الفترة."
                rows={payload.transfersReport ?? []}
              />
 </CardBody>
 </Card>

 <Card>
 <CardHeader
              subtitle={`مجموعُ الصفوف المعروضة: إجماليّ ${sums.collectionsGrandSar} ريال · متبقٍّ ${sums.collectionsOutstandingSar} ريال — وذممُ الفترة في البطاقات أعلاه.`}
              title={`${REPORT_LIST_LABELS.collectionsReport} (${(payload.collectionsReport ?? []).length})`}
            />
 <CardBody>
 <ReportTable
                columns={COLLECTION_COLUMNS}
                state={tableState}
                storageKey="collections"
                emptyAr="لا مستندَ بيعٍ في هذه الفترة."
                rows={payload.collectionsReport ?? []}
              />
 </CardBody>
 </Card>

 <Card>
 <CardHeader
              subtitle={`مجموعُ الصفوف المعروضة: مُنتَج ${sums.productionProducedKg} كجم — والإنتاجُ لا يُنسب إلى مندوب فلا يقصّه مرشِّحُ المندوب (ويقول الخادم ذلك في filterNotes).`}
              title={`${REPORT_LIST_LABELS.productionReport} (${(payload.productionReport ?? []).length})`}
            />
 <CardBody>
 <ReportTable
                columns={PRODUCTION_COLUMNS}
                state={tableState}
                storageKey="production"
                emptyAr="لا دفعةَ إنتاج في هذه الفترة."
                rows={payload.productionReport ?? []}
              />
 </CardBody>
 </Card>

 <Card>
 <CardHeader
              subtitle="سجلُّ تغيير أسعار العملاء — بلا تاريخِ عملٍ في الجدول فيُصفّى بتاريخ الإنشاء، ويُقال ذلك في filterNotes."
              title={`${REPORT_LIST_LABELS.customerPriceAuditReport} (${(payload.customerPriceAuditReport ?? []).length})`}
            />
 <CardBody>
 <ReportTable
                columns={PRICE_COLUMNS}
                state={tableState}
                storageKey="prices"
                emptyAr="لا تغييرَ تسعير في هذه الفترة."
                rows={payload.customerPriceAuditReport ?? []}
              />
 <p className="m-0 mt-3 text-[12px] text-muted">
 بطاقةُ المندوب الرسمية في لوحة الموظفين: <span dir="ltr">{STAFF_SALESMEN_PATH}</span>{' '}
                (تُفتح بتسليم جلسة). والتقريرُ قراءةٌ فقط: لا يُنشئ قيدًا ولا يُحمِّل نقصًا على
 أحد.
 </p>
 </CardBody>
 </Card>
 </>
      ) : null}
 </section>
  );
}
