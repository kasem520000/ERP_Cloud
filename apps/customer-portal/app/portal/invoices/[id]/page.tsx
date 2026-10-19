'use client';

import { PageHead, Panel } from '@erp/ui';
import Link from 'next/link';
import { use, useState } from 'react';

import { Empty } from '../../../../components/card';
import { PortalShell } from '../../../../components/portal-shell';
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

      <Panel title="بنود الفاتورة" hint={`${lines.length} بند`} flush>
        {printError ? (
          <p className="panel-state" role="alert">
            {printError}
          </p>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>الصنف</th>
                <th>الوحدة</th>
                <th>الكمية</th>
                <th>السعر</th>
                <th>الخصم</th>
                <th>الصافي</th>
                <th>الضريبة</th>
                <th>الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.line_no}>
                  <td>{line.line_no}</td>
                  <td>{line.name}</td>
                  <td>{line.unit ?? '—'}</td>
                  <td>{line.quantity}</td>
                  <td>{moneyText(line.unit_price)}</td>
                  <td>{moneyText(line.discount_amount)}</td>
                  <td>{moneyText(line.net)}</td>
                  <td>{moneyText(line.tax)}</td>
                  <td>
                    <strong>{moneyText(line.total)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid cols">
        <Panel title="الإجماليات" flush>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <td>الصافي قبل الضريبة</td>
                  <td>{moneyText(invoice.subtotal)}</td>
                </tr>
                <tr>
                  <td>ضريبة القيمة المضافة</td>
                  <td>{moneyText(invoice.tax_total)}</td>
                </tr>
                <tr>
                  <td>
                    <strong>الإجمالي</strong>
                  </td>
                  <td>
                    <strong>{moneyText(invoice.total)}</strong>
                  </td>
                </tr>
                <tr>
                  <td>المسدد</td>
                  <td>{moneyText(invoice.paid_total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="الدفعات على الفاتورة" flush>
          {payments.length === 0 ? (
            <Empty bare title="لم تُسجَّل دفعات" detail="تظهر هنا كل دفعة تُسجَّل على هذه الفاتورة." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الطريقة</th>
                    <th>المبلغ</th>
                    <th>المرجع</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment, index) => (
                    <tr key={`${payment.created_at}-${index}`}>
                      <td>{dateText(payment.created_at ?? '')}</td>
                      <td>{payment.method}</td>
                      <td>{moneyText(payment.amount ?? '0')}</td>
                      <td>{payment.reference ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
