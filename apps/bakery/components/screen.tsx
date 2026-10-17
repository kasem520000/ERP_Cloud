'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, CardBody, SkeletonCard } from '@erp/ui';

/**
 * 🖥️ غلافُ الشاشة الموحّد — بنيةُ `apps/staff/components/screen.tsx` حرفًا.
 *
 * كلُّ شاشةٍ في هذه الواجهة كانت ترسم ترويستَها يدويًّا (`<header
 * className="flex flex-wrap items-end justify-between gap-3">` …) وبأحجامٍ
 * خطٍّ مختلفة (`text-[22px]` هنا و`text-[24px]` هناك) — أي أنّ «العنوان»
 * لم يكن مكوّنًا واحدًا يُقاس بل ذوقًا يُعاد. والآن: الشاشةُ تُعلن عنوانها
 * وسببَها وما يفعله زرُّها، والقشرةُ ترسمها كما يرسمها staff.
 *
 * وما هنا **غلافٌ لا محتوى**: فالحالات الأربع (فارغ/تحميل/خطأ/ممنوع) مكوّناتٌ
 * منفصلة أدناه، ومنطقُ الشاشة يبقى في `lib/*-screen.ts` كما هو.
 */
export function Screen({
  title,
  subtitle,
  crumbs,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  crumbs?: string[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {crumbs && crumbs.length > 0 ? (
            <nav className="flex flex-wrap items-center gap-1.5 text-[12px] font-bold text-muted" aria-label="المسار">
              {crumbs.map((crumb, i) => (
                <span key={`${crumb}-${i}`} className="flex items-center gap-1.5">
                  {i > 0 ? <span aria-hidden>‹</span> : null}
                  <span className={i === crumbs.length - 1 ? 'text-ink-2' : undefined}>{crumb}</span>
                </span>
              ))}
            </nav>
          ) : null}
          <h1 className="m-0 mt-1 text-[24px] font-bold text-ink tracking-tight leading-tight">{title}</h1>
          {subtitle ? <p className="m-0 mt-1 text-[13px] text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div> : null}
      </section>
      {children}
    </section>
  );
}

/** هيكلٌ عظميّ أثناء التحميل — بلا صمتٍ ولا بلاطةٍ تُوهم برقمٍ وصل. */
export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-1"
      aria-busy="true"
    >
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-4 rounded-md bg-surface-3 animate-pulse"
          style={{ width: `${100 - index * 8}%` }}
        />
      ))}
    </div>
  );
}

/** فشلُ الطلب — مع السبب كما قاله الخادم وزرُّ إعادةٍ لا يُخفي الخطأ. */
export function ErrorBox({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <Card>
      <CardBody>
        <p
          className="m-0 rounded-[10px] border border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger-ink"
          role="alert"
        >
          تعذّر تحميل البيانات: {message ?? 'خطأ غير معروف'}
        </p>
        {onRetry ? (
          <div className="mt-3">
            <button
              className="h-10 rounded-[10px] bg-brand-600 px-4 text-[13.5px] font-bold text-on-accent transition-colors duration-150 hover:bg-brand-700"
              type="button"
              onClick={onRetry}
            >
              إعادة المحاولة
            </button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** رفضُ الصلاحية — والضابطُ الخادم؛ هذه الشاشة لا تمنح ولا ترفع صلاحية. */
export function Forbidden({ permission }: { permission?: string }) {
  return (
    <Card>
      <CardBody className="grid place-items-center gap-2 p-8 text-center">
        <span
          className="grid size-12 place-items-center rounded-2xl bg-warn-soft text-warn"
          aria-hidden
        >
          🔒
        </span>
        <p className="m-0 text-[15px] font-bold text-ink">لا تملك صلاحية الوصول</p>
        {permission ? (
          <p className="m-0 text-[12.5px] text-muted">
            المسارُ يفرض <span dir="ltr">{permission}</span> — والصلاحيةُ تُمنح من
            «⚙️ تعديل الصلاحيات» في لوحة staff.
          </p>
        ) : (
          <p className="m-0 max-w-md text-[13px] text-muted">
            اطلب من مالك الحساب منحك الصلاحية المطلوبة من «صلاحيات المستخدمين».
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/** فراغٌ مُعلَّل — «لا بيانات» حالةٌ تُقال، لا منطقةٌ صامتة. */
export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <Card>
      <CardBody className="grid place-items-center gap-2 p-8 text-center">
        <span
          className="grid size-12 place-items-center rounded-2xl bg-surface-3 text-muted"
          aria-hidden
        >
          🗂️
        </span>
        <p className="m-0 text-[15px] font-bold text-ink">{title}</p>
        {detail ? <p className="m-0 max-w-md text-[13px] text-muted">{detail}</p> : null}
      </CardBody>
    </Card>
  );
}

/** بطاقاتُ هيكلٍ أثناء التحميل — للمجاميع والبلاطات لا للقوائم. */
export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} lines={2} />
      ))}
    </div>
  );
}

/** رابطٌ عائدٌ للوحدة — يُوضع تحت الحالات الخاطئة لا يُترك المستخدم حائرًا. */
export function BackHome({ label = 'الرئيسية' }: { label?: string }) {
  return (
    <Link className="bak-badge" href="/">
      ← {label}
    </Link>
  );
}
