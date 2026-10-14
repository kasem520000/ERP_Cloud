'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Button, ThemeToggle } from '@erp/ui';
import { useSession } from '@erp/web-core/session';

import { BAKERY_APP_CODE, licenceVerdict } from '../lib/licence';
import { moduleForPath, visibleModules } from '../lib/navigation';

import { LicenceWall } from './licence-wall';

/**
 * قشرة واجهة المخابز **وبوابةُ ترخيصها** في آن: لا تُرسم الشاشة ولا يُعرض التنقّل قبل أن
 * تقول `/me` إنّ باقة `bakery_distribution` مفعَّلة للمنشأة.
 *
 * وثلاث حالاتٍ لا رابعة:
 *   • `loading` — الجلسة لم تُحلّ بعد: قولٌ صريح بلا هيكلٍ عظميّ يدّعي بيانات.
 *   • `licensed` — القشرة: شريطٌ جانبيّ بالوحدات (المبنيّة روابط، والمخطَّطة نصّ بنقطتها)،
 *     وشريطٌ علويّ بالهوية والباقة والخروج.
 *   • غير ذلك — `LicenceWall`: رفضٌ مُعلَّل (أو «تعذّر التأكّد» مع إعادة المحاولة).
 *
 * وحدّ الوصول هنا **ترخيصٌ لا صلاحية**: الصلاحيات يفرضها الخادم على كلّ نداء
 * (‏`@RequiresPermission`)، والقائمة تُصفّى بها كي لا تعرض ما سيُرفض — وهذا الترتيب مقصود:
 * إخفاءُ زرٍّ ليس ضابطاً، والضابطُ في `apps/api`.
 */
export function BakeryGuard({ children }: { children: React.ReactNode }) {
  const { can, me, reload, signOut, status } = useSession();
  const pathname = usePathname() ?? '';
  const [drawerOpen, setDrawerOpen] = useState(false);

  const verdict = licenceVerdict({
    authenticated: status === 'authenticated',
    enabledApps: me?.enabledApps,
  });

  if (verdict === 'loading') {
    return (
      <main aria-busy="true" className="bak-main">
        <p className="m-0 text-[13px] text-muted">جارٍ التحقّق من الجلسة ومن ترخيص الباقة…</p>
      </main>
    );
  }

  if (verdict !== 'licensed') {
    return <LicenceWall onRetry={() => void reload()} verdict={verdict} />;
  }

  const modules = visibleModules(can);
  const active = moduleForPath(pathname);
  const tenantName = me?.membership.tenantName ?? me?.membership.displayName ?? 'الإنتاج والتوزيع';

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
            🥖
          </span>
          <span>
            المخابز
            <small>{tenantName}</small>
          </span>
        </div>

        <nav aria-label="وحدات واجهة المخابز" className="bak-nav">
          <p className="bak-nav-title">الوحدات</p>
          {modules.map((module) => {
            const href = module.href;
            if (!href) {
              return (
                <span className="bak-nav-item" key={module.key} title={`${module.phaseAr} — ${module.planAr}`}>
                  <span aria-hidden="true" className={`bak-dot ${module.status}`} />
                  <span aria-hidden="true">{module.icon}</span>
                  {module.labelAr}
                </span>
              );
            }
            const isActive = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
            return (
              <Link
                className={`bak-nav-link ${isActive ? 'active' : ''}`}
                href={href}
                key={module.key}
                onClick={() => setDrawerOpen(false)}
                title={module.planAr}
              >
                <span aria-hidden="true" className={`bak-dot ${module.status}`} />
                <span aria-hidden="true">{module.icon}</span>
                {module.labelAr}
              </Link>
            );
          })}
        </nav>

        <div className="bak-legend">
          <span>
            <span className="bak-dot ready" /> مبنيّ
          </span>
          <span>
            <span className="bak-dot planned" /> مخطَّط
          </span>
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
              ☰
            </Button>
            <nav aria-label="موقعك في الواجهة" className="bak-crumbs">
              <Link href="/">المخابز</Link>
              {active && active.href !== '/' ? ` ← ${active.labelAr}` : ''}
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className="bak-badge ok"
              title={`الباقة القطاعية ${BAKERY_APP_CODE} مفعَّلة لهذه المنشأة (من GET /me)`}
            >
              🔓 الباقة مرخَّصة
            </span>
            <ThemeToggle compact />
            <span className="text-[12px] text-muted">
              {me?.user.fullName} · {me?.membership.tenantCode}
            </span>
            <Button onClick={() => void signOut()} size="sm">
              تسجيل الخروج
            </Button>
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
