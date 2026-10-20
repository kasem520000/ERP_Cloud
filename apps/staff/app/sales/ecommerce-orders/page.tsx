'use client';

import { FilterBand, Panel } from '@erp/ui';
import { useEffect, useState } from 'react';

import { DataTable, Notice } from '../../../components/data-view';
import { Screen } from '../../../components/screen';
import { apiErrorText } from '../../../lib/api';
import { ecommerceOrders, type EcommerceOrder } from '../../../lib/ecommerce';

const providerLabels = { salla: 'سلة', zid: 'زد', shopify: 'Shopify' } as const;

export default function EcommerceOrdersPage() {
  const [orders, setOrders] = useState<EcommerceOrder[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info' | 'warn'; text: string }>();

  async function reload() {
    setBusy(true);
    try {
      setOrders(await ecommerceOrders(status ? { status } : {}));
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [status]);

  return (
    <Screen
      title="طلبات المتجر الإلكتروني"
      subtitle="كل طلب من سلة أو زد أو Shopify يظهر هنا، مع حالة الاستيراد ورابط مسودة فاتورة المبيعات في ERP."
      crumbs={['المبيعات', 'طلبات المتجر الإلكتروني']}
      actions={
        <button className="btn" type="button" disabled={busy} onClick={() => void reload()}>
          {busy ? 'جارٍ التحديث…' : 'تحديث'}
        </button>
      }
      filters={
        <FilterBand>
          <label className="field">
            <span>حالة المزامنة</span>
            <select className="ui-select" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">الكل</option>
              <option value="pending">قيد المعالجة</option>
              <option value="imported">مستورد</option>
              <option value="failed">فشل</option>
            </select>
          </label>
        </FilterBand>
      }
    >
      <Notice notice={notice} />
      <Panel flush hint="كل طلب يبقى في سجله، ومسودة الفاتورة تُفتح من عمودها." title="طلبات المتاجر">
        <DataTable
          columns={[
            {
              key: 'provider',
              header: 'المتجر',
              cell: (row: EcommerceOrder) => providerLabels[row.provider],
            },
            {
              key: 'remoteOrderNo',
              header: 'رقم الطلب',
              cell: (row: EcommerceOrder) => row.remoteOrderNo ?? row.remoteId,
            },
            {
              key: 'customer',
              header: 'العميل',
              cell: (row: EcommerceOrder) => (
                <span>
                  {row.customerName ?? '—'}
                  <small className="muted">{row.customerMobile ? ` · ${row.customerMobile}` : ''}</small>
                </span>
              ),
            },
            {
              key: 'total',
              header: 'الإجمالي',
              cell: (row: EcommerceOrder) => `${row.total} ${row.currency}`,
            },
            {
              key: 'status',
              header: 'المزامنة',
              cell: (row: EcommerceOrder) => (
                <span
                  className={`chip ${row.status === 'imported' ? 'success' : row.status === 'failed' ? 'danger' : ''}`}
                >
                  {row.status === 'imported'
                    ? 'فاتورة مسودة'
                    : row.status === 'failed'
                      ? 'فشل'
                      : 'قيد المعالجة'}
                </span>
              ),
            },
            {
              key: 'invoice',
              header: 'فاتورة ERP',
              cell: (row: EcommerceOrder) =>
                row.erpInvoiceId ? (
                  <a href={`/sales/invoices/${row.erpInvoiceId}`}>{row.erpInvoiceId.slice(0, 8)}…</a>
                ) : (
                  '—'
                ),
            },
          ]}
          rows={orders}
          rowKey={(row) => row.id}
        />
        {orders.length === 0 ? (
          <p className="m-0 p-4 text-[13px] text-muted">لا توجد طلبات متجر بعد.</p>
        ) : null}
      </Panel>
      {orders.some((row) => row.error) ? (
        <Panel hint="الطلب لم يُستورد، والسبب كما رجع من المتجر." title="أخطاء الاستيراد">
          {orders
            .filter((row) => row.error)
            .map((row) => (
              <p key={row.id} className="notice danger">
                {row.remoteOrderNo ?? row.remoteId}: {row.error}
              </p>
            ))}
        </Panel>
      ) : null}
    </Screen>
  );
}
