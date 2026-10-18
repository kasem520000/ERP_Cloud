'use client';

import { Decimal } from 'decimal.js';
import { ContentPanel, PageFrame, PageHeader, SummaryStat, TableViewport, ViewNotice } from '@erp/ui/page';

import { PortalShell } from '../../../components/portal-shell';
import { fetchPayments } from '../../../lib/api';
import { dateText, moneyText } from '../../../lib/format';
import { useAsync } from '../../../lib/use-async';

const METHOD_AR: Record<string, string> = {
  cash: 'نقداً',
  cheque: 'شيك',
  bank_transfer: 'تحويل بنكي',
  card: 'شبكة/بطاقة',
};
const KIND_AR: Record<string, string> = { receipt: 'سند قبض', payment: 'سند صرف' };

function Payments() {
  const payments = useAsync(() => fetchPayments(), []);
  const rows = payments.data ?? [];
  const receiptsTotal = rows
    .filter((row) => row.kind === 'receipt')
    .reduce((sum, row) => sum.plus(row.amount || '0'), new Decimal(0));

  return (
    <PageFrame>
      <PageHeader
        title="المدفوعات"
        eyebrow="التحصيل"
        description="السندات المرحّلة المسجلة على حسابك لدى المورد."
      />

      <div className="portal-stats">
        <SummaryStat
          label="إجمالي المقبوض منك"
          value={payments.status === 'ready' ? moneyText(receiptsTotal.toFixed(2)) : '—'}
          hint={payments.status === 'ready' ? `${rows.length} سند` : 'بانتظار بيانات السندات'}
        />
        <SummaryStat
          label="آخر سند"
          value={rows[0] ? moneyText(rows[0].amount) : '—'}
          hint={rows[0] ? dateText(rows[0].day) : payments.status === 'ready' ? 'لا توجد سندات' : 'بانتظار بيانات السندات'}
        />
      </div>

      <ContentPanel
        title="سندات الحساب"
        description={payments.status === 'ready' ? `${rows.length} سند` : undefined}
      >
        {payments.status === 'loading' ? (
          <ViewNotice state="loading">جارٍ تحميل السندات…</ViewNotice>
        ) : payments.status === 'error' ? (
          <ViewNotice state="error">{payments.error}</ViewNotice>
        ) : rows.length === 0 ? (
          <ViewNotice state="empty">لم تُسجَّل أي سندات على حسابك بعد.</ViewNotice>
        ) : (
          <TableViewport label="سندات الحساب">
            <table>
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>التاريخ</th>
                  <th>النوع</th>
                  <th>طريقة الدفع</th>
                  <th>المبلغ</th>
                  <th>المرجع</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.number ?? '—'}</td>
                    <td>{dateText(row.day)}</td>
                    <td>{KIND_AR[row.kind] ?? row.kind}</td>
                    <td>{METHOD_AR[row.method] ?? row.method}</td>
                    <td>
                      <strong>{moneyText(row.amount)}</strong>
                    </td>
                    <td>
                      {(row as unknown as Record<string, string>).reference_no ??
                        (row as unknown as Record<string, string>).cheque_no ??
                        '—'}
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

export default function PaymentsPage() {
  return (
    <PortalShell>
      <Payments />
    </PortalShell>
  );
}
