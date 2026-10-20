'use client';

import { FilterBand, KpiStrip, Panel } from '@erp/ui';
import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Banknote,
  Download,
  FileSpreadsheet,
  FileText,
  Hash,
  ListChecks,
  Printer,
  Search,
  Timer,
} from 'lucide-react';

import { Screen } from '../../../components/screen';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { BarCardChart, LineCardChart } from '../../../components/ui/chart';
import { EmptyState } from '../../../components/ui/empty-state';
import { Labeled } from '../../../components/ui/input';
import { SkeletonCard } from '../../../components/ui/skeleton';
import { Table, type SortState } from '../../../components/ui/table';
import { renderQrSvgMarkup } from '../../../components/zatca-qr-svg';
import {
  arabicName,
  itemLabel,
  listAccounts,
  listBranches,
  listCashLocations,
  listCategories,
  listCostCenters,
  listItems,
  listParties,
  listSalesmen,
  listVesselGroups,
  listWarehouses,
  partyLabel,
  type Account,
  type Branch,
  type CashLocation,
  type Category,
  type CostCenter,
  type Item,
  type Party,
  type Salesman,
  type VesselGroup,
  type Warehouse,
} from '../../../lib/lookups';
import {
  REPORT_GROUP_LABELS,
  exportReport,
  fetchReportCatalog,
  fetchReportLayouts,
  formatCell,
  initialFilters,
  isNumericColumn,
  openPrintable,
  runReport,
  saveExport,
  type ExportFormat,
  type ReportEntry,
  type ReportLayout,
  type ReportParam,
  type ReportResult,
} from '../../../lib/reports';
import { useQuery } from '../../../lib/use-query';

export default function ReportRunnerPage({ params }: { params: Promise<{ key: string }> }) {
  const reportKey = use(params).key;
  const catalog = useQuery<ReportEntry[]>(() => fetchReportCatalog(), []);
  const entry = (catalog.data ?? []).find((row) => row.key === reportKey);

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'warn'; text: string } | null>(null);
  const layouts = useQuery<ReportLayout[]>(() => fetchReportLayouts(reportKey), [reportKey]);

  useEffect(() => {
    if (!entry) return;
    const initial = initialFilters(entry.params);
    setFilters(initial);
    setApplied(initial);
    setReady(true);
  }, [entry]);

  const appliedKey = JSON.stringify(applied);
  const report = useQuery<ReportResult | null>(
    async () => (ready && entry ? runReport(reportKey, applied) : null),
    [reportKey, appliedKey, ready, Boolean(entry)],
  );

  const kinds = new Set((entry?.params ?? []).map((param) => param.kind));
  const branches = useQuery<Branch[]>(
    async () => (kinds.has('branch') ? listBranches() : []),
    [reportKey, kinds.has('branch')],
  );
  const warehouses = useQuery<Warehouse[]>(
    async () => (kinds.has('warehouse') ? listWarehouses() : []),
    [reportKey, kinds.has('warehouse')],
  );
  const parties = useQuery<Party[]>(
    async () => (kinds.has('party') ? listParties() : []),
    [reportKey, kinds.has('party')],
  );
  const items = useQuery<Item[]>(
    async () => (kinds.has('item') ? listItems() : []),
    [reportKey, kinds.has('item')],
  );
  const categories = useQuery<Category[]>(
    async () => (kinds.has('category') ? listCategories() : []),
    [reportKey, kinds.has('category')],
  );
  const costCenters = useQuery<CostCenter[]>(
    async () => (kinds.has('costCenter') ? listCostCenters() : []),
    [reportKey, kinds.has('costCenter')],
  );
  const salesmen = useQuery<Salesman[]>(
    async () => (kinds.has('salesman') ? listSalesmen() : []),
    [reportKey, kinds.has('salesman')],
  );
  const accounts = useQuery<Account[]>(
    async () => (kinds.has('account') ? listAccounts() : []),
    [reportKey, kinds.has('account')],
  );
  const cashLocations = useQuery<CashLocation[]>(
    async () => (kinds.has('cashLocation') ? listCashLocations() : []),
    [reportKey, kinds.has('cashLocation')],
  );
  const vesselGroups = useQuery<VesselGroup[]>(
    async () => (kinds.has('vesselGroup') ? listVesselGroups() : []),
    [reportKey, kinds.has('vesselGroup')],
  );

  const optionsFor = useMemo(
    () => ({
      branch: (branches.data ?? []).map((row) => ({ value: row.id, label: arabicName(row) })),
      warehouse: (warehouses.data ?? []).map((row) => ({ value: row.id, label: arabicName(row) })),
      party: (parties.data ?? []).map((row) => ({ value: row.id, label: partyLabel(row) })),
      item: (items.data ?? []).map((row) => ({ value: row.id, label: itemLabel(row) })),
      category: (categories.data ?? []).map((row) => ({ value: row.id, label: arabicName(row) })),
      costCenter: (costCenters.data ?? []).map((row) => ({
        value: row.id,
        label: `${row.code} — ${arabicName(row)}`,
      })),
      salesman: (salesmen.data ?? []).map((row) => ({ value: row.id, label: row.name })),
      account: (accounts.data ?? []).map((row) => ({
        value: row.id,
        label: `${row.code} — ${arabicName(row)}`,
      })),
      cashLocation: (cashLocations.data ?? []).map((row) => ({ value: row.id, label: row.name })),
      vesselGroup: (vesselGroups.data ?? []).map((row) => ({ value: row.id, label: row.name })),
    }),
    [
      branches.data,
      warehouses.data,
      parties.data,
      items.data,
      categories.data,
      costCenters.data,
      salesmen.data,
      accounts.data,
      cashLocations.data,
      vesselGroups.data,
    ],
  );

  if (catalog.status === 'success' && !entry) {
    return (
      <EmptyState
        tone="red"
        icon={<FileText size={30} strokeWidth={1.5} />}
        title="تقرير غير معروف"
        description={`لا يوجد تقرير بالمفتاح «${reportKey}». راجع مركز التقارير.`}
        action={
          <Link href="/reports">
            <Button variant="primary" icon={<ArrowRight size={15} />}>
              مركز التقارير
            </Button>
          </Link>
        }
      />
    );
  }

  const result = report.data ?? null;

  async function download(format: ExportFormat) {
    setBusy(format);
    setNotice(null);
    try {
      const produced = await exportReport(reportKey, applied, format);
      if (format === 'pdf') {
        if (!openPrintable(produced.content)) {
          setNotice({
            kind: 'warn',
            text: 'تعذّر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.',
          });
        }
      } else {
        saveExport(produced);
        setNotice({ kind: 'ok', text: `تم تصدير ${produced.rows} سجلاً إلى الملف ${produced.filename}` });
      }
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof Error ? error.message : 'تعذّر التصدير' });
    } finally {
      setBusy(null);
    }
  }

  const pageTitle = entry?.titleAr ?? 'تقرير';

  return (
    <Screen
      title={pageTitle}
      subtitle={entry?.hintAr ?? undefined}
      crumbs={['التقارير', pageTitle]}
      meta={
        <Badge tone="blue" dot>
          {REPORT_GROUP_LABELS[entry?.group ?? ''] ?? 'تقارير'}
        </Badge>
      }
      actions={
        <>
          <Link href="/settings/printing">
            <Button variant="ghost" icon={<Printer size={15} />}>
              إعدادات الطباعة
            </Button>
          </Link>
          <Button
            variant="secondary"
            icon={<FileSpreadsheet size={15} />}
            disabled={!result || busy !== null}
            loading={busy === 'xlsx'}
            onClick={() => void download('xlsx')}
          >
            Excel
          </Button>
          <Button
            variant="secondary"
            icon={<Download size={15} />}
            disabled={!result || busy !== null}
            loading={busy === 'csv'}
            onClick={() => void download('csv')}
          >
            CSV
          </Button>
          <Button
            variant="primary"
            icon={<Printer size={15} />}
            disabled={!result || busy !== null}
            loading={busy === 'pdf'}
            onClick={() => void download('pdf')}
          >
            طباعة / PDF
          </Button>
        </>
      }
    >
      {entry ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setNotice(null);
            setApplied({ ...filters });
          }}
        >
          <FilterBand
            summary="الفترة والتصفية تُطبَّق على المستندات المرحّلة فقط."
            actions={
              <Button type="submit" variant="primary" icon={<Search size={16} />}>
                عرض التقرير
              </Button>
            }
          >
            {(layouts.data ?? []).length > 0 ? (
              <Labeled label="التصميم">
                <select
                  value={filters.layout ?? ''}
                  onChange={(event) => setFilters((current) => ({ ...current, layout: event.target.value }))}
                  className="input"
                >
                  <option value="">الافتراضي</option>
                  {(layouts.data ?? []).map((layout) => (
                    <option key={layout.id} value={layout.id}>
                      {layout.name}
                    </option>
                  ))}
                  <option value="none">كل الأعمدة</option>
                </select>
              </Labeled>
            ) : null}
            {entry.params.map((param) => (
              <FilterField
                key={param.name}
                param={param}
                value={filters[param.name] ?? ''}
                options={
                  param.kind === 'select'
                    ? (param.options ?? []).map((option) => ({ value: option.value, label: option.labelAr }))
                    : (optionsFor[param.kind as keyof typeof optionsFor] ?? [])
                }
                onChange={(value) => setFilters((current) => ({ ...current, [param.name]: value }))}
              />
            ))}
          </FilterBand>
        </form>
      ) : null}

      {notice ? (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-semibold ${
            notice.kind === 'ok'
              ? 'border-ok-line bg-ok-soft text-ok-ink'
              : notice.kind === 'danger'
                ? 'border-danger-line bg-danger-soft text-danger-ink'
                : 'border-warn-line bg-warn-soft text-warn-ink'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      {report.status === 'loading' ? (
        <div className="grid gap-4">
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </div>
          <SkeletonCard lines={7} />
        </div>
      ) : report.status === 'error' ? (
        <EmptyState
          tone="red"
          icon={<FileText size={30} strokeWidth={1.5} />}
          title="تعذّر تشغيل التقرير"
          description={report.error}
          action={
            <Button variant="primary" onClick={report.reload}>
              إعادة المحاولة
            </Button>
          }
        />
      ) : !result ? null : result.rows.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={30} strokeWidth={1.5} />}
          title="لا توجد بيانات ضمن هذه الفترة"
          description="جرّب توسيع الفترة أو إزالة المرشحات — التقارير تعرض المستندات المرحّلة فقط."
        />
      ) : (
        <>
          <KpiStrip
            items={[
              {
                label: 'عدد السطور',
                value: result.rowCount.toLocaleString('ar-EG'),
                icon: <Hash size={18} />,
                hint: `وقت الاستخراج: ${result.generatedAt.slice(0, 16).replace('T', ' ')}`,
              },
              ...result.grandTotal.slice(0, 3).map((card) => ({
                label: card.labelAr,
                value: formatCell(card.amount, 'money'),
                icon: <Banknote size={18} />,
              })),
              ...(result.grandTotal.length === 0
                ? Object.entries(result.totals)
                    .slice(0, 3)
                    .map(([key, value]) => ({
                      label: result.columns.find((column) => column.key === key)?.labelAr ?? key,
                      value: formatCell(
                        value,
                        result.columns.find((column) => column.key === key)?.type ?? 'money',
                      ),
                      icon: <Timer size={18} />,
                    }))
                : []),
            ]}
          />

          {entry?.chart && result.columns.length > 0 ? <ReportChart entry={entry} result={result} /> : null}

          <Panel
            flush
            title="نتائج التقرير"
            actions={
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(result.totals).map(([key, value]) => {
                  const column = result.columns.find((col) => col.key === key);
                  return (
                    <Badge key={key} tone="neutral" dot>
                      {column?.labelAr ?? key}: {formatCell(value, column?.type ?? 'money')}
                    </Badge>
                  );
                })}
              </div>
            }
          >
            <SortableReportTable result={result} />
          </Panel>
        </>
      )}
    </Screen>
  );
}

/** مخطط بياني تفاعلي — يعتمد أول عمود رقمي من `net`/`total`/`quantity`/`sales`/`invoices`/`count`. */
function ReportChart({ entry, result }: { entry: ReportEntry; result: ReportResult }) {
  const numericCols = result.columns.filter(
    (c) => c.type === 'money' || c.type === 'qty' || c.type === 'int',
  );
  const preferred =
    ['net', 'total', 'quantity', 'sales', 'invoices', 'count'].find((k) =>
      numericCols.some((c) => c.key === k),
    ) ??
    numericCols[0]?.key ??
    '';
  const labelCol =
    result.columns.find((c) => c.type !== 'money' && c.type !== 'qty' && c.type !== 'int' && !c.hidden)
      ?.key ??
    result.columns[0]?.key ??
    '';
  const valueCol = entry.columns.find((c) => c.key === preferred)?.labelAr ?? preferred;

  const data = useMemo(
    () =>
      result.rows.slice(0, 30).map((row, i) => ({
        name: (labelCol ? (row[labelCol] ?? `سطر ${i + 1}`) : `سطر ${i + 1}`).toString().slice(0, 18),
        value: Number(row[preferred] ?? '0') || 0,
      })),
    [result, labelCol, preferred],
  );

  return (
    <Panel
      title={`${valueCol} — ${entry.titleAr}`}
      actions={
        <Badge tone="blue" dot>
          {entry.chart === 'bar' ? 'أعمدة' : 'خط'}
        </Badge>
      }
    >
      {data.length > 0 ? (
        entry.chart === 'line' ? (
          <LineCardChart
            data={data}
            xKey="name"
            dataKey="value"
            name={valueCol}
            height={300}
            formatter={(v) => formatCell(String(v), 'money')}
          />
        ) : (
          <BarCardChart
            data={data}
            xKey="name"
            dataKey="value"
            name={valueCol}
            height={300}
            formatter={(v) => formatCell(String(v), 'money')}
          />
        )
      ) : (
        <EmptyState icon={<ListChecks size={24} strokeWidth={1.5} />} title="لا توجد قيم للرسم" />
      )}
    </Panel>
  );
}

/** جدول قابل للفرز مع صف الإجماليات المثبّت أسفل الجدول. */
function SortableReportTable({ result }: { result: ReportResult }) {
  const [sort, setSort] = useState<SortState>(null);

  const rows = useMemo(() => {
    if (!sort) return result.rows;
    const col = result.columns.find((c) => c.key === sort.key);
    const numeric = col ? isNumericColumn(col) : false;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...result.rows].sort((a, b) => {
      const av = a[sort.key] ?? '';
      const bv = b[sort.key] ?? '';
      if (numeric) return (Number(av) - Number(bv)) * factor;
      return av.localeCompare(bv, 'ar') * factor;
    });
  }, [result, sort]);

  const footer = useMemo(
    () =>
      result.columns.map((column) => {
        const value = result.totals[column.key];
        return value !== undefined ? (
          <span className="font-bold text-ink">{formatCell(value, column.type)}</span>
        ) : (
          <span className="text-muted">·</span>
        );
      }),
    [result],
  );

  return (
    <Table
      rows={rows}
      rowKey={(_row, index) => `${result.key}-${index}`}
      sortable
      sort={sort}
      onSortChange={setSort}
      dense
      footer={footer}
      columns={result.columns.map((column) => ({
        key: column.key,
        header: column.labelAr,
        numeric: isNumericColumn(column),
        sortable: true,
        cell: (row: Record<string, string>) =>
          column.type === 'qr' ? (
            <QrCell payload={row[column.key] ?? ''} />
          ) : (
            <span style={isNumericColumn(column) ? { fontVariantNumeric: 'tabular-nums' } : undefined}>
              {formatCell(row[column.key] ?? '', column.type)}
            </span>
          ),
      }))}
    />
  );
}

function FilterField({
  param,
  value,
  options,
  onChange,
}: {
  param: ReportParam;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  if (param.kind === 'date') {
    return (
      <Labeled label={param.labelAr}>
        <input
          type="date"
          dir="ltr"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="input"
        />
      </Labeled>
    );
  }
  if (
    param.kind === 'serial' ||
    param.kind === 'entryNo' ||
    param.kind === 'docNo' ||
    param.kind === 'year'
  ) {
    return (
      <Labeled label={param.labelAr}>
        <input
          type="text"
          dir="ltr"
          value={value}
          placeholder={param.kind === 'serial' ? 'SN-0001' : param.kind === 'year' ? '2026' : 'JE-000001'}
          onChange={(event) => onChange(event.target.value)}
          className="input"
        />
      </Labeled>
    );
  }
  if (param.kind === 'time') {
    return (
      <Labeled label={param.labelAr}>
        <input
          type="time"
          step="1"
          dir="ltr"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="input"
        />
      </Labeled>
    );
  }
  return (
    <Labeled label={param.labelAr}>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="input">
        <option value="">الكل</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Labeled>
  );
}


/**
 * 🧾 خلية رمز QR في جدول التقرير — البند 10.
 *
 * الرمز يُرسم بمُرمِّز `@erp/web-van/qr` نفسه الذي يرسمه الورق (لا مكتبة ثانية)، وحجمه
 * صغيرٌ ليقرأه الورق لا ليستهلك الصفّ. والحمولة إمّا TLV المرحلة الثانية من
 * `sales_invoices.zatca_qr` أو حمولةٌ نصّية بسيطة بناها استعلام التقرير حين لا ربط ضريبي.
 */
function QrCell({ payload }: { payload: string }) {
  if (!payload.trim()) return <span className="muted small">—</span>;
  return (
    <span
      className="report-qr"
      title={payload}
      // المُصيِّر يُعيد SVG من حمولةٍ نصّية آمنة (يرمّزها بنفسه)؛ لا HTML خارجي هنا.
      dangerouslySetInnerHTML={{ __html: renderQrSvgMarkup(payload, 54) }}
    />
  );
}
