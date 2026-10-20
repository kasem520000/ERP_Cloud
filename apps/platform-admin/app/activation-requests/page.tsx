'use client';

import { useState } from 'react';
import { Panel } from '@erp/ui';

import { Empty, ErrorBox, Loading, Screen } from '../../components/screen';
import { Table, type Column } from '../../components/ui/table';
import { ApiError, apiData, apiPost } from '../../lib/api';
import { useQuery } from '../../lib/use-query';
import { dateText } from '../../lib/format';

type Request = {
  id: string;
  tenant_code: string;
  tenant_name: string;
  plan_name: string | null;
  amount: string | null;
  currency: string | null;
  notes: string | null;
  created_at: string;
  requested_by_email: string | null;
  status: string;
};

export default function ActivationRequestsPage() {
  const [status, setStatus] = useState('pending');
  const requests = useQuery<Request[]>(
    () => apiData<Request[]>(`/platform/activation-requests?status=${status}`),
    [status],
  );
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();
  const [busy, setBusy] = useState<string | undefined>();

  async function review(id: string, approve: boolean) {
    setBusy(id);
    setMessage(undefined);
    try {
      await apiPost(`/platform/activation-requests/${id}/review`, { approve });
      setMessage({
        kind: 'ok',
        text: approve ? 'تم اعتماد الطلب وإصدار ترخيص لمدة 12 شهراً.' : 'تم رفض الطلب.',
      });
      requests.reload();
    } catch (error) {
      setMessage({ kind: 'danger', text: error instanceof ApiError ? error.message : String(error) });
    } finally {
      setBusy(undefined);
    }
  }

  const rows = requests.data ?? [];

  const columns: Array<Column<Request>> = [
    {
      key: 'tenant',
      header: 'المنشأة',
      grow: true,
      cell: (row) => (
        <>
          <strong>{row.tenant_name}</strong>
          <div className="muted small" dir="ltr">
            {row.tenant_code}
          </div>
        </>
      ),
    },
    {
      key: 'requester',
      header: 'مقدم الطلب',
      ltr: true,
      cell: (row) => <span className="small">{row.requested_by_email ?? '—'}</span>,
    },
    { key: 'plan', header: 'الباقة', cell: (row) => row.plan_name ?? '—' },
    {
      key: 'amount',
      header: 'القيمة',
      numeric: true,
      cell: (row) =>
        row.amount
          ? `${Number(row.amount).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { minimumFractionDigits: 2 })} ${row.currency ?? ''}`
          : '—',
    },
    { key: 'created', header: 'التاريخ', ltr: true, cell: (row) => dateText(row.created_at) },
    { key: 'notes', header: 'ملاحظات', cell: (row) => <span className="small">{row.notes ?? '—'}</span> },
    {
      key: 'actions',
      header: '',
      cell: (row) =>
        row.status === 'pending' ? (
          <div className="row">
            <button
              className="btn sm primary"
              type="button"
              disabled={busy === row.id}
              onClick={() => void review(row.id, true)}
            >
              اعتماد
            </button>
            <button
              className="btn sm danger"
              type="button"
              disabled={busy === row.id}
              onClick={() => void review(row.id, false)}
            >
              رفض
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <Screen
      title="طلبات التفعيل"
      subtitle="طلبات الاشتراك اليدوية القادمة من بوابة العملاء."
      crumbs={['المنصة', 'العملاء والتراخيص']}
      actions={
        <select
          className="input"
          style={{ maxWidth: 180 }}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="pending">معلقة</option>
          <option value="approved">معتمدة</option>
          <option value="rejected">مرفوضة</option>
        </select>
      }
    >
      {message && <p className={`alert ${message.kind}`}>{message.text}</p>}
      {requests.status === 'loading' && <Loading />}
      {requests.status === 'error' && <ErrorBox message={requests.error} onRetry={requests.reload} />}
      {requests.status === 'success' &&
        (rows.length === 0 ? (
          <Empty title="لا توجد طلبات" detail="ستظهر هنا طلبات العملاء من صفحة الاشتراك في بوابة العملاء." />
        ) : (
          <Panel flush title="طلبات التفعيل">
            <Table bare columns={columns} rows={rows} rowKey={(row) => row.id} />
          </Panel>
        ))}
    </Screen>
  );
}
