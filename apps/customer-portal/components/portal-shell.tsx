'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ContentPanel, ViewNotice } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';

import { fetchProfile, logout, readToken, type PortalProfile } from '../lib/api';
import { moneyText } from '../lib/format';
import { portalRoutes } from '../lib/navigation';

type ShellState = { profile: PortalProfile | null; error: string };
const ProfileContext = createContext<ShellState>({ profile: null, error: '' });

/** Reuse the profile already loaded by the gate; never create a second request per screen. */
export const usePortalProfile = () => useContext(ProfileContext);

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<ShellState>({ profile: null, error: '' });
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!readToken()) {
      globalThis.location.assign('/auth/login');
      return;
    }
    fetchProfile()
      .then((profile) => setState({ profile, error: '' }))
      .catch((error: unknown) => setState({ profile: null, error: arabicErrorText(error) }))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return <ViewNotice state="loading">جارٍ فتح البوابة…</ViewNotice>;

  // Do not render a successful-looking ledger for an unlinked or expired account.
  if (!state.profile) {
    return (
      <ContentPanel>
        <h1>لا يمكن فتح البوابة</h1>
        <ViewNotice state="error">{state.error || 'تعذّر تحميل بيانات الحساب.'}</ViewNotice>
        <button className="btn" type="button" onClick={logout}>
          تسجيل الخروج
        </button>
      </ContentPanel>
    );
  }

  const { party, company } = state.profile;
  const dueBalance = state.profile.balance;
  return (
    <ProfileContext.Provider value={state}>
      <div className="portal">
        <aside className="portal-rail" aria-label="حساب العميل">
          <div className="portal-identity">
            <span className="portal-avatar" aria-hidden="true">
              {(party?.name || 'ع').trim().slice(0, 1)}
            </span>
            <div className="portal-identity-text">
              <strong>{party?.name ?? 'بوابة العملاء'}</strong>
              <small>{company.nameAr || 'المورد'}</small>
            </div>
          </div>
          <nav className="portal-links" aria-label="أقسام بوابة العملاء">
            {portalRoutes.map((route) => (
              <Link
                href={route.href}
                key={route.key}
                aria-current={
                  pathname === route.href ||
                  (route.href !== '/portal' && pathname.startsWith(`${route.href}/`))
                    ? 'page'
                    : undefined
                }
              >
                <span>{route.labelAr}</span>
              </Link>
            ))}
          </nav>
          <div className="portal-account-summary">
            <small>الرصيد المستحق</small>
            <strong className="num" dir="auto">
              {moneyText(dueBalance)}
            </strong>
          </div>
          <button className="btn portal-signout" type="button" onClick={logout}>
            تسجيل الخروج
          </button>
        </aside>
        <section className="portal-workspace" aria-label="محتوى الحساب">
          {children}
        </section>
      </div>
    </ProfileContext.Provider>
  );
}
