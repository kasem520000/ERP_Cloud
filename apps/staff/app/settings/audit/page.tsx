'use client';

import { Panel } from '@erp/ui';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { apiData } from '../../../lib/api';
import { useQuery } from '../../../lib/use-query';
import { Table } from '../../../components/ui/table';

type AuditRow = {
  id: string;
  occurredAt?: string;
  occurred_at?: string;
  action?: string;
  entityType?: string;
  entity_type?: string;
  entityId?: string;
  entity_id?: string;
  actorUserId?: string | null;
  actor_user_id?: string | null;
  requestId?: string | null;
  request_id?: string | null;
};

export default function TenantAuditPage() {
  const audit = useQuery<AuditRow[] | { items?: AuditRow[]; data?: AuditRow[] }>(
    () => apiData('/audit-log?limit=100'),
    [],
  );

  const rows: AuditRow[] = Array.isArray(audit.data)
    ? audit.data
    : ((audit.data as { items?: AuditRow[] })?.items ?? []);

  return (
    <Screen
      title="سجلات المستخدمين"
      subtitle="سجل غير قابل للتعديل لكل عملية مؤثرة. النطاق محدد بالمنشأة الحالية."
      crumbs={['الإعدادات', 'التدقيق']}
      actions={
        <button className="btn" type="button" onClick={audit.reload}>
          تحديث
        </button>
      }
    >
      {audit.status === 'loading' && <Loading />}
      {audit.status === 'forbidden' && <Forbidden />}
      {audit.status === 'error' && <ErrorBox message={audit.error} onRetry={audit.reload} />}
      {audit.status === 'success' &&
        (rows.length === 0 ? (
          <Empty title="لا توجد سجلات بعد" />
        ) : (
          <Panel flush title="سجل التدقيق">
            <Table
              bare
              columns={[
                {
                  key: 'c0',
                  header: 'الوقت',
                  ltr: true,
                  cell: (row) =>
                    new Date(row.occurredAt ?? row.occurred_at ?? Date.now()).toLocaleString(
                      'ar-SA-u-ca-gregory-nu-latn',
                    ),
                },
                {
                  key: 'c1',
                  header: 'الإجراء',
                  ltr: true,
                  cell: (row) => row.action,
                },
                {
                  key: 'c2',
                  header: 'الكيان',
                  ltr: true,
                  cell: (row) => row.entityType ?? row.entity_type,
                },
                {
                  key: 'c3',
                  header: 'المعرف',
                  ltr: true,
                  cell: (row) => (row.entityId ?? row.entity_id ?? '').slice(0, 8),
                },
                {
                  key: 'c4',
                  header: 'المستخدم',
                  ltr: true,
                  cell: (row) => (row.actorUserId ?? row.actor_user_id ?? '—').slice(0, 8),
                },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
            />
          </Panel>
        ))}
    </Screen>
  );
}
