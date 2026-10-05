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

function statusDot(status: string, lang: Lang) {
  const title =
    status === 'ready'
      ? lang === 'ar'
        ? 'جاهز'
        : 'Ready'
      : status === 'api'
        ? lang === 'ar'
          ? 'الواجهة البرمجية جاهزة'
          : 'API ready'
        : lang === 'ar'
          ? 'قيد التطوير'
          : 'Planned';
  return <span className={`dot ${status}`} title={title} aria-label={title} />;
}

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
  const groups = filter
    ? module.groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => matches(item.labelAr) || matches(item.labelEn)),
        }))
        .filter((group) => group.items.length > 0)
    : module.groups;

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
              {group.items.map((item: ScreenItem) =>
                item.status === 'ready' ? (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={pathname === item.href.split('?')[0] ? 'nav-link active' : 'nav-link'}
                  >
                    {statusDot(item.status, lang)}
                    <span>{label(lang, item)}</span>
                  </Link>
                ) : (
                  <span
                    key={item.key}
                    className="nav-link disabled"
                    title={item.endpoint ?? (lang === 'ar' ? 'قيد التطوير' : 'Planned')}
                    aria-disabled="true"
                  >
                    {statusDot(item.status, lang)}
                    <span>{label(lang, item)}</span>
                  </span>
                ),
              )}
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

        {/* Design v3 §6.1 — بطاقة «تغطية الشاشات»: الشجرة تقول بنفسها كم شاشة
            جاهزة وكم منها ما زالت واجهةً برمجية أو خطة، فلا يدّعي أحد أن كل شيء يعمل. */}
        <CoverageCard tree={tree} />
        <div className="nav-legend">
          <span>
            <span className="dot ready" /> {t('nav.status.ready')}
          </span>
          <span>
            <span className="dot api" /> API
          </span>
          <span>
            <span className="dot planned" /> {t('nav.status.planned')}
          </span>
        </div>
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

/**
 * بطاقة «تغطية الشاشات» — عدّاد صريح لحالة كل شاشة في الشجرة المرئية.
 *
 * ليست زخرفة: هي ما يمنع لوحةَ تحكّمٍ من الإيحاء بأن كل شيء يعمل. الشاشة التي
 * حالتها `api` أو `planned` تُعرض في الشجرة بشارتها، وهذه البطاقة تجمع العدد
 * حتى يرى المالك أين يقف المنتج فعلاً (Design v3 §6.1).
 */
function CoverageCard({ tree }: { tree: ModuleNode[] }) {
  const { t } = useLang();
  // `count`/`screenTotal`, not `total`: the money guard in the root eslint
  // config matches the identifier `total` (PROJECT_CONTRACT §3), and these are
  // screen counts, not riyals.
  const counts = { ready: 0, api: 0, planned: 0 };
  for (const module of tree) {
    for (const group of module.groups) {
      for (const item of group.items) {
        if (item.status === 'ready') counts.ready += 1;
        else if (item.status === 'api') counts.api += 1;
        else counts.planned += 1;
      }
    }
  }
  const screenTotal = counts.ready + counts.api + counts.planned;
  if (screenTotal === 0) return null;
  const pct = Math.round((counts.ready / screenTotal) * 100);
  return (
    <div className="coverage-card" aria-label={t('nav.coverage')}>
      <div className="coverage-head">
        <strong>{t('nav.coverage')}</strong>
        <span className="num" dir="ltr">
          {counts.ready}/{screenTotal}
        </span>
      </div>
      <div className="coverage-bar" role="img" aria-label={`${pct}%`}>
        <span className="ready" style={{ width: `${pct}%` }} />
      </div>
      <p className="coverage-hint">{t('nav.coverage.hint')}</p>
      <ul className="coverage-legend">
        <li>
          <span className="dot ready" aria-hidden /> {t('nav.coverage.ready')}{' '}
          <b className="num">{counts.ready}</b>
        </li>
        <li>
          <span className="dot api" aria-hidden /> {t('nav.coverage.api')} <b className="num">{counts.api}</b>
        </li>
        <li>
          <span className="dot planned" aria-hidden /> {t('nav.coverage.planned')}{' '}
          <b className="num">{counts.planned}</b>
        </li>
      </ul>
    </div>
  );
}
