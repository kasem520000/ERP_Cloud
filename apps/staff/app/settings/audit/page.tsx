'use client';

import { Panel, formatDateTime } from '@erp/ui';
import { useState } from 'react';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { Table } from '../../../components/ui/table';
import { apiData } from '../../../lib/api';
import { useQuery } from '../../../lib/use-query';

/**
 * سجلّ التدقيق كما يصل من `GET /audit-log` (DTO الخادم):
 * `createdAt` · `entity` · `action` · `actorLabel` · `before` · `after` · `meta`.
 * وكانت الشاشة تقرأ `occurredAt` و`entityType` — حقولاً لا وجود لها في الاستجابة،
 * فكانت «الوقت» تُعرض بلحظة العرض و«الكيان» يبقى فارغاً. الصحيح هنا.
 */
type AuditRow = {
  id: string;
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  createdAt?: string;
};

const ACTION_LABEL: Record<string, string> = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  'delete-soft': 'حذف منطقي',
  restore: 'استرجاع',
  post: 'ترحيل',
  void: 'إلغاء',
  login: 'دخول',
  logout: 'خروج',
  export: 'تصدير',
  import: 'استيراد',
};

type Change = { field: string; before: string; after: string };

const scalar = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/** كل حقلٍ تغيّر فعلاً بين `before` و`after` — لا قائمةٌ بحقول الكيان كلها. */
function changesOf(row: AuditRow): Change[] {
  const before = row.before ?? {};
  const after = row.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys
    .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map((key) => ({ field: key, before: scalar(before[key]), after: scalar(after[key]) }));
}

export default function TenantAuditPage() {
  const audit = useQuery<AuditRow[] | { items?: AuditRow[]; data?: AuditRow[] }>(
    () => apiData('/audit-log?limit=100'),
    [],
  );
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const rows: AuditRow[] = Array.isArray(audit.data)
    ? audit.data
    : ((audit.data as { items?: AuditRow[] })?.items ?? []);

  const changes = selected ? changesOf(selected) : [];
  const meta = (selected?.meta ?? {}) as Record<string, unknown>;

  return (
    <Screen
      title="سجلات المستخدمين"
      subtitle="سجل غير قابل للتعديل لكل عملية مؤثرة: من فعل ماذا ومتى، وما تغيّر قبل/بعد. النطاق محدد بالمنشأة الحالية."
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
          <Empty
            title="لا توجد سجلات بعد"
            detail="سيُكتب هنا أول إجراء مؤثر: حفظ فاتورة، تعديل إعداد، منح صلاحية."
          />
        ) : (
          <>
            <Panel title="سجل التدقيق" hint={`${rows.length} حدثاً · اختر صفاً لقراءة تفاصيله`} flush>
              <Table
                bare
                activeKey={selected?.id}
                onRowClick={(row) => setSelected((current) => (current?.id === row.id ? null : row))}
                columns={[
                  {
                    key: 'c0',
                    header: 'الوقت',
                    ltr: true,
                    cell: (row) => (row.createdAt ? formatDateTime(row.createdAt) : '—'),
                  },
                  {
                    key: 'c1',
                    header: 'الإجراء',
                    cell: (row) => ACTION_LABEL[row.action] ?? row.action,
                  },
                  { key: 'c2', header: 'الكيان', ltr: true, cell: (row) => row.entity },
                  {
                    key: 'c3',
                    header: 'المعرّف',
                    ltr: true,
                    cell: (row) => (row.entityId ?? '—').slice(0, 8),
                  },
                  {
                    key: 'c4',
                    header: 'المنفّذ',
                    cell: (row) => row.actorLabel ?? (row.actorUserId ?? '—').slice(0, 8),
                  },
                  {
                    key: 'c5',
                    header: 'التغيير',
                    numeric: true,
                    cell: (row) => {
                      const count = changesOf(row).length;
                      if (row.action === 'create') return 'إنشاء';
                      if (row.action === 'delete') return 'حذف';
                      return count === 0 ? '—' : `${count} حقلاً`;
                    },
                  },
                ]}
                rows={rows}
                rowKey={(row) => row.id}
              />
            </Panel>

            {selected ? (
              <Panel
                title={`تفاصيل ${ACTION_LABEL[selected.action] ?? selected.action} — ${selected.entity}`}
                hint={selected.entityId ? `المعرّف ${selected.entityId}` : 'لا معرّف مرتبطاً بهذا الحدث'}
                flush
              >
                {changes.length === 0 ? (
                  <Empty
                    bare
                    title="لا فرق محفوظاً لهذا الحدث"
                    detail="أحداث الدخول والتصدير لا تحمل صورةً قبل/بعد — تحمل البيانات الوصفية فقط."
                  />
                ) : (
                  <Table
                    bare
                    columns={[
                      { key: 'f', header: 'الحقل', ltr: true, cell: (row) => row.field },
                      {
                        key: 'b',
                        header: 'قبل',
                        ltr: true,
                        cell: (row) => <span className="audit-before">{row.before}</span>,
                      },
                      {
                        key: 'a',
                        header: 'بعد',
                        ltr: true,
                        cell: (row) => <span className="audit-after">{row.after}</span>,
                      },
                    ]}
                    rows={changes}
                    rowKey={(row) => row.field}
                  />
                )}
                <div className="audit-meta">
                  {(
                    [
                      ['الطريقة', meta.method],
                      ['المسار', meta.path],
                      ['العنوان', meta.ip],
                      ['التتبّع', meta.traceId],
                    ] as Array<[string, unknown]>
                  )
                    .filter(([, value]) => value !== undefined && value !== null && value !== '')
                    .map(([label, value]) => (
                      <span key={label} className="muted small">
                        {label}: <span dir="ltr">{String(value)}</span>
                      </span>
                    ))}
                </div>
              </Panel>
            ) : null}
          </>
        ))}
    </Screen>
  );
}
