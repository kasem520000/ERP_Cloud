'use client';

import { Panel } from '@erp/ui';
import { useEffect, useState } from 'react';

import { Notice } from '../../../components/data-view';
import { Forbidden, Screen } from '../../../components/screen';
import { ApiError } from '../../../lib/api';
import { approvalHistory, type ApprovalRequest } from '../../../lib/approvals';
import { useSession } from '../../../lib/session';

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
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>المستند</th>
                  <th>المسار</th>
                  <th>الحالة</th>
                  <th>القرارات</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td className="font-bold">
                      {labels[request.entityType]}{' '}
                      <span className="muted">#{request.entityId.slice(0, 8)}</span>
                    </td>
                    <td>{request.workflowName ?? '—'}</td>
                    <td>
                      <span className={`chip ${request.status === 'approved' ? 'success' : ''}`}>
                        {request.status === 'approved' ? 'مقبول' : 'مرفوض'}
                      </span>
                    </td>
                    <td>
                      {request.decisions.map((decision) => (
                        <div key={decision.id}>
                          {decision.decision === 'approved' ? 'موافقة' : 'رفض'} ·{' '}
                          {decision.comment || 'بلا تعليق'}
                        </div>
                      ))}
                    </td>
                    <td>{new Date(request.createdAt).toLocaleString('ar')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </Screen>
  );
}
