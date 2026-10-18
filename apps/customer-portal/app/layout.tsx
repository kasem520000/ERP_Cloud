import './globals.css';

import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SYSTEM_NAME_AR, ThemeProvider, ThemeScript } from '@erp/ui/theme';

import { PortalHeaderActions } from '../components/portal-header-actions';
import { TokenBridge } from '../components/token-bridge';

export const metadata: Metadata = {
  title: { default: `بوابة العملاء · ${SYSTEM_NAME_AR}`, template: `%s · ${SYSTEM_NAME_AR}` },
  description: 'بوابة العملاء — الفواتير وكشف الحساب والمدفوعات',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <ThemeScript defaultChoice="system" />
      </head>
      <body>
        <ThemeProvider defaultChoice="system">
          <TokenBridge />
          <div className="wrap">
            <header className="top">
              <Link className="brand" href="/portal">
                <span className="logo" aria-hidden="true">
                  س
                </span>
                <span>
                  {SYSTEM_NAME_AR}
                  <small className="muted" style={{ display: 'block', fontWeight: 500 }}>
                    بوابة العملاء
                  </small>
                </span>
              </Link>
              <PortalHeaderActions />
            </header>
            <main id="main">{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
