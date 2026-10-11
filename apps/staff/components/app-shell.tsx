'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ThemeToggle } from '@erp/ui/theme';

import { apiData } from '../lib/api';
import { useLang, type Lang } from '../lib/i18n';
import { useSession } from '../lib/session';
import { visibleModules, type ModuleNode, type ScreenItem } from '../lib/navigation';

import { AssistantLauncher } from './assistant-launcher';
import { ImpersonationBanner } from './impersonation-banner';
import { NotificationBell } from './notification-bell';

const label = (lang: Lang, item: { labelAr: string; labelEn: string }): string =>
  lang === 'ar' ? item.labelAr : item.labelEn;

/**
 * Desktop-only or local-SQL-Server legacy keys that do not belong in a Cloud SaaS ERP sidebar.
 * Kept in `lib/navigation.ts` for AI help snapshot compatibility, filtered in the cloud shell.
 */
const CLOUD_HIDDEN_KEYS = new Set([
  'settings.database',
  'settings.devices',
  'support.migration',
  'support.RemoteSupport',
]);

function ModuleBlock({
  module,
  pathname,
  filter,
  lang,
}: {
  module: ModuleNode;
  pathname: string;
  filter: string;
  lang: Lang;
}) {
  const matches = (text: string) => text.toLowerCase().includes(filter.toLowerCase());
  const groups = module.groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.status === 'ready' &&
          !CLOUD_HIDDEN_KEYS.has(item.key) &&
          (!filter || matches(item.labelAr) || matches(item.labelEn)),
      ),
    }))
    .filter((group) => group.items.length > 0);

  const active = groups.some((group) => group.items.some((item) => pathname === item.href.split('?')[0]));
  const [open, setOpen] = useState(active || Boolean(filter));

  if (groups.length === 0) return null;
  const expanded = open || Boolean(filter);

  return (
    <div className={`nav-module ${expanded ? 'open' : ''}`}>
      <button
        type="button"
        className="nav-module-head"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
      >
        <span className="nav-icon" aria-hidden>
          {module.icon}
        </span>
        <span className="nav-module-label">
          {label(lang, module)}
          <small>{lang === 'ar' ? module.labelEn : module.labelAr}</small>
        </span>
        <span className="chev" aria-hidden>
          {expanded ? '▾' : '◂'}
        </span>
      </button>
      {expanded && (
        <div className="nav-groups">
          {groups.map((group) => (
            <div className="nav-group" key={group.key}>
              <p className="nav-group-title">{label(lang, group)}</p>
              {group.items.map((item: ScreenItem) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={pathname === item.href.split('?')[0] ? 'nav-link active' : 'nav-link'}
                >
                  <span>{label(lang, item)}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type AppGate = { gatedHrefs: string[]; enabledHrefs: string[] };
type BrandMark = { logoUrl: string; primaryColor: string; nameAr: string };

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, isPlatformAdmin, signOut } = useSession();
  const { lang, t, setLang } = useLang();
  const pathname = usePathname() ?? '/';
  const [filter, setFilter] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [appGate, setAppGate] = useState<AppGate | null>(null);
  const [brand, setBrand] = useState<BrandMark | null>(null);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    function loadApps() {
      apiData<AppGate>('/marketplace/apps')
        .then((gate) => {
          if (!cancelled) setAppGate({ gatedHrefs: gate.gatedHrefs ?? [], enabledHrefs: gate.enabledHrefs ?? [] });
        })
        .catch(() => undefined);
    }
    function loadBrand() {
      apiData<BrandMark>('/settings/white-label/branding')
        .then((next) => {
          if (!cancelled) setBrand(next);
        })
        .catch(() => undefined);
    }
    loadApps();
    loadBrand();
    window.addEventListener('erp:apps-changed', loadApps);
    window.addEventListener('erp:brand-changed', loadBrand);
    return () => {
      cancelled = true;
      window.removeEventListener('erp:apps-changed', loadApps);
      window.removeEventListener('erp:brand-changed', loadBrand);
    };
  }, [me]);

  useEffect(() => {
    const color = brand?.primaryColor ?? '';
    if (/^#[0-9a-fA-F]{6}$/.test(color)) document.documentElement.style.setProperty('--brand', color);
    return () => {
      document.documentElement.style.removeProperty('--brand');
    };
  }, [brand?.primaryColor]);

  const brandColor = brand?.primaryColor && /^#[0-9a-fA-F]{6}$/.test(brand.primaryColor) ? brand.primaryColor : undefined;
  const tree = useMemo(
    () => visibleModules(me?.permissions ?? [], isPlatformAdmin, appGate),
    [me?.permissions, isPlatformAdmin, appGate],
  );

  return (
    <div className="shell">
      <aside className={`side ${mobileOpen ? 'open' : ''}`}>
        <div className="brand">
          {brand?.logoUrl ? (
            <img className="logo" src={brand.logoUrl} alt="شعار المنشأة" style={{ background: 'var(--surface)', objectFit: 'contain', padding: 2 }} />
          ) : (
            <span className="logo">ERP</span>
          )}
          <span style={brandColor ? { color: brandColor } : undefined}>
            {brand?.nameAr || 'Cloud SaaS ERP'}
            <small>{me?.membership.tenantName ?? '—'}</small>
          </span>
        </div>

        <Link href="/" className={pathname === '/' ? 'nav-link home active' : 'nav-link home'}>
          🏠 <span>{t('nav.home')}</span>
        </Link>

        <input
          className="nav-search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('nav.searchPlaceholder')}
          aria-label={t('nav.searchPlaceholder')}
        />

        <nav className="nav" aria-label={t('nav.searchPlaceholder')}>
          {tree.map((module) => (
            <ModuleBlock key={module.key} module={module} pathname={pathname} filter={filter} lang={lang} />
          ))}
        </nav>
      </aside>

      <main className="main">
        {/* P-C8: لافتةٌ حمراء تسبق كل شاشة ما دام الرمز رمزَ دخولٍ مؤقّت. */}
        <ImpersonationBanner impersonation={me?.impersonation} lang={lang} />
        <header className="topbar">
          <div className="row" style={{ alignItems: 'center' }}>
            <button
              className="btn only-mobile"
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={t('nav.searchPlaceholder')}
            >
              ☰
            </button>
            <div>
              <strong>{me?.membership.tenantName ?? '—'}</strong>
              <p className="muted" style={{ margin: 0 }}>
                {me?.membership.tenantCode
                  ? lang === 'ar'
                    ? `رمز المنشأة: ${me.membership.tenantCode}`
                    : `Tenant code: ${me.membership.tenantCode}`
                  : '—'}
                {me?.membership.isOwner ? (lang === 'ar' ? ' · مالك' : ' · Owner') : ''}
                {isPlatformAdmin ? (lang === 'ar' ? ' · مدير منصة' : ' · Platform admin') : ''}
              </p>
            </div>
          </div>
          <div className="row" style={{ alignItems: 'center' }}>
            <div className="row" style={{ alignItems: 'center', gap: 6 }}>
              {/* Design v3 §2.1 — one switch, one key, both modes complete. */}
              <ThemeToggle compact />
              {/* Design v3 §6.1 — مفتاح AR/EN: القشرة ثنائية اللغة بالكامل،
                  ويقلب `<html dir>` فتنعكس كل الخصائص المنطقية. */}
              <div className="lang-switch" role="group" aria-label={t('nav.lang')}>
                <button
                  type="button"
                  className={lang === 'ar' ? 'on' : ''}
                  aria-pressed={lang === 'ar'}
                  onClick={() => setLang('ar')}
                >
                  ع
                </button>
                <button
                  type="button"
                  className={lang === 'en' ? 'on' : ''}
                  aria-pressed={lang === 'en'}
                  onClick={() => setLang('en')}
                >
                  EN
                </button>
              </div>
            </div>
            <span className="muted">{me?.user.fullName}</span>
            {/* P-C7: جرسٌ يقود إلى مركز الإشعارات — الرقم إشعاراتٌ غير مقروءة للعضويّة الحالية. */}
            <NotificationBell label={lang === 'ar' ? 'الإشعارات' : 'Notifications'} />
            <Link className="btn" href="/settings/change-password">
              {lang === 'ar' ? 'كلمة المرور' : 'Password'}
            </Link>
            <Link
              className="btn"
              href="/settings/two-factor"
              title={lang === 'ar' ? 'التحقق بخطوتين' : 'Two-factor authentication'}
            >
              🔐
            </Link>
            <button className="btn danger" type="button" onClick={() => void signOut()}>
              {t('nav.logout')}
            </button>
          </div>
        </header>
        {children}
      </main>
      <AssistantLauncher />
    </div>
  );
}
