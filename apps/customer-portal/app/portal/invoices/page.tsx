'use client';

import { FilterBand, PageHead, Panel } from '@erp/ui';
import Link from 'next/link';
import { useState } from 'react';

import { Empty } from '../../../components/card';
import { PortalShell } from '../../../components/portal-shell';
import { fetchInvoices } from '../../../lib/api';
import { dateText, moneyText } from '../../../lib/format';
import { useAsync } from '../../../lib/use-async';

const PAYMENT_AR: Record<string, string> = { unpaid: 'غير مسددة', partial: 'مسددة جزئياً', paid: 'مسددة' };
const KIND_AR: Record<string, string> = { sale: 'فاتورة مبيعات', return: 'مردود مبيعات' };

function Invoices() {
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [applied, setApplied] = useState<{ from?: string; to?: string }>({});
  const [search, setSearch] = useState('');
  const invoices = useAsync(() => fetchInvoices(applied), [applied.from, applied.to]);

  const rows = (invoices.data ?? []).filter((invoice) =>
    search ? (invoice.number ?? '').includes(search.trim()) : true,
  );

  return (
    <>
      <PageHead
        title="فواتيري"
        description="الفواتير المرحّلة الصادرة باسمك، مع إمكانية فتح الفاتورة وطباعتها بصيغتها الرسمية."
      />

      <FilterBand
        summary={`${rows.length} فاتورة`}
        actions={
          <>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setRange({ from: '', to: '' });
                setApplied({});
                setSearch('');
              }}
            >
              إلغاء الفلترة
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={() => setApplied({ from: range.from || undefined, to: range.to || undefined })}
            >
              عرض
            </button>
          </>
        }
      >
        <label className="field">
          <span>من تاريخ</span>
          <input
            className="input"
            type="date"
            value={range.from}
            onChange={(event) => setRange({ ...range, from: event.target.value })}
          />
        </label>
        <label className="field">
          <span>إلى تاريخ</span>
          <input
            className="input"
            type="date"
            value={range.to}
            onChange={(event) => setRange({ ...range, to: event.target.value })}
          />
        </label>
        <label className="field">
          <span>رقم الفاتورة</span>
          <input
            className="input"
            placeholder="بحث برقم الفاتورة"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </FilterBand>

      <Panel title="الفواتير الصادرة" hint="المرحّلة فقط — افتح الفاتورة لعرضها أو دفعها." flush>
        {invoices.status === 'loading' ? (
          <p className="panel-state">جارٍ تحميل الفواتير…</p>
        ) : invoices.status === 'error' ? (
          <p className="panel-state" role="alert">
            {invoices.error}
          </p>
        ) : rows.length === 0 ? (
          <Empty bare title="لا توجد فواتير مطابقة" detail="جرّب توسيع الفترة أو مسح رقم الفاتورة." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>النوع</th>
                  <th>التاريخ</th>
                  <th>الصافي</th>
                  <th>الضريبة</th>
                  <th>الإجمالي</th>
                  <th>المسدد</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{invoice.number ?? '—'}</td>
                    <td>{KIND_AR[invoice.kind] ?? invoice.kind}</td>
                    <td>{dateText(invoice.posted_at ?? invoice.created_at)}</td>
                    <td>{moneyText(invoice.subtotal)}</td>
                    <td>{moneyText(invoice.tax_total)}</td>
                    <td>
                      <strong>{moneyText(invoice.total)}</strong>
                    </td>
                    <td>{moneyText(invoice.paid_total)}</td>
                    <td>
                      <span className={`badge ${invoice.payment_status === 'paid' ? 'paid' : 'open'}`}>
                        {PAYMENT_AR[invoice.payment_status] ?? invoice.payment_status}
                      </span>
                    </td>
                    <td>
                      <Link className="btn" href={`/portal/invoices/${invoice.id}`}>
                        فتح
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

export default function InvoicesPage() {
  return (
    <PortalShell>
      <Invoices />
    </PortalShell>
  );
}
