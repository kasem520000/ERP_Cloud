'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiError, apiData } from '../../lib/api';

export default function EmployeeHomePage() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void apiData<{ name: string }>('/employee/me')
      .then((me) => setName(me.name))
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : 'تعذر فتح الحساب'));
  }, []);

  return (
    <section className="employee-card">
      <h1>مرحباً{name ? ` ${name}` : ''}</h1>
      <p>سجّل حضورك من جوالك، واطلب إجازة أو عهدة، وتابع راتبك.</p>
      {error ? <p className="alert danger">{error}</p> : null}
      <div className="employee-actions">
        <Link className="btn primary punch" href="/m/attendance">حضور وانصراف</Link>
        <Link className="btn" href="/m/requests/new">طلب جديد</Link>
        <Link className="btn" href="/m/profile">راتبي وإجازاتي</Link>
      </div>
    </section>
  );
}
