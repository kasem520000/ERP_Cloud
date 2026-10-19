'use client';

import { PageHead, Panel } from '@erp/ui';
import Link from 'next/link';
import { use } from 'react';

import { Empty } from '../../../../../components/card';
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
  if (view.status === 'loading')
    return (
      <Panel>
        <p className="panel-state">جارٍ تجهيز صفحة الدفع…</p>
      </Panel>
    );
  if (view.status === 'error' || !view.data) {
    return (
      <Panel title="صفحة الدفع غير متاحة">
        <Empty bare title="صفحة الدفع غير متاحة" detail={view.error || 'الفاتورة غير موجودة.'} />
        <div className="toolbar" style={{ justifyContent: 'center' }}>
          <Link className="btn" href="/portal/invoices">
            رجوع
          </Link>
        </div>
      </Panel>
    );
  }
  const { companyName, invoice, link } = view.data;
  const mark = (companyName || 'م').trim().slice(0, 1);
  return (
    <>
      <PageHead
        breadcrumbs={[
          { label: 'فواتيري', href: '/portal/invoices' },
          { label: `فاتورة ${invoice.number ?? ''}`, href: `/portal/invoices/${id}` },
          { label: 'الدفع' },
        ]}
        title={`دفع فاتورة ${invoice.number ?? ''}`}
        description="أكمل الدفع عبر الرابط الآمن الذي أصدرته المنشأة."
      />

      <Panel title="ملخص الدفع" style={{ maxWidth: 560, marginInline: 'auto' }}>
        <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
          <span className="logo" aria-hidden="true" style={{ width: 56, height: 56, fontSize: 24 }}>
            {mark}
          </span>
          <div>
            <p className="muted" style={{ margin: 0 }}>
              الدفع إلى
            </p>
            <p style={{ margin: 0, fontWeight: 700 }}>{companyName || 'المنشأة'}</p>
          </div>
        </div>
        <p>
          المتبقي {moneyText(invoice.remaining)} {invoice.currency}
        </p>
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
        <div className="row" style={{ marginTop: 16 }}>
          <Link className="btn" href={`/portal/invoices/${id}`}>
            تفاصيل الفاتورة
          </Link>
        </div>
      </Panel>
    </>
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
