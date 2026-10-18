'use client';

import { Page, PageHead, Panel } from '@erp/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiError, apiData } from '../../lib/api';

type EmployeeMe = { id: string; name: string; branchId?: string | null };
type TodayPunch = { id: string; type: string; status: string; at: string };

export default function EmployeeHomePage() {
  const [me, setMe] = useState<EmployeeMe | null>(null);
  const [today, setToday] = useState<TodayPunch[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([
      apiData<EmployeeMe>('/employee/me'),
      apiData<TodayPunch[]>('/employee/attendance/today').catch(() => []),
    ])
      .then(([profile, punches]) => {
        setMe(profile);
        setToday(Array.isArray(punches) ? punches : []);
      })
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : 'تعذر فتح الحساب'));
  }, []);

  const lastPunch = today[today.length - 1];

  return (
    <Page>
      <PageHead
        title={`مرحباً${me?.name ? ` ${me.name}` : ''}`}
        description="سجّل حضورك وانصرافك، واطلب إجازة أو سلفة أو عهدة، وتابع كشوف راتبك وإجازاتك."
        actions={
          <span className={`badge ${lastPunch?.type === 'check_in' ? 'ok' : 'neutral'}`}>
            {lastPunch
              ? lastPunch.type === 'check_in'
                ? 'مسجّل حضور اليوم'
                : 'مسجّل انصراف اليوم'
              : 'لم يُسجّل حضور اليوم بعد'}
          </span>
        }
      />
      {error ? <p className="alert danger">{error}</p> : null}
      <Panel title="إجراءاتي" hint="كل إجراء يفتح شاشته الكاملة.">
        <div className="employee-actions">
          <Link className="btn primary punch" href="/m/attendance">
            حضور وانصراف ({today.length} حركة اليوم)
          </Link>
          <Link className="btn punch" href="/m/requests/new">
            تقديم طلب جديد (إجازة · استئذان · سلفة · عهدة)
          </Link>
          <Link className="btn punch" href="/m/profile">
            راتبي وإجازاتي وعهدي
          </Link>
          <Link className="btn" href="/m/approvals">
            موافقات الفريق (للمديرين والمشرفين)
          </Link>
        </div>
      </Panel>
    </Page>
  );
}
