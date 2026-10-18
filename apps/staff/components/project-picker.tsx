'use client';

import { Panel } from '@erp/ui';
import Link from 'next/link';

import { apiList } from '../lib/api';
import { useQuery } from '../lib/use-query';

import { Empty, ErrorBox, Loading, Screen } from './screen';

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
          <Empty title="لا مشاريع بعد" detail="أنشئ مشروعاً من شاشة المشاريع ثم عُد إلى هذه اللوحة." />
        ) : (
          <Panel title="المشاريع" hint={`${rows.length} مشروعاً`} flush>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الكود</th>
                    <th>المشروع</th>
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((project) => (
                    <tr key={project.id}>
                      <td dir="ltr">{project.code}</td>
                      <td>{project.name}</td>
                      <td>
                        <span className={`badge ${project.status}`}>{project.status}</span>
                      </td>
                      <td>
                        <Link className="btn sm" href={`/projects/${project.id}/${segment}`}>
                          فتح
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )
      ) : null}
    </Screen>
  );
}
