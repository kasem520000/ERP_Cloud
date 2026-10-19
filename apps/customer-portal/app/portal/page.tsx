'use client';

import { KpiStrip, PageHead, Panel } from '@erp/ui';
import Link from 'next/link';
import { Decimal } from 'decimal.js';

import { Empty } from '../../components/card';
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

/** رصيد سالب = دفعات مقدّمة/دائن، لا «مستحق» بالسالب؛ فالوسم يتبدّل والرقم يُعرض مطلقاً. */
function balanceKpi(balanceText: string): { label: string; value: string; hint: string } {
  const credit = new Decimal(balanceText || '0');
  return credit.isNegative()
    ? {
        label: 'رصيد دائن لكم',
        value: moneyText(credit.abs().toFixed(2)),
        hint: 'دفعات مقدّمة أو أرصدة لصالحكم',
      }
    : { label: 'الرصيد المستحق', value: moneyText(credit.toFixed(2)), hint: 'حسب دفاتر المورد' };
}

function Dashboard() {
  const { profile } = usePortalProfile();
  const balanceView = balanceKpi(profile?.balance ?? '0');
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
    <>
      <PageHead
        title="لوحة الحساب"
        description={`ملخص تعاملك مع ${profile?.company.nameAr || 'المورد'} — الفواتير الصادرة لك والمبالغ المسددة.`}
      />

      <KpiStrip
        items={[
          { label: balanceView.label, value: balanceView.value, hint: balanceView.hint },
          {
            label: 'غير المسدد من الفواتير',
            value: moneyText(outstanding.toFixed(2)),
            hint: `${overdueCount} فاتورة مفتوحة`,
          },
          { label: 'عدد الفواتير', value: String(rows.length), hint: 'الفواتير المرحّلة الصادرة لك' },
          {
            label: 'آخر دفعة',
            value: lastPayment ? moneyText(lastPayment.amount) : '—',
            hint: lastPayment ? dateText(lastPayment.day) : 'لا توجد دفعات مسجلة',
          },
        ]}
      />

      <Panel
        title="أحدث الفواتير"
        hint="آخر خمس فواتير مرحّلة — افتح الفاتورة للتفصيل أو الدفع."
        actions={
          <Link className="btn" href="/portal/invoices">
            عرض الكل
          </Link>
        }
        flush
      >
        {invoices.status === 'loading' ? (
          <p className="panel-state">جارٍ التحميل…</p>
        ) : invoices.status === 'error' ? (
          <p className="panel-state" role="alert">
            {invoices.error}
          </p>
        ) : rows.length === 0 ? (
          <Empty bare title="لم تصدر لك فواتير بعد" detail="ستظهر هنا أول فاتورة مرحّلة باسمك." />
        ) : (
          <div className="table-wrap">
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
          </div>
        )}
      </Panel>
    </>
  );
}

export default function PortalDashboardPage() {
  return (
    <PortalShell>
      <Dashboard />
    </PortalShell>
  );
}
