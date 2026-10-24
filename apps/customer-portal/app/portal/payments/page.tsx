'use client';

import { KpiStrip, PageHead, Panel } from '@erp/ui';
import { Decimal } from 'decimal.js';

import { Empty } from '../../../components/card';
import { PortalShell } from '../../../components/portal-shell';
import { PortalTable } from '../../../components/table';
import { fetchPayments } from '../../../lib/api';
import { dateText, moneyText } from '../../../lib/format';
import { useAsync } from '../../../lib/use-async';

const METHOD_AR: Record<string, string> = {
  cash: 'نقداً',
  cheque: 'شيك',
  bank_transfer: 'تحويل بنكي',
  card: 'شبكة/بطاقة',
};
const KIND_AR: Record<string, string> = { receipt: 'سند قبض', payment: 'سند صرف', invoice_payment: 'دفعة فاتورة' };

function Payments() {
  const payments = useAsync(() => fetchPayments(), []);
  const rows = payments.data ?? [];

  return (
    <>
      <PageHead
        title="الدفعات والسندات"
        description="سندات القبض والصرف ودفعات الفواتير المسجّلة على حسابك."
      />

      <KpiStrip
        items={[
          {
            label: 'إجمالي الحركات',
            value: moneyText(rows.reduce((sum, row) => sum.plus(row.amount || '0'), new Decimal(0)).toFixed(2)),
            hint: `${rows.length} حركة`,
          },
          {
            label: 'آخر حركة',
            value: rows[0] ? moneyText(rows[0].amount) : '—',
            hint: rows[0] ? dateText(rows[0].day) : 'لا توجد حركات',
          },
        ]}
      />

      <Panel title="الدفعات والسندات" flush>
        {payments.status === 'loading' ? (
          <p className="panel-state">جارٍ تحميل الدفعات…</p>
        ) : payments.status === 'error' ? (
          <p className="panel-state" role="alert">
            {payments.error}
          </p>
        ) : rows.length === 0 ? (
          <Empty bare title="لم تُسجَّل دفعات بعد" detail="تظهر هنا سندات القبض والصرف ودفعات الفواتير المسجّلة على حسابك." />
        ) : (
          <PortalTable
            bare
            columns={[
              { key: 'number', header: 'الرقم', cell: (row) => row.number ?? '—' },
              { key: 'date', header: 'التاريخ', cell: (row) => dateText(row.day) },
              { key: 'kind', header: 'النوع', cell: (row) => KIND_AR[row.kind] ?? row.kind },
              {
                key: 'method',
                header: 'طريقة الدفع',
                cell: (row) => (row.method ? METHOD_AR[row.method] ?? row.method : '—'),
              },
              {
                key: 'amount',
                header: 'المبلغ',
                numeric: true,
                cell: (row) => <strong>{moneyText(row.amount)}</strong>,
              },
              {
                key: 'reference',
                header: 'المرجع',
                ltr: true,
                cell: (row) =>
                  (row as unknown as Record<string, string>).reference_no ??
                  (row as unknown as Record<string, string>).cheque_no ??
                  '—',
              },
            ]}
            rows={rows}
            rowKey={(row) => row.id}
          />
        )}
      </Panel>
    </>
  );
}

export default function PaymentsPage() {
  return (
    <PortalShell>
      <Payments />
    </PortalShell>
  );
}
