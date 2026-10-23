'use client';

import Link from 'next/link';
import { FilterBand, KpiStrip, Page, PageHead, Panel } from '@erp/ui';
import { FilePlus2, Printer, ReceiptText, Search, X } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { Table, type SortState } from '../../../components/ui/table';
import { apiList } from '../../../lib/api';
import { listBranches, listParties, money, shortDate, type Branch, type Party } from '../../../lib/lookups';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

type Invoice = {
  id: string;
  number: string | null;
  kind: string;
  status: string;
  branchId: string | null;
  partyId: string | null;
  cashCustomerName: string | null;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  paidTotal: string;
  paymentStatus: string;
  postedAt: string | null;
  createdAt: string;
};

/** Relative Arabic time: "منذ ساعتين". */
function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (diff < minute) return 'الآن';
  if (diff < hour) {
    const m = Math.round(diff / minute);
    return m === 1 ? 'منذ دقيقة' : m === 2 ? 'منذ دقيقتين' : m <= 10 ? `منذ ${m} دقائق` : `منذ ${m} دقيقة`;
  }
  if (diff < day) {
    const h = Math.round(diff / hour);
    return h === 1 ? 'منذ ساعة' : h === 2 ? 'منذ ساعتين' : h <= 10 ? `منذ ${h} ساعات` : `منذ ${h} ساعة`;
  }
  const d = Math.round(diff / day);
  return d === 1 ? 'منذ يوم' : d === 2 ? 'منذ يومين' : d <= 10 ? `منذ ${d} أيام` : `منذ ${d} يوماً`;
}

const KIND_LABELS: Record<string, string> = {
  sale: 'فاتورة مبيعات',
  sale_return: 'مردود مبيعات',
  credit_note: 'إشعار دائن',
  debit_note: 'إشعار مدين',
  quotation: 'عرض أسعار',
};

type StatusChip = { key: string; label: string; test: (row: Invoice) => boolean };

const STATUS_CHIPS: StatusChip[] = [
  { key: 'all', label: 'الكل', test: () => true },
  { key: 'posted', label: 'مرحّلة', test: (row) => row.status === 'posted' },
  { key: 'draft', label: 'مسودة', test: (row) => row.status === 'draft' },
  { key: 'paid', label: 'مسددة', test: (row) => row.paymentStatus === 'paid' },
  {
    key: 'unpaid',
    label: 'غير مسددة',
    test: (row) => row.paymentStatus !== 'paid' && row.status === 'posted',
  },
];

function InvoicesInner() {
  const { can } = useSession();
  const [searchParams] = useState(() =>
    typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search),
  );
  const highlightedId = searchParams.get('id');

  const invoices = useQuery<Invoice[]>(() => apiList<Invoice>('/sales/invoices'), []);
  const parties = useQuery<Party[]>(() => listParties('customer'), []);
  const branches = useQuery<Branch[]>(() => listBranches(), []);

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('all');
  const [kind, setKind] = useState('');
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const branchName = (id: string | null) => (branches.data ?? []).find((b) => b.id === id)?.nameAr ?? '—';
  const customerOf = (row: Invoice) => {
    if (row.cashCustomerName) return `${row.cashCustomerName} (نقدي)`;
    const party = (parties.data ?? []).find((p) => p.id === row.partyId);
    return party?.name ?? '—';
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const chipDef = STATUS_CHIPS.find((c) => c.key === chip) ?? STATUS_CHIPS[0]!;
    let rows = (invoices.data ?? []).filter((row) => chipDef.test(row));
    if (kind) rows = rows.filter((row) => row.kind === kind);
    if (branchId) rows = rows.filter((row) => row.branchId === branchId);
    if (q)
      rows = rows.filter(
        (row) =>
          (row.number ?? '').toLowerCase().includes(q) ||
          customerOf(row).toLowerCase().includes(q) ||
          branchName(row.branchId).toLowerCase().includes(q),
      );
    if (from) rows = rows.filter((row) => (row.postedAt ?? row.createdAt).slice(0, 10) >= from);
    if (to) rows = rows.filter((row) => (row.postedAt ?? row.createdAt).slice(0, 10) <= to);
    if (sort) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        if (sort.key === 'total') return (Number(a.total) - Number(b.total)) * dir;
        if (sort.key === 'date')
          return (a.postedAt ?? a.createdAt).localeCompare(b.postedAt ?? b.createdAt) * dir;
        if (sort.key === 'customer') return customerOf(a).localeCompare(customerOf(b), 'ar') * dir;
        return 0;
      });
    }
    return rows;
  }, [invoices.data, parties.data, branches.data, query, chip, kind, branchId, from, to, sort]);

  const hasFilters = Boolean(query || kind || branchId || from || to || chip !== 'all');

  function clearFilters() {
    setQuery('');
    setChip('all');
    setKind('');
    setBranchId('');
    setFrom('');
    setTo('');
  }

  return (
    <Page>
      <PageHead
        breadcrumbs={['المبيعات', 'العمليات']}
        title="فواتير المبيعات"
        description="كل الفواتير: المسودات القابلة للتعديل والمرحّلة بأرقامها الرسمية."
        actions={
          can('sales.invoice.create') ? (
            <Link href="/sales/invoices/new">
              <Button variant="primary" size="lg" icon={<FilePlus2 size={17} />}>
                فاتورة جديدة
              </Button>
            </Link>
          ) : null
        }
      />

      <KpiStrip
        items={[
          {
            label: 'إجمالي الفواتير',
            value: (invoices.data ?? []).length,
            hint: 'مرحّلة ومسودات في الفترة',
          },
          {
            label: 'قيمة المبيعات',
            value: money(
              (invoices.data ?? [])
                .filter((row) => row.status === 'posted')
                .reduce((sum, row) => {
                  const amt = Number(row.total);
                  if (row.kind === 'sale_return' || row.kind === 'credit_note') return sum - amt;
                  if (row.kind === 'sale' || row.kind === 'debit_note') return sum + amt;
                  return sum;
                }, 0),
            ),
            hint: 'صافي المبيعات المرحّلة، شامل الضريبة',
          },
          {
            label: 'غير مسددة',
            value: money(
              (invoices.data ?? [])
                .filter(
                  (row) =>
                    row.status === 'posted' &&
                    row.kind === 'sale' &&
                    row.paymentStatus !== 'paid',
                )
                .reduce((sum, row) => sum + (Number(row.total) - Number(row.paidTotal)), 0),
            ),
            hint: 'المتبقي على العملاء (ذمم المبيعات)',
            tone: (invoices.data ?? []).some(
              (row) =>
                row.status === 'posted' &&
                row.kind === 'sale' &&
                row.paymentStatus !== 'paid',
            )
              ? 'warn'
              : 'up',
          },
          {
            label: 'مسودات',
            value: (invoices.data ?? []).filter((row) => row.status === 'draft').length,
            hint: 'قابلة للتعديل قبل الترحيل',
          },
        ]}
      />

      <FilterBand
        summary={`${filtered.length} من ${(invoices.data ?? []).length}`}
        actions={
          hasFilters ? (
            <Button variant="ghost" size="md" icon={<X size={14} />} onClick={clearFilters}>
              مسح الفلاتر
            </Button>
          ) : null
        }
      >
        <label className="field" style={{ marginBottom: 0 }}>
          <span>بحث</span>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="رقم الفاتورة أو العميل"
          />
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>النوع</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">كل الأنواع</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>الفرع</span>
          <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">كل الفروع</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.nameAr}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>من تاريخ</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>إلى تاريخ</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </FilterBand>

      <div className="ui-chip-row">
        {STATUS_CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={chip === c.key}
            className="ui-chip"
            onClick={() => setChip(c.key)}
          >
            {c.label}
            <span className="ui-chip-count">
              {c.key === 'all' ? (invoices.data ?? []).length : (invoices.data ?? []).filter(c.test).length}
            </span>
          </button>
        ))}
        <span className="ui-chip-spacer">
          {filtered.length} نتيجة {invoices.data ? `من ${(invoices.data ?? []).length}` : ''}
        </span>
      </div>

      {/* ------------------------------------------------ bulk bar */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-info-soft px-4 py-2.5">
          <span className="text-[13px] font-bold text-brand-800">تم تحديد {selected.size} فاتورة</span>
          <span className="text-[12.5px] text-brand-700">
            الإجمالي:{' '}
            {money(filtered.filter((r) => selected.has(r.id)).reduce((s, r) => s + Number(r.total), 0))}
          </span>
          <div className="ms-auto flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>
              إلغاء التحديد
            </Button>
            <Link href="/reports/sales">
              <Button size="sm" variant="primary">
                تصدير المحدد
              </Button>
            </Link>
          </div>
        </div>
      ) : null}

      {highlightedId ? (
        <div className="flex items-center gap-2 rounded-xl border border-warn-line bg-warn-soft px-4 py-2.5 text-[12.5px] font-semibold text-warn-ink">
          <Search size={14} />
          تم فتح الفاتورة <code dir="ltr">{highlightedId}</code> من تقرير آخر — الصف المميز أدناه هو المطلوب.
        </div>
      ) : null}

      {/* ------------------------------------------------ table */}
      {invoices.status === 'error' ? (
        <EmptyState
          tone="red"
          icon={<ReceiptText size={30} strokeWidth={1.5} />}
          title="تعذر تحميل الفواتير"
          description={invoices.error}
          action={
            <Button variant="primary" onClick={invoices.reload}>
              إعادة المحاولة
            </Button>
          }
        />
      ) : (
        <Panel
          title="قائمة الفواتير"
          hint="اضغط أي صف لفتح الفاتورة؛ التحديد الجماعي يفعّل شريط الإجراءات أعلاه."
          flush
        >
          <Table
            loading={invoices.status === 'loading'}
            rows={filtered}
            rowKey={(row) => row.id}
            activeKey={highlightedId ?? undefined}
            selectable
            pageSize={20}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            sortable
            sort={sort}
            onSortChange={setSort}
            onRowClick={(row) => (window.location.href = `/sales/invoices/${row.id}`)}
            empty={
              hasFilters
                ? 'لا توجد فواتير تطابق المرشحات — جرّب توسيع النطاق.'
                : 'لا توجد فواتير بعد. ابدأ بإصدار فاتورة مبيعات جديدة.'
            }
            actions={(row) => [
              {
                label: 'عرض الفاتورة',
                onClick: () => {
                  window.location.href = `/sales/invoices/${row.id}`;
                },
              },
              {
                label: 'طباعة',
                icon: <Printer size={14} />,
                onClick: () => {
                  window.location.href = `/print/sales-invoice/${row.id}`;
                },
              },
            ]}
            columns={[
              {
                key: 'number',
                header: 'الرقم',
                ltr: true,
                cell: (row) => <span className="font-bold text-brand-700">{row.number ?? 'مسودة'}</span>,
              },
              {
                key: 'kind',
                header: 'النوع',
                cell: (row) => (
                  <Badge tone={row.kind === 'quotation' ? 'purple' : 'blue'}>
                    {KIND_LABELS[row.kind] ?? row.kind}
                  </Badge>
                ),
              },
              { key: 'customer', header: 'العميل', sortable: true, cell: (row) => customerOf(row) },
              { key: 'branch', header: 'الفرع', cell: (row) => branchName(row.branchId) },
              {
                key: 'date',
                header: 'التاريخ',
                sortable: true,
                cell: (row) => (
                  <span title={shortDate(row.postedAt ?? row.createdAt)}>
                    <span className="font-semibold text-ink-2">
                      {relativeTime(row.postedAt ?? row.createdAt)}
                    </span>
                    <span className="block text-xs text-muted">
                      {shortDate(row.postedAt ?? row.createdAt)}
                    </span>
                  </span>
                ),
              },
              {
                key: 'total',
                header: 'الإجمالي',
                numeric: true,
                sortable: true,
                cell: (row) => money(row.total),
              },
              {
                key: 'paid',
                header: 'المدفوع',
                numeric: true,
                cell: (row) => (
                  <span className={Number(row.paidTotal) >= Number(row.total) ? 'text-ok' : 'text-warn'}>
                    {money(row.paidTotal)}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'الحالة',
                cell: (row) => (
                  <span className="inline-flex gap-1.5">
                    <Badge tone={row.status === 'posted' ? 'green' : 'amber'} dot>
                      {row.status === 'posted' ? 'مرحّلة' : 'مسودة'}
                    </Badge>
                    {row.status === 'posted' ? (
                      <Badge tone={row.paymentStatus === 'paid' ? 'blue' : 'amber'}>
                        {row.paymentStatus === 'paid' ? 'مسدّدة' : 'غير مسدّدة'}
                      </Badge>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        </Panel>
      )}
    </Page>
  );
}

export default function SalesInvoicesPage() {
  return (
    <Suspense fallback={null}>
      <InvoicesInner />
    </Suspense>
  );
}
