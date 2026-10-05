'use client';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';

import { useSession } from '../lib/session';

import { AppShell } from './app-shell';
import { EmployeeShell } from './employee-shell';
import { LoginScreen } from './login-screen';

/**
 * Everything behind this component requires a session. The admin panel used to be fully
 * public — anybody who could reach port 3001 saw the whole back office.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, error } = useSession();
  const pathname = usePathname() ?? '';
  // The supplier portal and the public signature page authenticate themselves.
  if (pathname.startsWith('/supplier-portal') || pathname.startsWith('/esign')) return children;

  if (status === 'loading') {
    return (
      <div className="boot">
        <div className="boot-card">
          <span className="logo">ERP</span>
          <p>جارٍ التحقق من الجلسة…</p>
        </div>
      </div>
    );
  }

  if (status === 'anonymous')
    return (
      <Suspense>
        <LoginScreen initialError={error} />
      </Suspense>
    );

  if (pathname.startsWith('/m')) return <EmployeeShell>{children}</EmployeeShell>;
  return <AppShell>{children}</AppShell>;
}
