'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeToggle } from '@erp/ui/theme';

import { apiData } from '../lib/api';
import { groupForPath, visibleConsoleGroups, type ConsoleItem } from '../lib/navigation';
import { useSession } from '../lib/session';
import { useQuery } from '../lib/use-query';

import { Forbidden } from './screen';

/**
 * قشرة لوحة المنصة (P-C1).
 *
 * Replaces the 9-chip tab strip that used to be the whole navigation. What the plan asked
 * for and what is here:
 *
 * | plan | here |
 * |---|---|
 * | شريط جانبي بمجموعات (العملاء · المال · التشغيل · المنصة) | `lib/navigation.ts` + the `<aside className="side">` below |
 * | بحث شامل `Ctrl+K` عن مستأجر/مستخدم | `Omnibox` — real calls to `GET /platform/tenants/search` and `GET /platform/users?search=` |
 * | جرس التنبيهات | `Bell` — counters read from `GET /platform/overview` (pending activations, licences past due, suspended customers) |
 * | شارة البيئة | from `GET /platform/settings` → `environment` (the API's own `NODE_ENV`) |
 * | فتات الخبز | `Screen`'s `crumbs`, fed by `groupForPath()` |
 * | لوحة RTL | `layout.tsx` already sets `dir="rtl"`; the shell is written with logical properties (`inset-inline-start`, `margin-inline-*`) so RTL is the default, not a style patch |
 *
 * **The gate is unchanged**: a session without effective platform access (`pam`) sees
 * `Forbidden`, exactly as before. What is new is the second gate — `canConsole()` — which
 * hides the items the operator's console codes cannot open. The API refuses them anyway;
 * this only keeps the operator from clicking into a 403.
 */
export function PlatformGuard({ children }: { children: React.ReactNode }) {
  const { isPlatformAdmin, me, signOut } = useSession();
  const pathname = usePathname() ?? '';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const settings = useQuery<{ environment: { name: string; labelAr: string } }>(
    () => apiData('/platform/settings'),
    [],
  );
  const overview = useQuery<{
    tenants: { suspended: number };
    subscriptions: { past_due: number };
    pendingActivations: number;
  }>(() => apiData('/platform/overview'), []);

  const groups = useMemo(
    () => visibleConsoleGroups(me?.platformPermissions ?? []),
    [me?.platformPermissions],
  );
  const activeGroup = groupForPath(pathname);

  // Ctrl+K opens the palette anywhere in the console; Escape closes both overlays.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setDrawerOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!isPlatformAdmin) return <Forbidden />;

  const environment = settings.data?.environment;
  const alerts =
    (overview.data?.pendingActivations ?? 0) +
    (overview.data?.subscriptions.past_due ?? 0) +
    (overview.data?.tenants.suspended ?? 0);

  return (
    <div className="shell">
      <aside className={`side no-print ${drawerOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="logo">ERP</span>
          <span>
            لوحة تحكم المنصة
            <small>{environment ? `بيئة ${environment.labelAr}` : 'البيئة غير معروفة'}</small>
          </span>
        </div>

        <nav className="nav" aria-label="أقسام لوحة المنصة">
          {groups.map((group) => (
            <div className="nav-group" key={group.key}>
              <p className="nav-group-title">
                {group.icon} {group.labelAr}
              </p>
              {group.items.map((entry) => {
                const active = pathname === entry.href || (entry.href !== '/' && pathname.startsWith(entry.href));
                return (
                  <Link
                    key={entry.key}
                    href={entry.href}
                    className={`nav-link ${active ? 'active' : ''}`}
                    onClick={() => setDrawerOpen(false)}
                  >
                    <span className={`dot ${entry.status}`} aria-hidden="true" />
                    {entry.labelAr}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="nav-legend">
          <span>
            <span className="dot ready" /> جاهز
          </span>
          <span>
            <span className="dot planned" /> مخطَّط
          </span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar no-print">
          <div className="row" style={{ alignItems: 'center' }}>
            <button
              className="btn sm only-mobile"
              type="button"
              onClick={() => setDrawerOpen((open) => !open)}
              aria-label="إظهار القائمة"
            >
              ☰
            </button>
            <nav className="crumbs" aria-label="موقعك في اللوحة">
              <Link href="/">المنصة</Link>
              {activeGroup ? ` ← ${activeGroup.labelAr}` : ''}
            </nav>
          </div>

          <div className="row" style={{ alignItems: 'center' }}>
            {/* Design v3 §2.1 — the console is dark-first; this is the same
                switch and the same `erp.theme` key as the two other surfaces,
                so an operator who prefers light gets a complete light console. */}
            <ThemeToggle compact />
            <button className="btn sm" type="button" onClick={() => setPaletteOpen(true)}>
              🔍 بحث شامل <span className="muted small">Ctrl+K</span>
            </button>
            <Bell count={alerts} />
            {environment && (
              <span className={`badge ${environment.name === 'production' ? 'failed' : 'pending'}`}>
                {environment.labelAr}
              </span>
            )}
            <span className="muted small">
              {me?.user.fullName} · {me?.user.email}
            </span>
            <button className="btn sm" type="button" onClick={() => void signOut()}>
              خروج
            </button>
          </div>
        </header>

        {paletteOpen && <Omnibox onClose={() => setPaletteOpen(false)} />}

        {children}
      </div>
    </div>
  );
}

/**
 * جرس التنبيهات — the three counters an operator acts on: unapproved signups, licences
 * past due and suspended customers. The number is a sum, so an operator who wants the
 * detail clicks through to the page that owns each list.
 */
function Bell({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn sm"
        type="button"
        aria-label={`التنبيهات (${count})`}
        onClick={() => setOpen((value) => !value)}
      >
        🔔 {count}
      </button>
      {open && (
        <div
          className="card"
          style={{ position: 'absolute', insetInlineEnd: 0, top: 34, zIndex: 30, minWidth: 240 }}
        >
          <p className="muted small" style={{ margin: 0 }}>
            التنبيهات المفتوحة
          </p>
          <ul style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
            <li>
              <Link href="/activation-requests">طلبات تفعيل بانتظار المراجعة</Link>
            </li>
            <li>
              <Link href="/subscriptions">تراخيص متأخرة السداد</Link>
            </li>
            <li>
              <Link href="/tenants?status=suspended">عملاء موقوفون</Link>
            </li>
          </ul>
          {count === 0 && <p className="muted small">لا شيء مفتوح الآن.</p>}
        </div>
      )}
    </div>
  );
}

type TenantHit = { id: string; code: string; name: string; status: string };
type UserHit = { id: string; email: string; full_name?: string; fullName?: string };

/**
 * البحث الشامل (`Ctrl+K`).
 *
 * Two real endpoints, not a client-side filter over a list that was already fetched:
 * `GET /platform/tenants/search?q=` (added by P-C1) and `GET /platform/users?search=`.
 * The user half is offered only when the session can read the directory
 * (`console.users.view`), so a support operator sees a customer search and nothing else.
 */
function Omnibox({ onClose }: { onClose: () => void }) {
  const { canConsole } = useSession();
  const [term, setTerm] = useState('');
  const [tenants, setTenants] = useState<TenantHit[]>([]);
  const [users, setUsers] = useState<UserHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const canSeeUsers = canConsole('console.users.view');

  const search = useCallback(
    async (value: string) => {
      if (value.trim().length === 0) {
        setTenants([]);
        setUsers([]);
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const [tenantHits, userHits] = await Promise.all([
          apiData<TenantHit[]>(`/platform/tenants/search?q=${encodeURIComponent(value)}`),
          canSeeUsers
            ? apiData<UserHit[]>(`/platform/users?search=${encodeURIComponent(value)}`)
            : Promise.resolve([] as UserHit[]),
        ]);
        setTenants(tenantHits);
        setUsers(userHits.slice(0, 5));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(false);
      }
    },
    [canSeeUsers],
  );

  useEffect(() => {
    const handle = setTimeout(() => void search(term), 200);
    return () => clearTimeout(handle);
  }, [term, search]);

  return (
    <div className="card" role="dialog" aria-label="البحث الشامل" style={{ marginBottom: 16 }}>
      <div className="row">
        <input
          className="input"
          style={{ flex: 1 }}
          autoFocus
          placeholder="ابحث عن عميل (رمز أو اسم) أو مستخدم…"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <button className="btn" type="button" onClick={onClose}>
          إغلاق
        </button>
      </div>

      {busy && <p className="muted small">جارٍ البحث…</p>}
      {error && <p className="alert danger">{error}</p>}

      {!busy && term.trim().length > 0 && tenants.length === 0 && users.length === 0 && !error && (
        <p className="muted small">لا نتائج.</p>
      )}

      {tenants.length > 0 && (
        <>
          <h3>العملاء</h3>
          <div className="chips">
            {tenants.map((hit) => (
              <Link key={hit.id} className="chip" href={`/tenants?search=${encodeURIComponent(hit.code)}`}>
                {hit.name} <span className="muted">({hit.code})</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {users.length > 0 && (
        <>
          <h3>المستخدمون</h3>
          <div className="chips">
            {users.map((hit) => (
              <Link key={hit.id} className="chip" href={`/users?search=${encodeURIComponent(hit.email)}`}>
                {hit.fullName ?? hit.full_name ?? hit.email}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export type { ConsoleItem };
