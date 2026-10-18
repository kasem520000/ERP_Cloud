'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FilePlus2, ScanLine } from 'lucide-react';
import { Panel } from '@erp/ui';

import { DataTable, QueryView } from '../../../components/data-view';
import { Screen } from '../../../components/screen';
import { Button } from '../../../components/ui/button';
import { apiList } from '../../../lib/api';
import { listParties, money, partyLabel, shortDate, statusLabel, type Party } from '../../../lib/lookups';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

type Invoice = {
  id: string;
  number: string | null;
  kind: string;
  status: string;
  partyId: string;
  supplierReferenceNo: string | null;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  paidTotal: string;
  createdAt: string;
};

const KIND_LABELS: Record<string, string> = { purchase: 'مشتريات', purchase_return: 'مردود مشتريات' };

const STATUS_CHIPS: Array<{ key: string; label: string; test: (row: Invoice) => boolean }> = [
  { key: 'all', label: 'الكل', test: () => true },
  { key: 'draft', label: 'مسودة', test: (row) => row.status === 'draft' },
  { key: 'posted', label: 'مرحّلة', test: (row) => row.status === 'posted' },
  { key: 'void', label: 'ملغاة', test: (row) => row.status === 'void' },
];

export default function PurchaseInvoicesPage() {
  const { can } = useSession();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const invoices = useQuery<Invoice[]>(() => apiList<Invoice>('/purchase-invoices'), []);
  const suppliers = useQuery<Party[]>(() => listParties('supplier'), []);

  const supplierName = (id: string) => {
    const party = (suppliers.data ?? []).find((entry) => entry.id === id);
    return party ? partyLabel(party) : '—';
  };

  const rows = useMemo(() => {
    const chip = STATUS_CHIPS.find((entry) => entry.key === status) ?? STATUS_CHIPS[0]!;
    const q = query.trim().toLowerCase();
    return (invoices.data ?? [])
      .filter((row) => !kind || row.kind === kind)
      .filter(chip.test)
      .filter(
        (row) =>
          !q ||
          (row.number ?? '').toLowerCase().includes(q) ||
          (row.supplierReferenceNo ?? '').toLowerCase().includes(q) ||
          supplierName(row.partyId).toLowerCase().includes(q),
      );
  }, [invoices.data, kind, status, query, suppliers.data]);

  const all = invoices.data ?? [];
  const posted = all.filter((row) => row.status === 'posted');
  const outstanding = posted.reduce((sum, row) => sum + Number(row.total) - Number(row.paidTotal), 0);

  return (
    <Screen
      title="فواتير المشتريات"
      subtitle="فواتير الموردين بما فيها التكاليف الإضافية التي تُحمَّل على تكلفة الأصناف عند الترحيل."
      crumbs={['المشتريات', 'العمليات']}
      kpis={[
        { label: 'إجمالي الفواتير', value: all.length, hint: 'مرحّلة ومسودات' },
        {
          label: 'قيمة المشتريات',
          value: money(posted.reduce((sum, row) => sum + Number(row.total), 0)),
          hint: 'المرحّل فقط، شامل الضريبة',
        },
        {
          label: 'مستحق للموردين',
          value: money(outstanding),
          hint: 'المتبقي على الفواتير المرحّلة',
          tone: outstanding > 0 ? 'warn' : 'up',
        },
        {
          label: 'مسودات',
          value: all.filter((row) => row.status === 'draft').length,
          hint: 'لم تُرحَّل بعد',
        },
      ]}
      actions={
        <>
          {can('purchase.ocr.use') && (
            <Link href="/purchases/invoices/ocr">
              <Button variant="secondary" size="lg" icon={<ScanLine size={16} />}>
                قراءة فاتورة بالـ OCR
              </Button>
            </Link>
          )}
          {can('purchase.invoice.create') && (
            <Link href="/purchases/invoices/new">
              <Button variant="primary" size="lg" icon={<FilePlus2 size={17} />}>
                فاتورة مشتريات جديدة
              </Button>
            </Link>
          )}
        </>
      }
      filters={
        <div className="ui-filter-bar">
          <div className="ui-filter-fields">
            <label className="field" style={{ marginBottom: 0 }}>
              <span>بحث</span>
              <input
                className="input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="رقم الفاتورة أو المورد"
              />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>النوع</span>
              <select className="input" value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="">كل الأنواع</option>
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="ui-filter-actions">
            <span className="ui-filter-summary">
              {rows.length} من {all.length}
            </span>
          </div>
        </div>
      }
      chips={
        <div className="ui-chip-row">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-pressed={status === chip.key}
              className="ui-chip"
              onClick={() => setStatus(chip.key)}
            >
              {chip.label}
              <span className="ui-chip-count">{all.filter(chip.test).length}</span>
            </button>
          ))}
          <span className="ui-chip-spacer">{rows.length} نتيجة</span>
        </div>
      }
    >
      <Panel flush>
        <QueryView
          query={invoices}
          isEmpty={() => rows.length === 0}
          empty="لا توجد فواتير مشتريات"
          emptyDetail="سجّل أول فاتورة مورد."
        >
          {() => (
            <DataTable
              rows={rows}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'number',
                  header: 'الرقم',
                  align: 'ltr',
                  cell: (row) => <Link href={`/purchases/invoices/${row.id}`}>{row.number ?? 'مسودة'}</Link>,
                },
                { key: 'kind', header: 'النوع', cell: (row) => KIND_LABELS[row.kind] ?? row.kind },
                { key: 'supplier', header: 'المورد', cell: (row) => supplierName(row.partyId) },
                { key: 'ref', header: 'مرجع المورد', align: 'ltr', cell: (row) => row.supplierReferenceNo ?? '—' },
                { key: 'date', header: 'التاريخ', align: 'ltr', cell: (row) => shortDate(row.createdAt) },
                { key: 'net', header: 'قبل الضريبة', align: 'num', cell: (row) => money(row.subtotal) },
                { key: 'tax', header: 'الضريبة', align: 'num', cell: (row) => money(row.taxTotal) },
                { key: 'total', header: 'الإجمالي', align: 'num', cell: (row) => money(row.total) },
                { key: 'status', header: 'الحالة', cell: (row) => <span className="badge">{statusLabel(row.status)}</span> },
                {
                  key: 'print',
                  header: '',
                  cell: (row) => (
                    <Link className="btn sm" href={`/print/purchase-invoice/${row.id}`}>
                      طباعة
                    </Link>
                  ),
                },
              ]}
            />
          )}
        </QueryView>
      </Panel>
    </Screen>
  );
}
