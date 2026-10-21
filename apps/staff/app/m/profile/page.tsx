'use client';

import { Page, PageHead, Panel } from '@erp/ui';
import { useEffect, useState } from 'react';

import { apiData } from '../../../lib/api';

type Slip = { period: string; net: string };
type Leave = { id: string; status: string; starts_on: string | null; ends_on: string | null; reason: string };
type Custody = { id: string; reason: string };

export default function EmployeeProfilePage() {
  const [slips, setSlips] = useState<Slip[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [custodies, setCustodies] = useState<Custody[]>([]);

  useEffect(() => {
    void Promise.all([
      apiData<Slip[]>('/employee/payslips').catch(() => []),
      apiData<Leave[]>('/employee/leaves').catch(() => []),
      apiData<Custody[]>('/employee/custodies').catch(() => []),
    ]).then(([nextSlips, nextLeaves, nextCustodies]) => {
      setSlips(Array.isArray(nextSlips) ? nextSlips : []);
      setLeaves(Array.isArray(nextLeaves) ? nextLeaves : []);
      setCustodies(Array.isArray(nextCustodies) ? nextCustodies : []);
    });
  }, []);

  return (
    <Page>
      <PageHead
        title="حسابي"
        description="كشف الراتب والإجازات والعهد — كل ما يخصّك في مكان واحد."
        breadcrumbs={['تطبيق الموظف', 'حسابي']}
      />
      <Panel title="كشف الراتب" hint="آخر الكشوف الصادرة.">
        {slips.length === 0 ? (
          <p className="m-0 text-sm text-muted">لا كشوف بعد.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {slips.map((slip) => (
              <li
                key={slip.period}
                className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
              >
                <span className="font-semibold">{slip.period}</span>
                <span className="num font-bold">{slip.net}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="إجازاتي" hint="حالة كل طلب كما يراها المدير.">
        {leaves.length === 0 ? (
          <p className="m-0 text-sm text-muted">لا طلبات إجازة.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {leaves.map((leave) => (
              <li
                key={leave.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
              >
                <span className="font-semibold" dir="ltr">
                  {leave.starts_on}
                </span>
                <span className="badge">{leave.status}</span>
                <span className="text-sm text-muted">{leave.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="عهدي" hint="العهد المعتمدة باسمك.">
        {custodies.length === 0 ? (
          <p className="m-0 text-sm text-muted">لا عهد معتمدة.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {custodies.map((row) => (
              <li key={row.id} className="border-b border-line pb-2 text-sm last:border-0 last:pb-0">
                {row.reason}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Page>
  );
}
