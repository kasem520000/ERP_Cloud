'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { apiData } from '../lib/api';

type Notice = { id: string; title: string; body: string };

export function EmployeeShell({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice>();

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const rows = await apiData<Notice[]>('/employee/notices');
        const next = Array.isArray(rows) ? rows[0] : undefined;
        if (!stop && next) {
          setNotice(next);
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification(next.title, { body: next.body, dir: 'rtl', lang: 'ar' });
          }
        }
      } catch {
        // A missing employee link should not block the shell.
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 30000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="employee-app">
      <header className="employee-bar">
        <strong>تطبيق الموظف</strong>
        <nav>
          <Link href="/m">الرئيسية</Link>
          <Link href="/m/attendance">حضور</Link>
          <Link href="/m/requests/new">طلب</Link>
          <Link href="/m/approvals">موافقات</Link>
          <Link href="/m/profile">حسابي</Link>
        </nav>
      </header>
      {notice ? <p className="alert warn">{notice.title}: {notice.body}</p> : null}
      <main>{children}</main>
    </div>
  );
}
