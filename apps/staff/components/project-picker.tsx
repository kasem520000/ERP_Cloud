'use client';

import { Panel } from '@erp/ui';
import Link from 'next/link';

import { apiList } from '../lib/api';
import { useQuery } from '../lib/use-query';

import { Empty, ErrorBox, Loading, Screen } from './screen';
import { Table } from './ui/table';

type ProjectRow = { id: string; code: string; name: string; status: string };

/**
 * اختيار المشروع قبل لوحته (كانبان، جانت، الوقت، التكلفة).
 *
 * الأربع شاشات تشترك في هذه القائمة، فتشترك في شكلها أيضاً: جدولٌ في لوحة،
 * وصفٌّ يُفتح بالضغط على زرّه، وحالةُ فراغٍ تقول من أين يأتي المشروع.
 */
export function ProjectPicker({
  title,
  segment,
}: {
  title: string;
  segment: 'board' | 'gantt' | 'time' | 'cost';
}) {
  const projects = useQuery<ProjectRow[]>(() => apiList<ProjectRow>('/projects'), []);
  const rows = projects.data ?? [];

  return (
    <Screen
      title={title}
      subtitle="اختر المشروع — تُفتح اللوحة على بطاقة المشروع نفسها."
      crumbs={['إدارة المشاريع']}
    >
      {projects.status === 'loading' ? <Loading /> : null}
      {projects.status === 'error' ? (
        <ErrorBox message={projects.error ?? 'تعذّر التحميل'} onRetry={projects.reload} />
      ) : null}
      {projects.status === 'success' ? (
        rows.length === 0 ? (
          <Panel title="المشاريع" flush>
            <Empty title="لا مشاريع بعد" detail="أنشئ مشروعاً من شاشة المشاريع ثم عُد إلى هذه اللوحة." />
          </Panel>
        ) : (
          <Panel title="المشاريع" hint={`${rows.length} مشروعاً`} flush>
            <Table
              bare
              columns={[
                {
                  key: 'c0',
                  header: 'الكود',
                  ltr: true,
                  cell: (project) => project.code,
                },
                {
                  key: 'c1',
                  header: 'المشروع',
                  cell: (project) => project.name,
                },
                {
                  key: 'c2',
                  header: 'الحالة',
                  cell: (project) => <span className={`badge ${project.status}`}>{project.status}</span>,
                },
                {
                  key: 'c3',
                  header: '',
                  cell: (project) => (
                    <Link className="btn sm" href={`/projects/${project.id}/${segment}`}>
                      فتح
                    </Link>
                  ),
                },
              ]}
              rows={rows}
              rowKey={(project) => project.id}
            />
          </Panel>
        )
      ) : null}
    </Screen>
  );
}
