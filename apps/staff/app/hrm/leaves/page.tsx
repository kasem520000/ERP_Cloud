'use client';

import { Panel } from '@erp/ui';
import { useEffect, useState } from 'react';

import { Empty, Screen } from '../../../components/screen';
import { ApiError, apiData } from '../../../lib/api';
import { Table } from '../../../components/ui/table';

type Leave = {
  id: string;
  employee_name: string;
  starts_on: string | null;
  ends_on: string | null;
  reason: string;
};

/**
 * إجازات الموظفين — الطلبات التي وافق عليها المدير من تطبيق الموظف.
 *
 * الشاشة نفسها ككل شاشة قائمة: رأسٌ، ثم لوحةٌ بجدول. الجدول يُبقي الأعمدة في
 * مكانها حين يمتلئ، وحالةُ الفراغ تشرح من أين تأتي الإجازة بدل سطرٍ عائم.
 */
export default function HrmLeavesPage() {
  const [rows, setRows] = useState<Leave[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiData<Leave[]>('/hrm/employee-leaves')
      .then((next) => setRows(Array.isArray(next) ? next : []))
      .catch((error: unknown) =>
        setMessage(error instanceof ApiError ? error.message : 'تعذر تحميل الإجازات'),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <Screen
      title="إجازات الموظفين"
      subtitle="الطلبات التي وافق عليها المدير من تطبيق الموظف."
      crumbs={['الموظفين', 'الإجازات']}
    >
      {message ? <p className="alert danger">{message}</p> : null}
      {loading ? (
        <Panel title="الإجازات المعتمدة">
          <p className="muted m-0">جارٍ التحميل…</p>
        </Panel>
      ) : rows.length === 0 ? (
        <Panel title="الإجازات المعتمدة" flush>
          <Empty
            title="لا إجازات معتمدة"
            detail="تُضاف الإجازة إلى هذه القائمة بعد موافقة المدير على الطلب من تطبيق الموظف."
          />
        </Panel>
      ) : (
        <Panel title="الإجازات المعتمدة" hint={`${rows.length} طلباً`} flush>
          <Table
            bare
            columns={[
              {
                key: 'c0',
                header: 'الموظف',
                cell: (row) => row.employee_name,
              },
              {
                key: 'c1',
                header: 'من',
                ltr: true,
                cell: (row) => row.starts_on ?? '—',
              },
              {
                key: 'c2',
                header: 'إلى',
                ltr: true,
                cell: (row) => row.ends_on ?? '—',
              },
              {
                key: 'c3',
                header: 'السبب',
                cell: (row) => row.reason || '—',
              },
            ]}
            rows={rows}
            rowKey={(row) => row.id}
          />
        </Panel>
      )}
    </Screen>
  );
}
