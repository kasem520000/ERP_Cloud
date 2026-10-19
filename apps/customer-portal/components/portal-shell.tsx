'use client';

import { Panel } from '@erp/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Decimal } from 'decimal.js';

import { fetchProfile, logout, readToken, type PortalProfile } from '../lib/api';
import { moneyText } from '../lib/format';
import { portalRoutes } from '../lib/navigation';

type ShellState = { profile: PortalProfile | null; error: string };

const ProfileContext = createContext<ShellState>({ profile: null, error: '' });

/** Lets a page reuse the profile the shell already loaded instead of asking again. */
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
      .catch((error: Error) => setState({ profile: null, error: error.message }))
      .finally(() => setChecked(true));
  }, []);

  if (!checked)
    return (
      <Panel>
        <p className="panel-state">جارٍ فتح البوابة…</p>
      </Panel>
    );

  // An account that exists but is not linked to a customer gets a plain explanation instead of
  // a shell full of endpoints that will all fail the same way.
  if (!state.profile) {
    return (
      <Panel title="لا يمكن فتح البوابة">
        <p className="panel-state">{state.error || 'تعذّر تحميل بيانات الحساب.'}</p>
        <div className="toolbar" style={{ paddingInline: 20, paddingBlockEnd: 20 }}>
          <button className="btn" type="button" onClick={logout}>
            تسجيل الخروج
          </button>
        </div>
      </Panel>
    );
  }

  const { party, company } = state.profile;
  const dueBalance = state.profile.balance;
  const credit = new Decimal(dueBalance || '0').isNegative();

  return (
    <ProfileContext.Provider value={state}>
      <div className="portal">
        <aside className="ui-panel side">
          <div className="ui-panel-body">
            <div className="portal-identity">
              <span className="portal-avatar" aria-hidden>
                {(party?.name ?? 'ع').trim().slice(0, 1)}
              </span>
              <div>
                <strong>{party?.name ?? 'بوابة العملاء'}</strong>
                <small>{company.nameAr || 'المورد'}</small>
              </div>
            </div>
            <nav className="portal-nav" aria-label="أقسام البوابة">
              {portalRoutes.map((route) => (
                <Link
                  href={route.href}
                  key={route.key}
                  className={pathname === route.href ? 'active' : undefined}
                >
                  <span>
                    {route.labelAr}
                    <small>{route.labelEn}</small>
                  </span>
                </Link>
              ))}
            </nav>
            <div className="portal-balance">
              <small>{credit ? 'رصيد دائن لكم' : 'الرصيد المستحق'}</small>
              <div className="ui-kpi-value" style={{ fontSize: 22 }}>
                {moneyText(credit ? new Decimal(dueBalance).abs().toFixed(2) : dueBalance)}
              </div>
            </div>
          </div>
        </aside>
        <section className="grid portal-body">{children}</section>
      </div>
    </ProfileContext.Provider>
  );
}
