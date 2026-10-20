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
const KIND_AR: Record<string, string> = { receipt: 'سند قبض', payment: 'سند صرف' };

function Payments() {
  const payments = useAsync(() => fetchPayments(), []);
  const rows = payments.data ?? [];
  const receiptsTotal = rows
    .filter((row) => row.kind === 'receipt')
    .reduce((sum, row) => sum.plus(row.amount || '0'), new Decimal(0));

  return (
    <>
      <PageHead title="المدفوعات" description="السندات المرحّلة المسجلة على حسابك لدى المورد." />

      <KpiStrip
        items={[
          {
            label: 'إجمالي المقبوض منك',
            value: moneyText(receiptsTotal.toFixed(2)),
            hint: `${rows.length} سند`,
          },
          {
            label: 'آخر سند',
            value: rows[0] ? moneyText(rows[0].amount) : '—',
            hint: rows[0] ? dateText(rows[0].day) : 'لا توجد سندات',
          },
        ]}
      />

      <Panel title="سندات القبض" flush>
        {payments.status === 'loading' ? (
          <p className="panel-state">جارٍ تحميل السندات…</p>
        ) : payments.status === 'error' ? (
          <p className="panel-state" role="alert">
            {payments.error}
          </p>
        ) : rows.length === 0 ? (
          <Empty bare title="لم تُسجَّل سندات بعد" detail="يظهر هنا كل سند قبض مرحّل على حسابك لدى المورد." />
        ) : (
          <PortalTable
            bare
            columns={[
              { key: 'number', header: 'الرقم', cell: (row) => row.number ?? '—' },
              { key: 'date', header: 'التاريخ', cell: (row) => dateText(row.day) },
              { key: 'kind', header: 'النوع', cell: (row) => KIND_AR[row.kind] ?? row.kind },
              { key: 'method', header: 'طريقة الدفع', cell: (row) => METHOD_AR[row.method] ?? row.method },
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
