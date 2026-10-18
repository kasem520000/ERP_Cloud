'use client';

import Link from 'next/link';
import { Decimal } from 'decimal.js';
import { ContentPanel, PageFrame, PageHeader, SummaryStat, TableViewport, ViewNotice } from '@erp/ui/page';

import { PortalShell, usePortalProfile } from '../../components/portal-shell';
import { fetchInvoices, fetchPayments } from '../../lib/api';
import { dateText, moneyText } from '../../lib/format';
import { useAsync } from '../../lib/use-async';

const STATUS_AR: Record<string, string> = {
  unpaid: 'غير مسددة',
  partial: 'مسددة جزئياً',
  paid: 'مسددة',
  posted: 'مرحّلة',
  draft: 'مسودة',
  voided: 'ملغاة',
};

function Dashboard() {
  const { profile } = usePortalProfile();
  const invoices = useAsync(() => fetchInvoices(), []);
  const payments = useAsync(() => fetchPayments(), []);

  const rows = invoices.data ?? [];
  const outstanding = rows.reduce(
    (sum, invoice) => sum.plus(new Decimal(invoice.total || '0').minus(invoice.paid_total || '0')),
    new Decimal(0),
  );
  const overdueCount = rows.filter((invoice) => invoice.payment_status !== 'paid').length;
  const lastPayment = (payments.data ?? [])[0];

  return (
    <PageFrame>
      <PageHeader
        title="لوحة الحساب"
        eyebrow="نظرة عامة"
        description={
          <>ملخص تعاملك مع {profile?.company.nameAr || 'المورد'} — الفواتير الصادرة لك والمبالغ المسددة.</>
        }
      />

      <div className="portal-stats">
        <SummaryStat
          label="الرصيد المستحق"
          value={moneyText(profile?.balance ?? '0')}
          hint="حسب دفاتر المورد"
        />
        <SummaryStat
          label="غير المسدد من الفواتير"
          value={invoices.status === 'ready' ? moneyText(outstanding.toFixed(2)) : '—'}
          hint={invoices.status === 'ready' ? `${overdueCount} فاتورة مفتوحة` : 'بانتظار بيانات الفواتير'}
        />
        <SummaryStat label="عدد الفواتير" value={invoices.status === 'ready' ? String(rows.length) : '—'} hint="الفواتير المرحّلة الصادرة لك" />
        <SummaryStat
          label="آخر دفعة"
          value={lastPayment ? moneyText(lastPayment.amount) : '—'}
          hint={lastPayment ? dateText(lastPayment.day) : payments.status === 'ready' ? 'لا توجد دفعات مسجلة' : 'بانتظار بيانات الدفعات'}
        />
      </div>

      <ContentPanel
        title="أحدث الفواتير"
        actions={
          <Link className="btn" href="/portal/invoices">
            عرض الكل
          </Link>
        }
      >
        {invoices.status === 'loading' ? (
          <ViewNotice state="loading">جارٍ التحميل…</ViewNotice>
        ) : invoices.status === 'error' ? (
          <ViewNotice state="error">{invoices.error}</ViewNotice>
        ) : rows.length === 0 ? (
          <ViewNotice state="empty">لم تصدر لك فواتير بعد.</ViewNotice>
        ) : (
          <TableViewport label="أحدث الفواتير">
            <table>
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>التاريخ</th>
                  <th>الإجمالي</th>
                  <th>المسدد</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link href={`/portal/invoices/${invoice.id}`}>{invoice.number ?? '—'}</Link>
                    </td>
                    <td>{dateText(invoice.posted_at ?? invoice.created_at)}</td>
                    <td>{moneyText(invoice.total)}</td>
                    <td>{moneyText(invoice.paid_total)}</td>
                    <td>
                      <span className={`badge ${invoice.payment_status === 'paid' ? 'paid' : 'open'}`}>
                        {STATUS_AR[invoice.payment_status] ?? invoice.payment_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableViewport>
        )}
      </ContentPanel>
    </PageFrame>
  );
}

export default function PortalDashboardPage() {
  return (
    <PortalShell>
      <Dashboard />
    </PortalShell>
  );
}
