'use client';

import { FormActions, Panel, Split } from '@erp/ui';
import Link from 'next/link';
import { X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { Forbidden, Loading, Screen } from '../../../components/screen';
import { Input, Select } from '../../../components/ui/input';
import { Table } from '../../../components/ui/table';
import {
  createCustomReport,
  customReportFields,
  exportCustomReport,
  getCustomReport,
  runCustomReport,
  type CustomReport,
  type CustomReportDefinition,
  type CustomReportField,
} from '../../../lib/custom-fields';
import { useSession } from '../../../lib/session';

type BaseEntity = 'party' | 'item' | 'sales_invoice' | 'employee';
type SelectedColumn = { source: 'native' | 'custom' | 'relation'; key: string; label: string; agg?: string };
type Filter = { source: 'native' | 'custom' | 'relation'; key: string; op: string; value: string };
type RunResult = {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
  totals: Record<string, number>;
  chart: { type: string; labels: string[]; series: Array<{ key: string; label: string; values: unknown[] }> };
  rowCount: number;
};

export default function CustomReportBuilderPage() {
  const { can } = useSession();
  const searchParams = useSearchParams();
  const existingId = searchParams.get('id');
  const [baseEntity, setBaseEntity] = useState<BaseEntity>('sales_invoice');
  const [name, setName] = useState('');
  const [catalog, setCatalog] = useState<CustomReportField[]>([]);
  const [columns, setColumns] = useState<SelectedColumn[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [chartType, setChartType] = useState<'table' | 'bar' | 'line' | 'pie'>('table');
  const [publicReport, setPublicReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<RunResult>();
  const [reportId, setReportId] = useState<string>();
  const [pendingExisting, setPendingExisting] = useState<CustomReport>();
  const [existingLoading, setExistingLoading] = useState(Boolean(existingId));
  const [existingApplied, setExistingApplied] = useState(false);

  useEffect(() => {
    if (!existingId) {
      setExistingLoading(false);
      return;
    }
    void getCustomReport(existingId)
      .then((report) => {
        setReportId(report.id);
        setName(report.name);
        setBaseEntity(report.baseEntity as BaseEntity);
        setChartType(report.chartType);
        setPublicReport(report.isPublic);
        setPendingExisting(report);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setExistingLoading(false));
  }, [existingId]);

  useEffect(() => {
    if (existingLoading || (existingId && existingApplied && !pendingExisting)) return;
    setCatalog([]);
    setColumns([]);
    setFilters([]);
    setResult(undefined);
    void customReportFields(baseEntity)
      .then((response) => {
        setCatalog(response.fields);
        if (pendingExisting?.baseEntity === baseEntity) {
          setColumns(pendingExisting.columns as SelectedColumn[]);
          setFilters(pendingExisting.filters as Filter[]);
          setExistingApplied(true);
          setPendingExisting(undefined);
        } else {
          setColumns(
            response.fields
              .slice(0, baseEntity === 'sales_invoice' ? 4 : 3)
              .map((field) => ({ source: field.source, key: field.key, label: field.label })),
          );
        }
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [baseEntity, existingLoading, pendingExisting]);

  const available = useMemo(
    () =>
      catalog.filter(
        (field) => !columns.some((column) => column.source === field.source && column.key === field.key),
      ),
    [catalog, columns],
  );
  if (!can('custom_reports.view'))
    return (
      <Screen title="منشئ التقارير" crumbs={['التقارير']}>
        <Forbidden />
      </Screen>
    );

  const toggleColumn = (field: CustomReportField): void => {
    const exists = columns.some((column) => column.source === field.source && column.key === field.key);
    setColumns((current) =>
      exists
        ? current.filter((column) => !(column.source === field.source && column.key === field.key))
        : [...current, { source: field.source, key: field.key, label: field.label }],
    );
  };
  const addFilter = (): void => {
    const field =
      catalog.find((candidate) => candidate.source === 'native' && candidate.key === 'status') ?? catalog[0];
    if (field)
      setFilters((current) => [...current, { source: field.source, key: field.key, op: 'eq', value: '' }]);
  };
  const updateFilter = (index: number, patch: Partial<Filter>): void =>
    setFilters((current) =>
      current.map((filter, filterIndex) => (filterIndex === index ? { ...filter, ...patch } : filter)),
    );
  const definition = (): CustomReportDefinition => ({
    name: name.trim(),
    baseEntity,
    columns,
    filters,
    chartType,
    isPublic: publicReport,
  });

  const saveAndRun = async (): Promise<void> => {
    if (!can('custom_reports.manage')) {
      setNotice('تحتاج صلاحية إدارة التقارير لحفظ تقرير جديد.');
      return;
    }
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    try {
      const saved = await createCustomReport(definition());
      setReportId(saved.id);
      const run = (await runCustomReport(saved.id)) as RunResult;
      setResult(run);
      setNotice('تم حفظ التقرير وتشغيله.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const run = async (): Promise<void> => {
    if (!reportId) {
      await saveAndRun();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      setResult((await runCustomReport(reportId)) as RunResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const download = async (format: 'csv' | 'pdf'): Promise<void> => {
    if (!reportId) {
      await saveAndRun();
      return;
    }
    setBusy(true);
    try {
      const file = await exportCustomReport(reportId, format);
      const bytes =
        file.encoding === 'base64'
          ? Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0))
          : new TextEncoder().encode(file.content);
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const firstSeries = result?.chart.series[0];
  return (
    <Screen
      title="منشئ التقارير المخصص"
      subtitle="اختر كياناً وحقولاً أصلية أو مخصصة. لا يسمح الخادم إلا بالقائمة البيضاء ولا يبني SQL من إدخال المستخدم."
      crumbs={['التقارير', 'منشئ التقارير']}
      actions={
        <Link className="text-sm font-bold text-brand-700 hover:underline" href="/reports/custom">
          التقارير المحفوظة
        </Link>
      }
    >
      <Split
        className="is-rail-wide"
        rail={
          <Panel title="تعريف التقرير">
            <div className="grid gap-3">
              <Input
                label="اسم التقرير"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="مبيعات حسب الضمان"
              />
              <Select
                label="الكيان الأساسي"
                value={baseEntity}
                onChange={(event) => setBaseEntity(event.target.value as BaseEntity)}
              >
                <option value="sales_invoice">فواتير المبيعات</option>
                <option value="party">العملاء والموردون</option>
                <option value="item">الأصناف</option>
                <option value="employee">الموظفون</option>
              </Select>
              <Select
                label="نوع الرسم"
                value={chartType}
                onChange={(event) => setChartType(event.target.value as typeof chartType)}
              >
                <option value="table">جدول</option>
                <option value="bar">أعمدة</option>
                <option value="line">خطي</option>
                <option value="pie">دائري</option>
              </Select>
              <label className="check">
                <input
                  type="checkbox"
                  checked={publicReport}
                  onChange={(event) => setPublicReport(event.target.checked)}
                />{' '}
                <span>تقرير عام لأعضاء المنشأة</span>
              </label>
              <div className="flex gap-2">
                <button
                  className="btn sm grow"
                  disabled={!reportId || busy}
                  type="button"
                  onClick={() => void download('csv')}
                >
                  CSV
                </button>
                <button
                  className="btn sm grow"
                  disabled={!reportId || busy}
                  type="button"
                  onClick={() => void download('pdf')}
                >
                  PDF / طباعة
                </button>
              </div>
            </div>
            <FormActions
              note={notice ?? (error ? <span className="text-danger-ink">{error}</span> : undefined)}
            >
              <button className="btn" disabled={busy || !reportId} type="button" onClick={() => void run()}>
                تشغيل
              </button>
              <button
                className="btn primary"
                disabled={busy || !name.trim() || columns.length === 0}
                type="button"
                onClick={() => void saveAndRun()}
              >
                حفظ وتشغيل
              </button>
            </FormActions>
          </Panel>
        }
      >
        <Panel
          title="الأعمدة المسموحة"
          hint={
            available.length === 0 && catalog.length > 0
              ? 'تم اختيار كل الحقول المتاحة.'
              : 'الحقول الأصلية والمخصصة لهذا الكيان فقط.'
          }
        >
          {!catalog.length ? (
            <Loading rows={4} />
          ) : (
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {catalog.map((field) => {
                const checked = columns.some(
                  (column) => column.source === field.source && column.key === field.key,
                );
                return (
                  <label
                    key={`${field.source}:${field.key}`}
                    className="check"
                    title={`${field.source}:${field.key}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleColumn(field)} />
                    <span>{field.label}</span>
                  </label>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          title="الفلاتر"
          hint="تُطبَّق بالترتيب على نتيجة التقرير."
          actions={
            <button className="btn sm" type="button" onClick={addFilter}>
              إضافة فلتر
            </button>
          }
        >
          {filters.length === 0 ? (
            <p className="m-0 text-sm text-muted">لا توجد فلاتر — يعرض التقرير كل الصفوف.</p>
          ) : (
            <div className="grid gap-2">
              {filters.map((filter, index) => (
                <div key={index} className="grid gap-2 md:grid-cols-[1fr_110px_1fr_auto]">
                  <select
                    className="input"
                    value={`${filter.source}:${filter.key}`}
                    onChange={(event) => {
                      const [source, ...rest] = event.target.value.split(':');
                      updateFilter(index, { source: source as Filter['source'], key: rest.join(':') });
                    }}
                  >
                    {catalog.map((field) => (
                      <option key={`${field.source}:${field.key}`} value={`${field.source}:${field.key}`}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input"
                    value={filter.op}
                    onChange={(event) => updateFilter(index, { op: event.target.value })}
                  >
                    <option value="eq">يساوي</option>
                    <option value="contains">يتضمن</option>
                    <option value="gt">أكبر من</option>
                    <option value="lt">أصغر من</option>
                  </select>
                  <input
                    className="input"
                    value={filter.value}
                    onChange={(event) => updateFilter(index, { value: event.target.value })}
                    placeholder="القيمة"
                  />
                  <button
                    className="btn icon sm danger"
                    type="button"
                    aria-label="حذف الفلتر"
                    onClick={() =>
                      setFilters((current) => current.filter((_, filterIndex) => filterIndex !== index))
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {result ? (
          <Panel flush title="النتيجة" hint={`${result.rowCount} صف`}>
            {result.chart.type !== 'table' && firstSeries ? (
              <div className="p-4">
                <div className="flex h-36 items-end gap-2">
                  {firstSeries.values.slice(0, 24).map((value, index) => {
                    const numeric = Number(value) || 0;
                    const max = Math.max(
                      ...firstSeries.values.slice(0, 24).map((entry) => Number(entry) || 0),
                      1,
                    );
                    return (
                      <div
                        className="flex-1"
                        key={index}
                        title={`${result.chart.labels[index] ?? index + 1}: ${numeric}`}
                      >
                        <div
                          className="rounded-t bg-brand-500"
                          style={{ height: `${Math.max(4, (numeric / max) * 100)}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="m-0 mt-2 text-center text-xs text-muted">{firstSeries.label}</p>
              </div>
            ) : null}
            <Table
              bare
              columns={result.columns.map((column) => ({
                key: column.key,
                header: column.label,
                cell: (row: Record<string, unknown>) => String(row[column.key] ?? ''),
              }))}
              rows={result.rows}
              rowKey={(_, index) => String(index)}
            />
          </Panel>
        ) : null}
      </Split>
    </Screen>
  );
}
