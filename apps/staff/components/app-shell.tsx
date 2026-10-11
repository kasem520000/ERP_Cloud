'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ThemeToggle } from '@erp/ui/theme';

import { ApiError, apiData, apiPatch } from '../lib/api';
import { useLang, type Lang } from '../lib/i18n';
import { useSession } from '../lib/session';
import { visibleModules, type ModuleNode, type ScreenGroup, type ScreenItem } from '../lib/navigation';

import { AssistantLauncher } from './assistant-launcher';
import { ImpersonationBanner } from './impersonation-banner';
import { NotificationBell } from './notification-bell';

const label = (lang: Lang, item: { labelAr: string; labelEn: string }): string =>
  lang === 'ar' ? item.labelAr : item.labelEn;

/**
 * Desktop-only or local-SQL-Server legacy keys that do not belong in a Cloud SaaS ERP sidebar.
 * Kept in `lib/navigation.ts` for unit tests and AI help snapshot compatibility.
 */
const CLOUD_HIDDEN_KEYS = new Set([
  'settings.database',
  'settings.devices',
  'support.migration',
  'support.RemoteSupport',
  'file-manager',
  'backup',
  'restore',
  'data-rotation',
  'new-file',
  'invoice-maintenance',
  'data-sync',
  'sync-invoices',
  'sync-journals',
  'sync-vouchers',
  'sync-stock',
  'sync-manage',
  'sync-zatca',
  'android-devices',
  'license',
  'about',
  'update',
  'report-designer',
  // Marketplace is promoted to a primary top-level sidebar tab above Help
  'marketplace',
]);

const CLOUD_HIDDEN_HREFS = new Set([
  '/settings/files',
  '/settings/backup',
  '/settings/restore',
  '/settings/data-rotation',
  '/settings/new-file',
  '/settings/invoice-maintenance',
  '/settings/sync',
  '/settings/sync/invoices',
  '/settings/sync/journals',
  '/settings/sync/vouchers',
  '/settings/sync/stock',
  '/settings/sync/manage',
  '/settings/sync/zatca',
  '/settings/devices',
  '/support/license',
  '/support/about',
  '/support/report-designer',
]);

/**
 * Sector add-on module keys that require activation from the Marketplace (`سوق الإضافات`).
 */
const ADDON_MODULE_CODE_BY_NAV_KEY: Record<string, string> = {
  manufacturing: 'manufacturing',
  tailoring: 'tailoring',
  optics: 'optics',
  marina: 'marina',
  projects: 'projects',
  'employee-app': 'employee_app',
  'van-sales': 'van_sales',
};

const ADDON_SETTING_CODE_BY_HREF: Record<string, string> = {
  '/settings/tailoring': 'tailoring',
  '/settings/optics': 'optics',
  '/settings/marina': 'marina',
  '/settings/contracting': 'projects',
  '/inventory/production': 'manufacturing',
};

/**
 * Normalizes a module's groups into the 3 canonical ERP categories requested by the user:
 * 1. التعاريف (Definitions)
 * 2. العمليات (Operations)
 * 3. التقارير (Reports)
 * (Settings keeps its functional groups.)
 */
function normalizeModuleGroups(module: ModuleNode): ScreenGroup[] {
  if (module.key === 'settings' || module.key === 'dashboards') {
    return module.groups;
  }

  const defs: ScreenItem[] = [];
  const ops: ScreenItem[] = [];
  const reports: ScreenItem[] = [];

  for (const group of module.groups) {
    const gk = group.key.toLowerCase();
    const gl = group.labelAr;
    for (const item of group.items) {
      const href = item.href.split('?')[0] ?? item.href;
      const isReport =
        gk.includes('report') ||
        gl.includes('تقارير') ||
        gl.includes('كشوف') ||
        href.startsWith('/reports/') ||
        item.key.includes('report') ||
        item.key.includes('statement') ||
        item.key.includes('balance');
      const isDef =
        gk.includes('def') ||
        gl.includes('تعاريف') ||
        gl.includes('بطاقات') ||
        item.labelAr.startsWith('تعريف ') ||
        item.labelAr.startsWith('بطاقة ') ||
        item.labelAr.includes('دليل الحسابات') ||
        item.labelAr.includes('شجرة الحسابات') ||
        item.labelAr.includes('مراكز التكلفة') ||
        item.labelAr.includes('طرق الدفع') ||
        item.labelAr.includes('الوحدات') ||
        item.labelAr.includes('المجموعات') ||
        item.labelAr.includes('المستودعات');

      if (isReport) {
        reports.push(item);
      } else if (isDef) {
        defs.push(item);
      } else {
        ops.push(item);
      }
    }
  }

  // Ensure Opening Inventory (`مخزون أول المدة`) is explicitly visible at the top of Inventory Operations
  if (
    module.key === 'inventory' &&
    !ops.some((item) => item.href.includes('kind=opening') || item.key === 'opening-stock')
  ) {
    ops.unshift({
      key: 'opening-stock- explicit',
      labelAr: '📦 مخزون أول المدة',
      labelEn: 'Opening inventory',
      href: '/inventory/vouchers?kind=opening',
      status: 'ready',
    });
  }

  const result: ScreenGroup[] = [];
  if (defs.length > 0) {
    result.push({
      key: `${module.key}-defs`,
      labelAr: 'التعاريف',
      labelEn: 'Definitions',
      items: defs,
    });
  }
  if (ops.length > 0) {
    result.push({
      key: `${module.key}-ops`,
      labelAr: 'العمليات',
      labelEn: 'Operations',
      items: ops,
    });
  }
  if (reports.length > 0) {
    result.push({
      key: `${module.key}-reports`,
      labelAr: 'التقارير',
      labelEn: 'Reports',
      items: reports,
    });
  }
  return result;
}

function ModuleBlock({
  module,
  pathname,
  filter,
  lang,
  enabledAddonCodes,
}: {
  module: ModuleNode;
  pathname: string;
  filter: string;
  lang: Lang;
  enabledAddonCodes: Set<string>;
}) {
  const matches = (text: string) => text.toLowerCase().includes(filter.toLowerCase());
  const normalizedGroups = useMemo(() => normalizeModuleGroups(module), [module]);

  const groups = normalizedGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const cleanHref = item.href.split('?')[0] ?? item.href;
        if (item.status !== 'ready') return false;
        if (CLOUD_HIDDEN_KEYS.has(item.key) || CLOUD_HIDDEN_HREFS.has(cleanHref)) return false;
        const requiredAddon = ADDON_SETTING_CODE_BY_HREF[cleanHref];
        if (requiredAddon && !enabledAddonCodes.has(requiredAddon)) return false;
        return !filter || matches(item.labelAr) || matches(item.labelEn);
      }),
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

type AppGate = {
  gatedHrefs: string[];
  enabledHrefs: string[];
  enabledCodes?: string[];
  apps?: Array<{ code: string; enabled: boolean }>;
};
type BrandMark = { logoUrl: string; primaryColor: string; nameAr: string };

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, isPlatformAdmin, signOut, reload } = useSession();
  const { lang, t, setLang } = useLang();
  const pathname = usePathname() ?? '/';
  const [filter, setFilter] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [appGate, setAppGate] = useState<AppGate | null>(null);
  const [brand, setBrand] = useState<BrandMark | null>(null);

  // User Profile Dropdown & Edit Modal state
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [fullNameDraft, setFullNameDraft] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileNotice, setProfileNotice] = useState('');

  useEffect(() => {
    setFullNameDraft(me?.user.fullName ?? '');
  }, [me?.user.fullName]);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    function loadApps() {
      apiData<AppGate>('/marketplace/apps')
        .then((gate) => {
          if (!cancelled) {
            setAppGate({
              gatedHrefs: gate.gatedHrefs ?? [],
              enabledHrefs: gate.enabledHrefs ?? [],
              enabledCodes:
                gate.enabledCodes ??
                (gate.apps ?? []).filter((a) => a.enabled).map((a) => a.code),
            });
          }
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

  const enabledAddonCodes = useMemo(() => new Set(appGate?.enabledCodes ?? []), [appGate]);

  const brandColor =
    brand?.primaryColor && /^#[0-9a-fA-F]{6}$/.test(brand.primaryColor) ? brand.primaryColor : undefined;

  const tree = useMemo(() => {
    const base = visibleModules(me?.permissions ?? [], isPlatformAdmin, appGate).filter(
      (mod) => mod.key !== 'support',
    );

    // Inject Van Sales & Bakery Distribution module when enabled via Marketplace
    const vanSalesModule: ModuleNode = {
      key: 'van-sales',
      icon: '🚚',
      labelAr: 'توزيع المناديب والمخابز',
      labelEn: 'Van Sales & Bakery',
      href: '/van-sales',
      groups: [
        {
          key: 'van-sales-defs',
          labelAr: 'التعاريف',
          labelEn: 'Definitions',
          items: [
            {
              key: 'van-customer-tiers',
              labelAr: 'شرائح أسعار العملاء (6 / 6.5 / 7 ريال)',
              labelEn: 'Customer price tiers',
              href: '/van-sales?tab=prices',
              status: 'ready',
            },
          ],
        },
        {
          key: 'van-sales-ops',
          labelAr: 'العمليات',
          labelEn: 'Operations',
          items: [
            {
              key: 'van-invoicing',
              labelAr: 'فواتير التوزيع (ضريبية ZATCA / عادية)',
              labelEn: 'Van invoicing',
              href: '/van-sales',
              status: 'ready',
            },
            {
              key: 'van-loads',
              labelAr: 'أوامر تحميل السيارات وتصفية العهد',
              labelEn: 'Van load orders',
              href: '/van-sales?tab=loads',
              status: 'ready',
            },
          ],
        },
        {
          key: 'van-sales-reports',
          labelAr: 'التقارير',
          labelEn: 'Reports',
          items: [
            {
              key: 'van-audit-radar',
              labelAr: 'رادار البونص ومنع الخلط الخارجي',
              labelEn: 'Anti-fraud & bonus radar',
              href: '/van-sales?tab=audit',
              status: 'ready',
            },
          ],
        },
      ],
    };

    const withAddons = [...base];
    const salesIdx = withAddons.findIndex((m) => m.key === 'sales');
    if (salesIdx >= 0) {
      withAddons.splice(salesIdx + 1, 0, vanSalesModule);
    } else {
      withAddons.push(vanSalesModule);
    }

    return withAddons.filter((mod) => {
      const addonCode = ADDON_MODULE_CODE_BY_NAV_KEY[mod.key];
      if (!addonCode) return true;
      // Only show sector add-on modules if enabled in Marketplace
      return enabledAddonCodes.has(addonCode);
    });
  }, [me?.permissions, isPlatformAdmin, appGate, enabledAddonCodes]);

  async function saveProfileName(event: React.FormEvent) {
    event.preventDefault();
    setProfileBusy(true);
    setProfileNotice('');
    try {
      await apiPatch('/auth/profile', { fullName: fullNameDraft.trim() });
      await reload();
      setProfileNotice('تم تحديث اسمك في الملف الشخصي بنجاح.');
    } catch (error) {
      setProfileNotice(error instanceof ApiError ? error.message : 'تعذر تحديث الملف الشخصي');
    } finally {
      setProfileBusy(false);
    }
  }

  return (
    <div className="shell">
      <aside className={`side ${mobileOpen ? 'open' : ''}`}>
        <div className="brand">
          {brand?.logoUrl ? (
            <img
              className="logo"
              src={brand.logoUrl}
              alt="شعار المنشأة"
              style={{ background: 'var(--surface)', objectFit: 'contain', padding: 2 }}
            />
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
            <ModuleBlock
              key={module.key}
              module={module}
              pathname={pathname}
              filter={filter}
              lang={lang}
              enabledAddonCodes={enabledAddonCodes}
            />
          ))}

          {/* Primary Top-Level Tabs: Marketplace directly above Support / Help */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)', display: 'grid', gap: 6 }}>
            <Link
              href="/settings/marketplace"
              className={pathname.startsWith('/settings/marketplace') ? 'nav-link home active' : 'nav-link home'}
            >
              🛒 <span>{lang === 'ar' ? 'سوق الإضافات والباقات' : 'Add-ons Marketplace'}</span>
            </Link>
            <Link
              href="/support/help"
              className={pathname.startsWith('/support/help') ? 'nav-link home active' : 'nav-link home'}
            >
              🛟 <span>{lang === 'ar' ? 'طلب المساعدة والدعم' : 'Help & Support'}</span>
            </Link>
          </div>
        </nav>
      </aside>

      <main className="main">
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

          <div className="row" style={{ alignItems: 'center', gap: 8, position: 'relative' }}>
            <div className="row" style={{ alignItems: 'center', gap: 6 }}>
              <ThemeToggle compact />
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

            <NotificationBell label={lang === 'ar' ? 'الإشعارات' : 'Notifications'} />

            {/* User Profile Button & Dropdown Menu */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="btn"
                onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                aria-expanded={profileMenuOpen}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span>👤</span>
                <span>{me?.user.fullName || me?.user.email || 'حسابي'}</span>
                <span aria-hidden>▾</span>
              </button>

              {profileMenuOpen && (
                <div
                  className="card"
                  style={{
                    position: 'absolute',
                    insetInlineEnd: 0,
                    top: 'calc(100% + 6px)',
                    minWidth: 250,
                    zIndex: 60,
                    display: 'grid',
                    gap: 8,
                    padding: 12,
                    boxShadow: 'var(--shadow-3)',
                  }}
                >
                  <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                    <strong>{me?.user.fullName}</strong>
                    <div className="muted small" dir="ltr">
                      {me?.user.email}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      setProfileModalOpen(true);
                    }}
                  >
                    ✏️ تعديل البيانات الشخصية والاسم
                  </button>
                  <Link
                    className="btn sm"
                    href="/settings/change-password"
                    onClick={() => setProfileMenuOpen(false)}
                  >
                    🔑 تغيير كلمة المرور
                  </Link>
                  <Link
                    className="btn sm"
                    href="/settings/two-factor"
                    onClick={() => setProfileMenuOpen(false)}
                  >
                    🔐 التحقق بخطوتين (2FA)
                  </Link>
                  <Link
                    className="btn sm"
                    href="/settings/general"
                    onClick={() => setProfileMenuOpen(false)}
                  >
                    ⚙️ الإعدادات العامة
                  </Link>
                  <button
                    className="btn danger sm"
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void signOut();
                    }}
                  >
                    🚪 {t('nav.logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {profileModalOpen && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.55)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 80,
              padding: 16,
            }}
          >
            <form
              className="card"
              onSubmit={saveProfileName}
              style={{ width: '100%', maxWidth: 440, display: 'grid', gap: 12 }}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>👤 الملف الشخصي وإعدادات الحساب</h2>
                <button type="button" className="btn sm" onClick={() => setProfileModalOpen(false)}>
                  ✕
                </button>
              </div>
              {profileNotice ? <p className="alert ok">{profileNotice}</p> : null}
              <label className="field">
                <span>الاسم الكامل</span>
                <input
                  className="input"
                  required
                  minLength={2}
                  value={fullNameDraft}
                  onChange={(e) => setFullNameDraft(e.target.value)}
                />
              </label>
              <label className="field">
                <span>البريد الإلكتروني</span>
                <input className="input" dir="ltr" disabled value={me?.user.email ?? ''} />
              </label>
              <label className="field">
                <span>المنشأة الحالية</span>
                <input
                  className="input"
                  disabled
                  value={`${me?.membership.tenantName ?? ''} (${me?.membership.tenantCode ?? ''})`}
                />
              </label>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <Link
                  className="btn sm"
                  href="/settings/change-password"
                  onClick={() => setProfileModalOpen(false)}
                >
                  🔑 تغيير كلمة المرور
                </Link>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn" onClick={() => setProfileModalOpen(false)}>
                    إغلاق
                  </button>
                  <button type="submit" className="btn primary" disabled={profileBusy}>
                    {profileBusy ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {children}
      </main>
      <AssistantLauncher />
    </div>
  );
}
