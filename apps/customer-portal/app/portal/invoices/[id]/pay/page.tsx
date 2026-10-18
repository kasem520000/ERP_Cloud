'use client';

import Link from 'next/link';
import { use } from 'react';
import { ContentPanel, PageFrame, PageHeader, ViewNotice } from '@erp/ui/page';

import { PortalShell } from '../../../../../components/portal-shell';
import { portalFetch } from '../../../../../lib/api';
import { moneyText } from '../../../../../lib/format';
import { useAsync } from '../../../../../lib/use-async';

type PayView = {
  companyName: string;
  invoice: {
    id: string;
    number: string | null;
    currency: string;
    total: string;
    paidTotal: string;
    remaining: string;
    paymentStatus: string;
  };
  link: {
    id: string;
    provider: string;
    amount: string;
    currency: string;
    url: string;
    status: string;
    paidAt: string | null;
  } | null;
};

const providerLabel: Record<string, string> = { moyasar: 'ميسر', hyperpay: 'HyperPay', tap: 'Tap' };
const statusLabel: Record<string, string> = {
  pending: 'بانتظار الدفع',
  paid: 'مدفوعة',
  expired: 'منتهية',
  failed: 'فشلت',
};

function PayPanel({ id }: { id: string }) {
  const view = useAsync(() => portalFetch<PayView>(`/portal/invoices/${id}/payment-link`), [id]);
  if (view.status === 'loading') return <ViewNotice state="loading">جارٍ تجهيز صفحة الدفع…</ViewNotice>;
  if (view.status === 'error' || !view.data) {
    return (
      <PageFrame>
        <PageHeader
          title="صفحة الدفع غير متاحة"
          actions={
            <Link className="btn" href="/portal/invoices">
              رجوع
            </Link>
          }
        />
        <ViewNotice state="error">{view.error || 'الفاتورة غير موجودة.'}</ViewNotice>
      </PageFrame>
    );
  }
  const { companyName, invoice, link } = view.data;
  const mark = (companyName || 'م').trim().slice(0, 1);
  return (
    <PageFrame className="portal-payment">
      <PageHeader
        eyebrow="الدفع إلى"
        title={companyName || 'المنشأة'}
        description={
          <>
            فاتورة{' '}
            <span className="num" dir="auto">
              {invoice.number ?? '—'}
            </span>{' '}
            · المتبقي{' '}
            <strong className="num" dir="auto">
              {moneyText(invoice.remaining)}
            </strong>{' '}
            <span dir="ltr">{invoice.currency}</span>
          </>
        }
      />
      <ContentPanel>
        <div className="portal-payment-mark" aria-hidden="true">
          {mark}
        </div>
        {link ? (
          <>
            <p>
              <span
                className={`badge ${link.status === 'paid' ? 'paid' : link.status === 'pending' ? 'pending' : 'failed'}`}
              >
                {statusLabel[link.status] ?? link.status}
              </span>{' '}
              عبر {providerLabel[link.provider] ?? link.provider} · {moneyText(link.amount)} {link.currency}
            </p>
            {link.status === 'pending' ? (
              <a className="btn primary" href={link.url} target="_blank" rel="noreferrer">
                ادفع الآن
              </a>
            ) : (
              <p className="muted">
                {link.status === 'paid'
                  ? 'تم استلام الدفعة وسيظهر سند القبض في حسابك.'
                  : 'اطلب من المنشأة إصدار رابط جديد.'}
              </p>
            )}
          </>
        ) : (
          <p className="muted">
            لم تُصدر المنشأة رابط دفع بعد. يمكنك مراجعة الفاتورة أو طلب الرابط من المحاسب.
          </p>
        )}
        <div className="portal-payment-actions">
          <Link className="btn" href={`/portal/invoices/${id}`}>
            تفاصيل الفاتورة
          </Link>
        </div>
      </ContentPanel>
    </PageFrame>
  );
}

export default function PortalPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell>
      <PayPanel id={id} />
    </PortalShell>
  );
}
