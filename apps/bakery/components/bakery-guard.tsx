'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, ThemeToggle } from '@erp/ui';
import { apiData } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';
import { BootCard } from '@erp/web-core/session-gate';

import { licenceVerdict } from '../lib/licence';
import {
  BAKERY_MODULES,
  groupedVisibleModules,
  isRepScoped,
  moduleForPath,
  visibleModules,
  type BakeryGroupKey,
} from '../lib/navigation';

import { LicenceWall } from './licence-wall';
import { BakeryLogoMark, BakeryModuleIcon } from './module-icon';
import { BakeryNotificationBell } from './notification-bell';

const REP_SUB_LINKS = [
  { key: 'overview', labelAr: 'ملخص الوردية', href: '/rep?section=overview' },
  { key: 'receipts', labelAr: 'استلام التوريدات', href: '/rep?section=receipts' },
  { key: 'sale', labelAr: 'فاتورة بيع جديدة', href: '/rep?section=sale' },
  { key: 'returns', labelAr: 'مرتجع مبيعات', href: '/rep?section=returns' },
  { key: 'collection', labelAr: 'تحصيل الذمم', href: '/rep?section=collection' },
  { key: 'documents', labelAr: 'الفواتير والطباعة', href: '/rep?section=documents' },
  { key: 'custody', labelAr: 'أرصدة وأوامر السيارة', href: '/rep?section=custody' },
  { key: 'closing', labelAr: 'إقفال الوردية', href: '/rep?section=closing' },
  { key: 'queue', labelAr: 'طابور عدم الاتصال', href: '/rep?section=queue' },
] as const;

/**
 * قشرة واجهة المخابز الشاملة وبوابةُ ترخيصها، مع قائمة جانبية منظّمة في ١٣ مجموعةً
 * مطابقةً لبنية تطبيق المخابز على أندرويد وبحثٍ فوريّ وروابطَ فرعية لتطبيق المندوب.
 */
export function BakeryGuard({ children }: { children: React.ReactNode }) {
  const { can, me, reload, signOut, status } = useSession();
  const pathname = usePathname() ?? '';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<BakeryGroupKey, boolean>>>({});
  const [repFacts, setRepFacts] = useState<{ isRep: boolean; salesmanName: string | null } | null>(null);
  const canVan = can('van_sales.view');

  useEffect(() => {
    if (status !== 'authenticated' || !canVan) {
      setRepFacts(null);
      return;
    }
    let cancelled = false;
    apiData<{ isRep?: boolean; salesmanName?: string | null }>('/van-sales/me')
      .then((data) => {
        if (!cancelled) {
          setRepFacts({ isRep: data.isRep === true, salesmanName: data.salesmanName ?? null });
        }
      })
      .catch(() => {
        if (!cancelled) setRepFacts({ isRep: false, salesmanName: null });
      });
    return () => {
      cancelled = true;
    };
  }, [status, canVan]);

  const verdict = licenceVerdict({
    authenticated: status === 'authenticated',
    enabledApps: me?.enabledApps,
  });

  if (verdict === 'loading') {
    return <BootCard logo="ERP" text="جارٍ التحقّق من الجلسة ومن ترخيص الباقة…" />;
  }

  if (verdict !== 'licensed') {
    return <LicenceWall onRetry={() => void reload()} verdict={verdict} />;
  }

  const repScoped = isRepScoped(repFacts?.isRep === true, me?.permissions ?? []);
  const modules = visibleModules(can, BAKERY_MODULES, { repScoped });
  const grouped = groupedVisibleModules(can, BAKERY_MODULES, { repScoped, query: navQuery });
  const hasPlanned = modules.some((module) => module.status !== 'ready');
  const active = moduleForPath(pathname);
  const tenantName = me?.membership.tenantName ?? me?.membership.displayName ?? 'الإنتاج والتوزيع';

  const toggleGroup = (key: BakeryGroupKey) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="bak-shell">
      {drawerOpen && (
        <div
          aria-hidden="true"
          className="bak-only-mobile"
          onClick={() => setDrawerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', zIndex: 40 }}
        />
      )}

      <aside className={`bak-side no-print ${drawerOpen ? 'open' : ''}`}>
        <div className="bak-brand">
          <span aria-hidden="true" className="bak-logo">
            <BakeryLogoMark size={22} />
          </span>
          <span>
            المخابز والتوزيع
            <small>{tenantName}</small>
          </span>
        </div>

        <input
          aria-label="بحث في شاشات النظام"
          className="bak-nav-search"
          onChange={(event) => setNavQuery(event.target.value)}
          placeholder="ابحث في الشاشات…"
          type="search"
          value={navQuery}
        />

        <nav aria-label="وحدات واجهة المخابز" className="bak-nav">
          {grouped.map(({ group, items }) => {
            const containsActive = items.some((m) => m.key === active?.key);
            const isOpen = Boolean(navQuery.trim()) || containsActive || !collapsedGroups[group.key];
            return (
              <div className="bak-nav-group" key={group.key}>
                <button
                  aria-expanded={isOpen}
                  className="bak-nav-group-btn"
                  onClick={() => toggleGroup(group.key)}
                  type="button"
                >
                  <span>{group.labelAr}</span>
                  <span className="bak-nav-group-count">{items.length}</span>
                </button>
                {isOpen &&
                  items.map((module) => {
                    const href = module.href;
                    if (!href) {
                      return (
                        <span
                          className="bak-nav-item"
                          key={module.key}
                          title={`${module.phaseAr} — ${module.summaryAr}`}
                        >
                          <span aria-hidden="true" className={`bak-dot ${module.status}`} />
                          <span aria-hidden="true" className="bak-nav-icon">
                            <BakeryModuleIcon moduleKey={module.key} />
                          </span>
                          {module.labelAr}
                        </span>
                      );
                    }
                    const isActive =
                      pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
                    return (
                      <div key={module.key}>
                        <Link
                          className={`bak-nav-link ${isActive ? 'active' : ''}`}
                          href={href}
                          onClick={() => setDrawerOpen(false)}
                          title={module.summaryAr}
                        >
                          <span aria-hidden="true" className={`bak-dot ${module.status}`} />
                          <span aria-hidden="true" className="bak-nav-icon">
                            <BakeryModuleIcon moduleKey={module.key} />
                          </span>
                          {module.labelAr}
                        </Link>
                        {module.key === 'rep-app' && (isActive || repScoped) ? (
                          <div className="bak-nav-sublinks">
                            {REP_SUB_LINKS.map((sub) => (
                              <Link
                                className="bak-nav-sublink"
                                href={sub.href}
                                key={sub.key}
                                onClick={() => setDrawerOpen(false)}
                              >
                                • {sub.labelAr}
                              </Link>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </nav>

        <div className="bak-legend">
          <span>
            <span className="bak-dot ready" /> مبنيّ ({modules.length})
          </span>
          {hasPlanned ? (
            <span>
              <span className="bak-dot planned" /> مخطَّط
            </span>
          ) : (
            <span className="bak-legend-note">لا وحدةَ مخطَّطة — الكلُّ يعمل</span>
          )}
        </div>
      </aside>

      <div className="bak-main">
        <header className="bak-topbar no-print">
          <div className="flex items-center gap-2">
            <Button
              aria-label="إظهار قائمة الوحدات"
              className="bak-only-mobile"
              onClick={() => setDrawerOpen((open) => !open)}
              size="sm"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </Button>
            <nav aria-label="موقعك في الواجهة" className="bak-crumbs">
              <Link href="/">المخابز</Link>
              {active && active.href !== '/' ? ` / ${active.labelAr}` : ''}
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className="bak-badge ok"
              title="الباقة القطاعية «المخابز والتوزيع» مفعَّلة لهذه المنشأة (تُقرأ من جلسة دخولك)"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 7.8-1.2" />
              </svg>
              الباقة مرخَّصة
            </span>
            <BakeryNotificationBell />
            <ThemeToggle compact />
            <span className="bak-topbar-user text-[12px] text-muted">
              {me?.user.fullName} · {me?.membership.tenantCode}
            </span>
            <Button onClick={() => void signOut()} size="sm">
              تسجيل الخروج
            </Button>
          </div>
        </header>

        <div key={pathname} className="page-enter">
          {children}
        </div>
      </div>
    </div>
  );
}
