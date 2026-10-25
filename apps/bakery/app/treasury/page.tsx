'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
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
import { ApiError, apiErrorText, apiFetch, apiList } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { StaffHandoffLink } from '../../components/staff-handoff-link';
import { numberText } from '../../lib/lookups';
import { rangeVerdict, type ReportRangeDraft } from '../../lib/reports-screen';
import { destinationsOf } from '../../lib/staff-handoff';
import {
  CASH_LOCATION_COLUMNS,
  CASH_LOCATION_PERMISSION,
  LINE_VOUCHER_COLUMNS,
  NO_WRITE_HERE_AR,
  TREASURY_VIEW_PERMISSION,
  VOUCHER_CAP_NOTE,
  VOUCHER_COLUMNS,
  VOUCHER_SERVER_LIMIT,
  cashLocationViewRows,
  draftLineVouchers,
  lineVouchers,
  postedLineVouchers,
  shownSum,
  shownSumCaption,
  treasuryCellText,
  voucherViewRows,
  vouchersQuery,
  type CashBalanceRow,
  type CashLocationRow,
  type ListMeta,
  type VoucherRow,
} from '../../lib/treasury-screen';
import { listState, rowKeyFrom, tableColumns, type ScreenColumn } from '../../lib/ui-kit';

/** سقفُ ما يُطلب من مواضع النقد — والقائمةُ ترجع بـ`meta.total` فيُقال إن كان وراءها أكثر. */
const CASH_LOCATION_LIMIT = 50;

/** جدولٌ من جداول الشاشة — على `DataTable` من نظام التصميم (فرزٌ وإخفاءُ أعمدةً وحالاتٌ صادقة). */
function TreasuryTable({
  columns,
  emptyAr,
  emptyIcon,
  rows,
  state,
  storageKey,
}: {
  columns: readonly ScreenColumn[];
  emptyAr: string;
  emptyIcon: string;
  rows: Record<string, unknown>[];
  state: TableState;
  storageKey: string;
}) {
  const [sort, setSort] = useState<SortState>(null);
  return (
    <DataTable<Record<string, unknown>>
      columns={tableColumns<Record<string, unknown>>(columns, treasuryCellText)}
      dense
      empty={
        <EmptyState
          description={emptyAr}
          icon={<span aria-hidden>{emptyIcon}</span>}
          title="لا صفوف في هذا الجدول"
        />
      }
      onSortChange={setSort}
      pageSize={25}
      rowKey={rowKeyFrom(['id', 'number'])}
      rows={rows}
      sort={sort}
      sortable
      state={state}
      storageKey={`bakery-treasury-${storageKey}`}
    />
  );
}

/**
 * شاشة الخزينة — **قراءةُ ما كتبه مسارُ الخطّ الرسميّ في الخزينة**، لا مدخلُ مالٍ ثانٍ.
 *
 * وما قِيس قبل كتابة هذه الشاشة (‏`van-sales.service.ts:6953-7027`) هو سببُ شكلها:
 * ‏`POST /van-sales/collections` يُنشئ سندَ قبضٍ عبر `TreasuryService` **ويُرحِّله**
 * (Dr الصندوق / Cr ذمم العملاء) ويرفع رصيدَ الموضع، ويكتب في السند `referenceNo` = رقمَ
 * مستند الخطّ و`idempotencyKey` = ‏`van-collection-voucher:<documentId>:<key>`. فسندٌ
 * يُنشأ من هنا على النقد نفسه **قبضٌ مزدوج** — ولذلك لا زرَّ إنشاءٍ في هذه الشاشة، وما
 * يحتاج حكمًا محاسبيًّا يُفتح في لوحة staff بتسليم جلسة (‏`/accounting` و`lib/staff-handoff`).
 *
 * وما تفعله الشاشة بثلاثةِ أرقامٍ صادقة:
 *   1. **سنداتُ الخطّ**: تُنسب بالمفتاح الذي يكتبه المسارُ نفسه (`idempotencyKey`) لا
 * بالبيان ولا بالمرجع — فسندٌ يدويٌّ قد يحمل رقمَ مستندٍ في `referenceNo`، والنسبةُ
 * بالتخمين كذب.
 *   2. **المسودةُ منها فجوةٌ تُقال**: فالمسارُ لا يُرحِّل إلا حين يُحلّ حسابٌ مقابل، وبلا
 * ترحيلٍ لم يدخل المالُ الصندوقَ ولا الأستاذ — وعدُّها هنا يمنع قراءةَ «محصَّل» في
 * تقرير الخطّ على أنّه «في الخزينة».
 *   3. **بلا إجماليٍّ من نافذة**: ‏`GET /vouchers` يرجع مصفوفةً سقفُها ٥٠٠ صفٍّ في الخادم
 *      (‏`.limit(500)`، بلا `meta.total` ولا مجاميع) — فحين تُلامس القائمةُ السقفَ **لا
 * يُعرض مجموع**؛ لأنّ مجموعَ نافذةٍ مقطوعة بعنوان «الإجمالي» هو الخطأ نفسه الذي
 * أُصلح في الشريحة ١٣أ (مجاميعُ من SQL لا من قائمةٍ محدودة).
 *
 * والأرصدةُ من `GET /cash-locations/:id/balances` وهي **كاشٌ مُطابَق** (‏`cash_location_balances`)
 * والحقيقةُ الأستاذ — وتُقال كذلك في عنوان العمود. وبلا صفِّ رصيدٍ يُعرض «—» ولا يُخترع صفر:
 * فغيابُ الصفّ يعني أنّ الموضعَ لم يُرصد بعد، لا أنّه فارغ.
 */
export default function TreasuryPage() {
  const { can } = useSession();
  const canView = can(TREASURY_VIEW_PERMISSION);
  const canReadLocations = can(CASH_LOCATION_PERMISSION);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState({ fromDate: '', toDate: '', search: '' });

  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [locations, setLocations] = useState<CashLocationRow[]>([]);
  const [locationsMeta, setLocationsMeta] = useState<ListMeta | undefined>();
  const [balances, setBalances] = useState<CashBalanceRow[]>([]);
  const [balanceNote, setBalanceNote] = useState<string | undefined>();

  const [loading, setLoading] = useState(true);
  const [vouchersError, setVouchersError] = useState<string | undefined>();
  const [vouchersForbidden, setVouchersForbidden] = useState(false);
  const [locationsError, setLocationsError] = useState<string | undefined>();
  const [locationsForbidden, setLocationsForbidden] = useState(false);

  /** `rangeVerdict` قاعدةُ الخادم نفسها (الصيغةُ والوجودُ والترتيب) — ولا نسخةَ ثانية هنا. */
  const draft: ReportRangeDraft = useMemo(() => ({ fromDate, toDate, salesmanId: '' }), [fromDate, toDate]);
  const verdict = useMemo(() => rangeVerdict(draft), [draft]);
  const blocked = verdict.blocked.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setVouchersError(undefined);
    setVouchersForbidden(false);
    setLocationsError(undefined);
    setLocationsForbidden(false);
    setBalanceNote(undefined);

    const query = vouchersQuery(applied);
    const [vouchersResult, locationsResult] = await Promise.allSettled([
      canView ? apiList<VoucherRow>(`/vouchers${query}`) : Promise.reject(new Error('no-permission')),
      canReadLocations
        ? apiFetch<{ data: CashLocationRow[]; meta: ListMeta }>(
            `/cash-locations?limit=${CASH_LOCATION_LIMIT}`,
          )
        : Promise.reject(new Error('no-permission')),
    ]);

    let loadedLocations: CashLocationRow[] = [];
    if (vouchersResult.status === 'fulfilled') {
      setVouchers(vouchersResult.value);
    } else {
      const reason = vouchersResult.reason;
      setVouchers([]);
      if (reason instanceof ApiError && reason.status === 403) {
        setVouchersForbidden(true);
        setVouchersError('يرفض الخادمُ قراءةَ السندات على جلستك — اطلب صلاحيةَ الخزينة من مدير المنشأة.');
      } else if (canView) {
        setVouchersError(apiErrorText(reason, 'تعذّر تحميل السندات'));
      }
    }

    if (locationsResult.status === 'fulfilled') {
      loadedLocations = locationsResult.value?.data ?? [];
      setLocations(loadedLocations);
      setLocationsMeta(locationsResult.value?.meta);
    } else {
      const reason = locationsResult.reason;
      setLocations([]);
      setLocationsMeta(undefined);
      if (reason instanceof ApiError && reason.status === 403) {
        setLocationsForbidden(true);
        setLocationsError('لا صلاحيةَ لقراءة مواضع النقد — والأعمدةُ التي تعتمد عليها تُعرض «—».');
      } else if (canReadLocations) {
        setLocationsError(apiErrorText(reason, 'تعذّر تحميل مواضع النقد'));
      }
    }

    // الأرصدةُ طلبٌ لكلّ موضع (لا نقطةَ تجمعها) — وعددُ الطلبات يُقال ولا يُخفى.
    if (loadedLocations.length > 0 && canReadLocations) {
      const results = await Promise.allSettled(
        loadedLocations
          .filter((row) => typeof row.id === 'string' && row.id.length > 0)
          .map((row) => apiList<CashBalanceRow>(`/cash-locations/${String(row.id)}/balances`)),
      );
      const loaded: CashBalanceRow[] = [];
      const failed: string[] = [];
      results.forEach((result, index) => {
        const name = loadedLocations[index]?.name ? String(loadedLocations[index]?.name) : 'موضع';
        if (result.status === 'fulfilled') loaded.push(...result.value);
        else failed.push(name);
      });
      setBalances(loaded);
      setBalanceNote(
        failed.length > 0
          ? `تعذّر جلبُ رصيد ${failed.join(' و')} — فالرصيدُ المعروض «—» ولا صفرَ مُخترعًا.`
          : `${results.length} طلبَ رصيد (واحدٌ لكلّ موضع) — ولا نقطةَ في الخادم تجمعها في طلبٍ واحد.`,
      );
    } else {
      setBalances([]);
    }

    setLoading(false);
  }, [applied, canReadLocations, canView]);

  useEffect(() => {
    if (!canView && !canReadLocations) {
      setLoading(false);
      return;
    }
    void load();
  }, [canReadLocations, canView, load]);

  const lineRows = useMemo(() => lineVouchers(vouchers), [vouchers]);
  const draftRows = useMemo(() => draftLineVouchers(vouchers), [vouchers]);
  const postedRows = useMemo(() => postedLineVouchers(vouchers), [vouchers]);
  const capHit = vouchers.length >= VOUCHER_SERVER_LIMIT;
  const lineSum = useMemo(
    () => shownSum(lineRows, (row) => (typeof row.amount === 'string' ? row.amount : null)),
    [lineRows],
  );

  const voucherRows = useMemo(() => voucherViewRows(vouchers, locations), [vouchers, locations]);
  const lineViewRows = useMemo(() => voucherViewRows(lineRows, locations), [lineRows, locations]);
  const locationRows = useMemo(() => cashLocationViewRows(locations, balances), [locations, balances]);

  const vouchersState = listState({
    loading,
    error: vouchersError,
    forbidden: vouchersForbidden,
    forbiddenMessage: vouchersError,
  });
  const locationsState = listState({
    loading,
    error: locationsError,
    forbidden: locationsForbidden,
    forbiddenMessage: locationsError,
  });

  if (!canView && !canReadLocations) {
    return (
      <section className="ui-page">
        <Card>
          <CardHeader subtitle="ولا يُرسل طلبٌ سيُرفض حتمًا." title="لا صلاحيةَ لخزينة على جلستك" />
          <CardBody>
            <p className="m-0 text-[13px] leading-relaxed text-ink">
              تحتاج لقراءة السندات و لمواضع النقد — والضابطُ الخادمُ لا هذه الشاشة. وحسابُ مندوبٍ محصورٍ لا
              يراهما: فله أرقامُه في <span dir="ltr">/rep</span> وخطُّه في <span dir="ltr">/custody</span>.
            </p>
          </CardBody>
        </Card>
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">الخزينة</h1>
          <p className="ui-page-sub">
            نقدُ الخطّ كما دخل الخزينةَ فعلًا: سنداتُ القبض التي كتبها مسارُ التحصيل الرسميّ، ومواضعُ النقد
            وأرصدتُها. ولا سندَ يُنشأ من هنا — فسندٌ ثانٍ على النقد نفسه قبضٌ مزدوج.
          </p>
        </div>
        <div className="ui-page-actions">
          <Button disabled={loading} onClick={() => void load()} size="sm">
            {loading ? 'يُحمَّل…' : 'تحديث'}
          </Button>
        </div>
      </header>
      <div className="ui-screen-body">
        <Card>
          <CardHeader
            subtitle="مدى القراءة: من تاريخ إلى تاريخ، مع بحثٍ اختياريّ. والخادمُ يتحقّق من صحة التاريخين قبل التنفيذ."
            title="مدى القراءة"
          />
          <CardBody>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="field">
                <span>من تاريخ</span>
                <Input onChange={(event) => setFromDate(event.target.value)} type="date" value={fromDate} />
              </label>
              <label className="field">
                <span>إلى تاريخ</span>
                <Input onChange={(event) => setToDate(event.target.value)} type="date" value={toDate} />
              </label>
              <label className="field">
                <span>بحث (رقمُ سند، مرجع، شيك، بيان، مستفيد)</span>
                <Input
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="RV-000004"
                  value={search}
                />
              </label>
              <div className="flex items-end">
                <Button
                  disabled={blocked || loading}
                  onClick={() =>
                    setApplied({ fromDate: fromDate.trim(), toDate: toDate.trim(), search: search.trim() })
                  }
                  variant="primary"
                >
                  تطبيق المدى
                </Button>
              </div>
            </div>
            {blocked ? (
              <p className="m-0 mt-3 text-[12.5px] leading-relaxed text-danger-ink" role="alert">
                {verdict.blocked.join(' · ')}
              </p>
            ) : null}
            {!blocked && verdict.warnings.length > 0 ? (
              <p className="m-0 mt-3 text-[12.5px] leading-relaxed text-muted">
                {verdict.warnings.join(' · ')}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <div className="ui-kpi-strip">
          <Kpi
            hint="تُنسب بمفتاح `van-collection-voucher:` الذي يكتبه مسارُ التحصيل — لا بالبيان"
            title="سنداتُ الخطّ في هذا المدى"
            tone="brand"
            value={String(lineRows.length)}
          />
          <Kpi
            hint="دخلت الصندوقَ والأستاذ (‏journalEntryId مرتبط)"
            title="مُرحَّلة"
            tone="ok"
            value={String(postedRows.length)}
          />
          <Kpi
            hint={
              draftRows.length > 0
                ? 'تحصيلٌ لم يُرحَّل: لم يدخل الصندوقَ ولا الأستاذ — فالمسارُ لا يُرحِّل بلا حسابٍ مقابل'
                : 'لا سندَ خطٍّ بقي مسودةً في هذا المدى'
            }
            title="مسودة — فجوةٌ تُقال"
            tone={draftRows.length > 0 ? 'warn' : 'ok'}
            value={String(draftRows.length)}
          />
          <Kpi
            hint={
              capHit ? VOUCHER_CAP_NOTE : 'مجموعُ المعروض لا إجماليُّ السجلّ — والخادمُ لا يرجع إجماليًّا هنا'
            }
            title="مجموعُ سندات الخطّ المعروضة"
            tone={lineSum ? 'neutral' : 'warn'}
            value={lineSum ? numberText(lineSum.text) : '—'}
          />
        </div>

        {capHit ? (
          <Card>
            <CardHeader
              subtitle={`سقفُ العرض ${VOUCHER_SERVER_LIMIT} صفٍّ في الاستعلام الواحد`}
              title="القائمةُ مقطوعة"
            />
            <CardBody>
              <p className="m-0 text-[13px] leading-relaxed text-danger-ink" role="alert">
                {VOUCHER_CAP_NOTE}
              </p>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            subtitle={
              balanceNote ??
              'الرصيدُ كاشٌ مُطابَق (`cash_location_balances`) والحقيقةُ الأستاذ — وحركةُ الصندوق من الأستاذ في لوحة staff.'
            }
            title="مواضعُ النقد وأرصدتُها"
          />
          <CardBody>
            <TreasuryTable
              columns={CASH_LOCATION_COLUMNS}
              emptyAr="لا مواضعَ نقدٍ رجعت من الخادم — فأنشئها في لوحة staff (‏/accounting/cash-locations) أو تحقّق من الصلاحية."
              emptyIcon=""
              rows={locationRows}
              state={locationsState}
              storageKey="cash-locations"
            />
            {locationsMeta &&
            typeof locationsMeta.total === 'number' &&
            locationsMeta.total > locationRows.length ? (
              <p className="m-0 mt-2 text-[12.5px] text-muted">
                معروضٌ {locationRows.length} من {locationsMeta.total} موضعًا (سقفُ الطلب{' '}
                <span dir="ltr">limit={CASH_LOCATION_LIMIT}</span>) — فليست كلّ المواضع هنا.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            subtitle="سنداتُ قبضٍ كتبها مسارُ التحصيل الرسميّ — ورقمُ مستند الخطّ ظاهرٌ في كلّ صفّ."
            title="سنداتُ قبض الخطّ"
          />
          <CardBody>
            <TreasuryTable
              columns={LINE_VOUCHER_COLUMNS}
              emptyAr="لا سندَ خطٍّ في هذا المدى. والتحديدُ بمفتاح عدم التكرار `van-collection-voucher:` — فسندٌ يدويٌّ يحمل رقمَ مستندٍ في المرجع لا يُعدّ من الخطّ هنا."
              emptyIcon=""
              rows={lineViewRows}
              state={vouchersState}
              storageKey="line-vouchers"
            />
            {lineSum ? (
              <p className="m-0 mt-2 text-[12.5px] text-muted">
                {shownSumCaption(lineRows.length, lineSum.count)}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            subtitle="كلُّ سندات الخزينة في المدى — لا سنداتُ الخطّ وحدها: ففيها الرواتبُ والمصروفاتُ والشيكات."
            title="سنداتُ الفترة"
          />
          <CardBody>
            <TreasuryTable
              columns={VOUCHER_COLUMNS}
              emptyAr="لا سنداتَ في هذا المدى (أو أنّ القائمةَ رُفضت على جلستك)."
              emptyIcon=""
              rows={voucherRows}
              state={vouchersState}
              storageKey="vouchers"
            />
            <p className="m-0 mt-2 text-[12.5px] text-muted">
              معروضٌ {vouchers.length} سندًا
              {capHit ? ` — وهو سقفُ الخادم (${VOUCHER_SERVER_LIMIT}) فالقائمةُ مقطوعة` : ''}.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            subtitle="وما يحتاج حكمًا محاسبيًّا وجهتُه اللوحةُ بتسليم جلسة."
            title="ما لا تفعله هذه الشاشة"
          />
          <CardBody>
            <ul className="m-0 grid gap-2 text-[13px] leading-relaxed text-ink">
              {NO_WRITE_HERE_AR.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {destinationsOf('treasury').map((destination) => (
                <article
                  className="grid gap-2 rounded-lg border border-line bg-surface p-4 shadow-1"
                  key={destination.key}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 text-[15px] font-extrabold text-ink">{destination.labelAr}</h2>
                    <Badge tone="neutral">
                      <span dir="ltr">{destination.path}</span>
                    </Badge>
                  </div>
                  <p className="m-0 text-[13px] leading-relaxed text-muted">{destination.noteAr}</p>
                  <StaffHandoffLink destination={destination} labelAr="افتح في لوحة الخزينة" />
                </article>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
