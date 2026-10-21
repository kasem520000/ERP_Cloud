'use client';

import { Page, PageHead, Panel } from '@erp/ui';
import { useEffect, useState } from 'react';

import { ApiError, apiData, apiPost } from '../../../lib/api';

type RequestRow = {
  id: string;
  employee_name: string;
  type: string;
  reason: string;
  starts_on: string | null;
  ends_on: string | null;
};

const LABELS: Record<string, string> = {
  leave: 'إجازة',
  permission: 'استئذان',
  custody: 'عهدة',
  advance: 'سلفة',
};

export default function ApprovalsPage() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [message, setMessage] = useState('');

  async function reload() {
    const next = await apiData<RequestRow[]>('/employee/requests?status=pending');
    setRows(Array.isArray(next) ? next : []);
  }

  useEffect(() => {
    void reload().catch((error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'تعذر فتح الوارد'),
    );
  }, []);

  async function decide(id: string, action: 'approve' | 'reject') {
    setMessage('');
    try {
      await apiPost(`/employee/requests/${id}/${action}`, {});
      setMessage(action === 'approve' ? 'وُوفق على الطلب وسيصل إشعار للموظف.' : 'رُفض الطلب.');
      await reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'تعذر حسم الطلب');
    }
  }

  return (
    <Page>
      <PageHead
        title="موافقاتي"
        description="طلبات الفريق المعلّقة — القرار هنا يصل إشعاره للموظف فوراً."
        breadcrumbs={['تطبيق الموظف', 'الموافقات']}
        actions={<span className="chip">{rows.length} طلب معلّق</span>}
      />
      {message ? <p className="alert info">{message}</p> : null}
      <Panel title="الطلبات المعلّقة">
        {rows.length === 0 ? (
          <p className="m-0 text-sm text-muted">لا طلبات معلّقة.</p>
        ) : (
          <div className="grid gap-3">
            {rows.map((row) => (
              <article key={row.id} className="rounded-xl border border-line p-4 grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{row.employee_name}</strong>
                  <span className="badge">{LABELS[row.type] ?? row.type}</span>
                </div>
                <p className="m-0 text-sm text-ink-2">{row.reason}</p>
                <p className="m-0 text-[12.5px] text-muted">
                  {row.starts_on ?? ''} {row.ends_on ? `إلى ${row.ends_on}` : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => void decide(row.id, 'approve')}
                  >
                    موافقة
                  </button>
                  <button className="btn" type="button" onClick={() => void decide(row.id, 'reject')}>
                    رفض
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </Page>
  );
}
