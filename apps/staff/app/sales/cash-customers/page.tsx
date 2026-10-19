'use client';

import { Panel } from '@erp/ui';
import { useState } from 'react';

import { CashCustomerPicker, type CashCustomer } from '../../../components/cash-customer-picker';
import { Empty, Screen } from '../../../components/screen';
import { apiList } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

/**
 * عميل نقدي — `Form_WPF/frmCashCustomer.xaml`.
 *
 * The till's walk-in, on its own page: the desktop window is opened *from* a sale, and
 * this page is the same panel standing alone so the names a shop has already served can
 * be reviewed — and reused — without opening the till.
 *
 * The rule it exists to serve is in the code-behind: a cash customer is not a row in a
 * customer table, it is a name and a mobile written **on the invoice**
 * (`SELECT … FROM inv WHERE CashCustomerName <> ''`), which is why a till can produce one
 * without opening a ledger account, and why a name is only ever as permanent as the sale
 * it was written on.
 */
export default function CashCustomersPage() {
  const { can } = useSession();
  const [notice, setNotice] = useState('');
  const [picked, setPicked] = useState<CashCustomer | undefined>();

  const recent = useQuery<CashCustomer[]>(() => apiList<CashCustomer>('/sales/cash-customers'), []);
  const served = (recent.data ?? []).reduce((running, row) => running + Number(row.invoices), 0);

  if (!can('sales.view')) {
    return (
      <Screen title="عميل نقدي" crumbs={['المبيعات']}>
        <Empty title="لا تملك صلاحية عرض العملاء" detail="اطلب من مسؤول الحساب منحك صلاحية عرض العملاء." />
      </Screen>
    );
  }

  return (
    <Screen
      title="عميل نقدي"
      subtitle="إضافة أو اختيار عميل نقدي للفاتورة — الأسماء التي خدمها المتجر"
      crumbs={['المبيعات', 'العملاء']}
    >
      <div className="ui-kpi-strip">
        <div className="ui-kpi-cell">
          <span className="ui-kpi-label">أسماء محفوظة</span>
          <span className="ui-kpi-value num" dir="ltr">
            {(recent.data ?? []).length}
          </span>
        </div>
        <div className="ui-kpi-cell">
          <span className="ui-kpi-label">فواتير كُتبت بأسماء نقدية</span>
          <span className="ui-kpi-value num" dir="ltr">
            {served}
          </span>
        </div>
      </div>

      {notice ? (
        <p className="m-0 rounded-[10px] border border-ok-line bg-ok-soft px-4 py-2.5 text-[13px] font-semibold text-ok-ink">
          {notice}
        </p>
      ) : null}
      {picked ? (
        <p className="m-0 rounded-[10px] border border-line bg-surface-2 px-4 py-2.5 text-[13px] font-semibold text-ink">
          المختار الآن: {picked.name} — {picked.mobile ?? '—'}
        </p>
      ) : null}

      <Panel
        hint="الاسم النقدي يُحفظ على الفاتورة نفسها لا في سجل الأطراف، فلا يُفتح له حساب ذمم."
        title="إضافة أو اختيار عميل نقدي"
      >
        <CashCustomerPicker
          embedded
          value={{ name: picked?.name ?? '', mobile: picked?.mobile ?? '' }}
          onPick={(customer) => {
            setPicked({ name: customer.name, mobile: customer.mobile, invoices: 0, lastAt: '' });
            setNotice(`أُدرج الاسم «${customer.name}» ليُستخدم في الفاتورة القادمة`);
            recent.reload();
          }}
          onClose={() => {
            setPicked(undefined);
            setNotice('');
          }}
        />
      </Panel>
    </Screen>
  );
}
