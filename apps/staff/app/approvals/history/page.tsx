'use client';

import { Panel } from '@erp/ui';
import { useEffect, useState } from 'react';

import { Notice } from '../../../components/data-view';
import { Forbidden, Screen } from '../../../components/screen';
import { ApiError } from '../../../lib/api';
import { approvalHistory, type ApprovalRequest } from '../../../lib/approvals';
import { useSession } from '../../../lib/session';
import { Table } from '../../../components/ui/table';

const labels: Record<ApprovalRequest['entityType'], string> = {
  sales_invoice: 'فاتورة مبيعات',
  purchase_invoice: 'فاتورة مشتريات',
  voucher: 'سند خزينة',
  expense: 'مصروف',
  leave: 'إجازة',
};

export default function ApprovalHistoryPage() {
  const { can } = useSession();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info' | 'warn'; text: string }>();

  useEffect(() => {
    void approvalHistory()
      .then(setRequests)
      .catch((error: unknown) =>
        setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : String(error) }),
      );
  }, []);

  if (!can('approval.approve')) {
    return (
      <Screen
        title="سجل الموافقات"
        subtitle="القرارات السابقة على المستندات."
        crumbs={['الموافقات', 'السجل']}
      >
        <Forbidden />
      </Screen>
    );
  }

  return (
    <Screen
      title="سجل الموافقات"
      subtitle="سجل القرارات والتعليقات على مسارات الموافقة المكتملة."
      crumbs={['الموافقات', 'السجل']}
      actions={<span className="chip">{requests.length} طلب</span>}
    >
      <Notice notice={notice} />
      {requests.length === 0 ? (
        <Panel title="سجل الموافقات">
          <p className="muted m-0">لا يوجد سجل موافقات بعد.</p>
        </Panel>
      ) : (
        <Panel flush title="سجل الموافقات">
          <Table
            bare
            columns={[
              {
                key: 'c0',
                header: 'المستند',
                cell: (request) => (
                  <>
                    {labels[request.entityType]}{' '}
                    <span className="muted">#{request.entityId.slice(0, 8)}</span>
                  </>
                ),
              },
              {
                key: 'c1',
                header: 'المسار',
                cell: (request) => request.workflowName ?? '—',
              },
              {
                key: 'c2',
                header: 'الحالة',
                cell: (request) => (
                  <>
                    <span className={`chip ${request.status === 'approved' ? 'success' : ''}`}>
                      {request.status === 'approved' ? 'مقبول' : 'مرفوض'}
                    </span>
                  </>
                ),
              },
              {
                key: 'c3',
                header: 'القرارات',
                cell: (request) =>
                  request.decisions.map((decision) => (
                    <div key={decision.id}>
                      {decision.decision === 'approved' ? 'موافقة' : 'رفض'} ·{' '}
                      {decision.comment || 'بلا تعليق'}
                    </div>
                  )),
              },
              {
                key: 'c4',
                header: 'التاريخ',
                cell: (request) => new Date(request.createdAt).toLocaleString('ar'),
              },
            ]}
            rows={requests}
            rowKey={(request) => request.id}
          />
        </Panel>
      )}
    </Screen>
  );
}
