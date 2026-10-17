'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, ThemeToggle } from '@erp/ui';
import { apiData } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { BAKERY_APP_CODE, licenceVerdict } from '../lib/licence';
import { BAKERY_MODULES, isRepScoped, moduleForPath, visibleModules } from '../lib/navigation';

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
  /**
   * هل صاحبُ الجلسة مندوبٌ محصور؟ — يُسأل الخادمُ (`GET /van-sales/me`) ولا يُخمَّن من
   * الأذونات: فالحجبُ في الخادم يقع على **حاملِ بطاقةِ `salesmen`** بلا إذنِ إدارة،
   * وكاتبُ المكتب الذي يملك `van_sales.view` وحدها ولا بطاقةَ له يُفتح له كلّ شيء. فلو
   * خمّنّا من الأذونات لحجبنا عنه شاشاتٍ تعمل — وكذبٌ في هذه الجهة كالكذب في الأخرى.
   * وعند تعذّر السؤال لا يُحجب شيء: فالخادمُ يبقى هو الرافض، والقائمةُ لا تمنح.
   */
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
    return (
      <main aria-busy="true" className="bak-main">
        <p className="m-0 text-[13px] text-muted">جارٍ التحقّق من الجلسة ومن ترخيص الباقة…</p>
      </main>
    );
  }

  if (verdict !== 'licensed') {
    return <LicenceWall onRetry={() => void reload()} verdict={verdict} />;
  }

  const repScoped = isRepScoped(repFacts?.isRep === true, me?.permissions ?? []);
  const modules = visibleModules(can, BAKERY_MODULES, { repScoped });
  const hasPlanned = modules.some((module) => module.status !== 'ready');
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
                <span className="bak-nav-item" key={module.key} title={`${module.phaseAr} — ${module.summaryAr}`}>
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
                title={module.summaryAr}
              >
                <span aria-hidden="true" className={`bak-dot ${module.status}`} />
                <span aria-hidden="true">{module.icon}</span>
                {module.labelAr}
              </Link>
            );
          })}
        </nav>

        {/* الوسيلةُ تُقال فقط إن كان لها معنى: فبعد ٢٠ج صارت الوحداتُ كلّها مبنيّة، وبقاءُ
            «مخطَّط» بجانب «١١ من ١١ وحدة مبنيّة» تناقضٌ يُقرأ ولا يُفسَّر (ولصقةُ صاحبِ
            العمل أظهرتهما معًا). */}
        <div className="bak-legend">
          <span>
            <span className="bak-dot ready" /> مبنيّ
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
              title={`الباقة القطاعية ${BAKERY_APP_CODE} مفعَّلة لهذه المنشأة (تُقرأ من جلسة دخولك)`}
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
