'use client';

import { Panel } from '@erp/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { deleteCustomReport, listCustomReports, type CustomReport } from '../../../lib/custom-fields';
import { useSession } from '../../../lib/session';

export default function CustomReportsPage() {
  const { can } = useSession();
  const [reports, setReports] = useState<CustomReport[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string>();

  const reload = async (): Promise<void> => {
    setState('loading');
    try {
      setReports(await listCustomReports());
      setState('ready');
      setError(undefined);
    } catch (cause) {
      setState('error');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  useEffect(() => {
    void reload();
  }, []);
  if (!can('custom_reports.view'))
    return (
      <Screen title="التقارير المحفوظة" crumbs={['التقارير']}>
        <Forbidden />
      </Screen>
    );

  return (
    <Screen
      title="التقارير المحفوظة"
      subtitle="شغّل أو عدّل تقاريرك المخصصة من مكان واحد."
      crumbs={['التقارير', 'التقارير المحفوظة']}
      actions={
        <Link className="btn primary" href="/reports/builder">
          تقرير جديد
        </Link>
      }
    >
      {state === 'loading' ? (
        <Loading rows={5} />
      ) : state === 'error' ? (
        <ErrorBox message={error} onRetry={() => void reload()} />
      ) : reports.length === 0 ? (
        <Panel title="التقارير المحفوظة">
          <p className="m-0 text-sm text-muted">لا توجد تقارير محفوظة بعد. ابدأ من منشئ التقارير.</p>
        </Panel>
      ) : (
        <Panel flush title="التقارير المحفوظة" hint={`${reports.length} تقرير`}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>اسم التقرير</th>
                  <th>الكيان</th>
                  <th>الرسم</th>
                  <th>عام</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td className="font-semibold">
                      <Link
                        className="text-brand-700 hover:underline"
                        href={`/reports/builder?id=${report.id}`}
                      >
                        {report.name}
                      </Link>
                    </td>
                    <td dir="ltr">{report.baseEntity}</td>
                    <td>{report.chartType}</td>
                    <td>{report.isPublic ? 'نعم' : 'لا'}</td>
                    <td className="text-start">
                      {can('custom_reports.manage') ? (
                        <button
                          type="button"
                          className="text-danger hover:underline"
                          onClick={async () => {
                            if (window.confirm('حذف التقرير؟')) {
                              await deleteCustomReport(report.id);
                              await reload();
                            }
                          }}
                        >
                          حذف
                        </button>
                      ) : null}
                    </td>
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
