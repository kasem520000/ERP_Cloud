'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Input,
  Select,
  type Column,
} from '@erp/ui';
import { apiData, apiErrorText, apiList } from '@erp/web-core/api';

import { listState, rowKeyFrom } from '../../lib/ui-kit';
import { openServerPrintHtml } from '../../lib/server-print';

type ReportMeta = {
  key: string;
  titleAr?: string;
  nameAr?: string;
  category?: string;
};

type ReportResult = {
  titleAr?: string;
  columns?: Array<{ key: string; label?: string; header?: string }>;
  rows?: Array<Record<string, unknown>>;
};

const REPORT_HEADER_AR: Record<string, string> = {
  number: 'الرقم',
  invoice_no: 'رقم الفاتورة',
  voucher_no: 'رقم السند',
  day: 'التاريخ',
  date: 'التاريخ',
  created_at: 'التاريخ',
  party: 'الطرف',
  customer: 'العميل',
  supplier: 'المورد',
  branch: 'الفرع',
  warehouse: 'المستودع',
  item: 'الصنف',
  sku: 'رمز الصنف',
  code: 'الرمز',
  account_code: 'رمز الحساب',
  accountCode: 'رمز الحساب',
  name: 'الاسم',
  name_ar: 'الاسم',
  account_name: 'اسم الحساب',
  accountName: 'اسم الحساب',
  subtotal: 'الصافي قبل الضريبة',
  net: 'الصافي',
  tax_total: 'الضريبة',
  vat: 'الضريبة',
  total: 'الإجمالي',
  paid_total: 'المدفوع',
  due: 'المتبقي',
  outstanding: 'المتبقي',
  debit: 'مدين',
  credit: 'دائن',
  balance: 'الرصيد',
  opening_balance: 'رصيد أول المدة',
  closing_balance: 'الرصيد الختامي',
  qty: 'الكمية',
  quantity: 'الكمية',
  status: 'الحالة',
  payment_status: 'حالة السداد',
  qr: 'رمز التحقق الضريبي',
};

const CELL_VALUE_AR: Record<string, string> = {
  paid: 'مدفوع بالكامل',
  partial: 'سداد جزئي',
  unpaid: 'غير مسدد / آجل',
  posted: 'مرحَّل',
  draft: 'مسودة',
  void: 'ملغى',
  'Main Warehouse': 'المستودع الرئيسي',
};

function formatReportCell(val: unknown): string {
  if (val == null || val === '') return '—';
  const str = String(val);
  return CELL_VALUE_AR[str] ?? str;
}

export default function BakerySystemReportsPage() {
  const [catalog, setCatalog] = useState<ReportMeta[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiList<ReportMeta>('/reports')
      .then((list) => {
        setCatalog(list);
        if (list[0]?.key) setSelectedKey(list[0].key);
        else setLoading(false);
      })
      .catch((caught) => {
        setError(apiErrorText(caught, 'تعذّر قراءة فهرس التقارير'));
        setLoading(false);
      });
  }, []);

  const runReport = useCallback(async () => {
    if (!selectedKey) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);
      const data = await apiData<ReportResult>(
        `/reports/${encodeURIComponent(selectedKey)}${qs.toString() ? `?${qs.toString()}` : ''}`,
      );
      setResult(data);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر تشغيل التقرير المحدد'));
    } finally {
      setLoading(false);
    }
  }, [selectedKey, fromDate, toDate]);

  useEffect(() => {
    if (selectedKey) void runReport();
  }, [selectedKey, runReport]);

  const printCurrentReport = async () => {
    if (!selectedKey) return;
    const qs = new URLSearchParams();
    if (fromDate) qs.set('from', fromDate);
    if (toDate) qs.set('to', toDate);
    await openServerPrintHtml(
      `/reports/print/${encodeURIComponent(selectedKey)}${qs.toString() ? `?${qs.toString()}` : ''}`,
    );
  };

  const sampleRow = result?.rows?.[0] ?? {};
  const dynamicColumns: Column<Record<string, unknown>>[] =
    result?.columns && result.columns.length > 0
      ? result.columns.map((c) => ({
          key: c.key,
          header: c.label ?? c.header ?? REPORT_HEADER_AR[c.key] ?? c.key,
          cell: (r) => formatReportCell(r[c.key]),
        }))
      : Object.keys(sampleRow)
          .filter((k) => k !== 'id' && k !== 'qr')
          .slice(0, 9)
          .map((k) => ({
            key: k,
            header: REPORT_HEADER_AR[k] ?? k,
            numeric: /total|subtotal|due|debit|credit|balance|qty|amount/i.test(k),
            ltr: /number|code|day|date/i.test(k),
            cell: (r) => formatReportCell(r[k]),
          }));

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">التقارير العامة والمالية</h1>
          <p className="ui-page-sub">
            استعراض القوائم المالية وميزان المراجعة وأعمار الديون وتقارير المبيعات والمخزون مع طباعة A4 رسمية.
          </p>
        </div>
        <div className="ui-page-actions">
          <Button disabled={!selectedKey} onClick={() => void printCurrentReport()} variant="primary">
            طباعة A4 رسمية
          </Button>
          <Button onClick={() => void runReport()} size="sm">
            تشغيل التقرير
          </Button>
        </div>
      </header>

      <div className="ui-screen-body">
        <Card>
          <CardHeader subtitle="اختر التقرير وحدد الفترة الزمنية لعرض النتائج أو طباعتها." title="معاملات التقرير" />
          <CardBody>
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              <Select
                label="التقرير المطلوب"
                onChange={(e) => setSelectedKey(e.target.value)}
                options={catalog.map((r) => ({
                  value: r.key,
                  label: r.titleAr ?? r.nameAr ?? r.key,
                }))}
                value={selectedKey}
              />
              <Input label="من تاريخ" onChange={(e) => setFromDate(e.target.value)} type="date" value={fromDate} />
              <Input label="إلى تاريخ" onChange={(e) => setToDate(e.target.value)} type="date" value={toDate} />
            </div>

            <DataTable
              columns={
                dynamicColumns.length > 0
                  ? dynamicColumns
                  : [{ key: 'empty', header: 'النتيجة', cell: () => '—' }]
              }
              empty="لا سطور مطابقة للفترة المختارة"
              rows={result?.rows ?? []}
              rowKey={rowKeyFrom(['id', 'code', 'accountCode', 'number', 'key'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
