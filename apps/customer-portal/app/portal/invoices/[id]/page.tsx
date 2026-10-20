'use client';

import { PageHead, Panel } from '@erp/ui';
import Link from 'next/link';
import { use, useState } from 'react';

import { Empty } from '../../../../components/card';
import { PortalShell } from '../../../../components/portal-shell';
import { PortalTable } from '../../../../components/table';
import { fetchInvoice, fetchInvoiceHtml, openPrintWindow } from '../../../../lib/api';
import { dateText, moneyText } from '../../../../lib/format';
import { useAsync } from '../../../../lib/use-async';

const PAYMENT_AR: Record<string, string> = { unpaid: 'غير مسددة', partial: 'مسددة جزئياً', paid: 'مسددة' };
const ZATCA_AR: Record<string, string> = {
  cleared: 'مصدّقة من هيئة الزكاة',
  reported: 'مبلّغة للهيئة',
  signed: 'موقّعة',
  prepared: 'قيد التجهيز',
  failed: 'فشل الإرسال',
};

function InvoiceDetail({ id }: { id: string }) {
  const [printError, setPrintError] = useState('');
  const detail = useAsync(() => fetchInvoice(id), [id]);

  async function print() {
    setPrintError('');
    try {
      const html = await fetchInvoiceHtml(id);
      if (!openPrintWindow(html))
        setPrintError('منع المتصفح فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'تعذّرت الطباعة');
    }
  }

  if (detail.status === 'loading')
    return (
      <Panel>
        <p className="panel-state">جارٍ تحميل الفاتورة…</p>
      </Panel>
    );
  if (detail.status === 'error' || !detail.data)
    return (
      <Panel title="الفاتورة غير متاحة">
        <Empty
          bare
          title="الفاتورة غير متاحة"
          detail={detail.error || 'المستند غير موجود أو لا يخص حسابك.'}
        />
        <div className="toolbar" style={{ justifyContent: 'center' }}>
          <Link className="btn" href="/portal/invoices">
            رجوع للفواتير
          </Link>
        </div>
      </Panel>
    );

  const { invoice, lines, payments } = detail.data;

  return (
    <>
      <PageHead
        breadcrumbs={[
          { label: 'فواتيري', href: '/portal/invoices' },
          { label: `فاتورة ${invoice.number ?? '—'}` },
        ]}
        title={`فاتورة ${invoice.number ?? '—'}`}
        description={
          <>
            {dateText(invoice.posted_at ?? invoice.created_at)} · {invoice.currency}
            {invoice.zatca_status ? ` · ${ZATCA_AR[invoice.zatca_status] ?? invoice.zatca_status}` : ''}
            {' · '}
            {PAYMENT_AR[invoice.payment_status] ?? invoice.payment_status}
          </>
        }
        actions={
          <>
            <Link className="btn primary" href={`/portal/invoices/${id}/pay`}>
              ادفع
            </Link>
            <button className="btn" type="button" onClick={print}>
              طباعة / حفظ PDF
            </button>
          </>
        }
      />

      <Panel title="بنود الفاتورة" hint={`عدد البنود: ${lines.length}`} flush>
        {printError ? (
          <p className="panel-state" role="alert">
            {printError}
          </p>
        ) : null}
        <PortalTable
          bare
          empty={<>لا بنود في هذه الفاتورة.</>}
          columns={[
            { key: 'line', header: '#', ltr: true, cell: (line) => line.line_no },
            { key: 'name', header: 'الصنف', cell: (line) => line.name },
            { key: 'unit', header: 'الوحدة', cell: (line) => line.unit ?? '—' },
            {
              key: 'qty',
              header: 'الكمية',
              numeric: true,
              ltr: true,
              cell: (line) => line.quantity,
            },
            { key: 'price', header: 'السعر', numeric: true, cell: (line) => moneyText(line.unit_price) },
            {
              key: 'discount',
              header: 'الخصم',
              numeric: true,
              cell: (line) => moneyText(line.discount_amount),
            },
            { key: 'net', header: 'الصافي', numeric: true, cell: (line) => moneyText(line.net) },
            { key: 'tax', header: 'الضريبة', numeric: true, cell: (line) => moneyText(line.tax) },
            {
              key: 'total',
              header: 'الإجمالي',
              numeric: true,
              cell: (line) => <strong>{moneyText(line.total)}</strong>,
            },
          ]}
          rows={lines}
          rowKey={(line) => String(line.line_no)}
        />
      </Panel>

      <div className="grid cols">
        <Panel title="الإجماليات" flush>
          <PortalTable
            bare
            headless
            columns={[
              { key: 'label', header: '', cell: (row) => row.label },
              { key: 'value', header: '', cell: (row) => row.value },
            ]}
            rows={[
              { label: 'الصافي قبل الضريبة', value: moneyText(invoice.subtotal) },
              { label: 'ضريبة القيمة المضافة', value: moneyText(invoice.tax_total) },
              { label: <strong>الإجمالي</strong>, value: <strong>{moneyText(invoice.total)}</strong> },
              { label: 'المسدد', value: moneyText(invoice.paid_total) },
            ]}
            rowKey={(row, index) => `${index}`}
          />
        </Panel>

        <Panel title="الدفعات على الفاتورة" flush>
          {payments.length === 0 ? (
            <Empty bare title="لم تُسجَّل دفعات" detail="تظهر هنا كل دفعة تُسجَّل على هذه الفاتورة." />
          ) : (
            <PortalTable
              bare
              columns={[
                { key: 'date', header: 'التاريخ', cell: (payment) => dateText(payment.created_at ?? '') },
                { key: 'method', header: 'الطريقة', cell: (payment) => payment.method },
                {
                  key: 'amount',
                  header: 'المبلغ',
                  numeric: true,
                  cell: (payment) => moneyText(payment.amount ?? '0'),
                },
                { key: 'reference', header: 'المرجع', cell: (payment) => payment.reference ?? '—' },
              ]}
              rows={payments}
              rowKey={(payment, index) => `${payment.created_at}-${index}`}
            />
          )}
        </Panel>
      </div>
    </>
  );
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell>
      <InvoiceDetail id={id} />
    </PortalShell>
  );
}
