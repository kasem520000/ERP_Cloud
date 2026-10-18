'use client';

import Link from 'next/link';
import { FolderOpen, LockKeyhole } from 'lucide-react';
import type { ReactNode } from 'react';

import { findScreenByHref } from '../lib/navigation';

/**
 * Standard page chrome — v2: breadcrumbs + 24px title + subtitle + actions,
 * matching the redesigned pages (dashboard / invoices / reports).
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
    <div className="grid gap-4">
      <header className="page-head">
        <div className="page-head-copy">
          {crumbs && crumbs.length > 0 ? (
            <nav className="crumbs" aria-label="مسار الصفحة">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb}-${index}`}>
                  {index > 0 ? <span aria-hidden> / </span> : null}
                  {crumb}
                </span>
              ))}
            </nav>
          ) : null}
          <h1 className="page-head-title">{title}</h1>
          {subtitle ? <p className="page-head-sub">{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-head-actions no-print">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="rounded-xl border border-line bg-surface p-4 shadow-1 grid gap-3"
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

export function ErrorBox({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-1 grid gap-3">
      <p className="m-0 flex items-center gap-2 rounded-xl border border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger-ink">
        تعذر تحميل البيانات: {message ?? 'خطأ غير معروف'}
      </p>
      {onRetry ? (
        <button
          className="h-10 px-4 rounded-[10px] bg-brand-600 text-on-accent text-[13.5px] font-bold hover:bg-brand-700 transition-colors duration-150"
          type="button"
          onClick={onRetry}
          style={{ justifyContent: 'flex-start' }}
        >
          إعادة المحاولة
        </button>
      ) : null}
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="rounded-xl border border-line bg-surface p-8 shadow-1 grid place-items-center text-center gap-2">
      <span className="grid place-items-center size-12 rounded-2xl bg-warn-soft text-warn">
        <LockKeyhole size={22} strokeWidth={1.7} aria-hidden />
      </span>
      <p className="m-0 text-[15px] font-bold text-ink">لا تملك صلاحية الوصول</p>
      <p className="m-0 text-[13px] text-muted max-w-md">
        اطلب من مالك الحساب منحك الصلاحية المطلوبة من «صلاحيات المستخدمين».
      </p>
    </div>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-8 shadow-1 grid place-items-center text-center gap-2">
      <span className="grid place-items-center size-12 rounded-2xl bg-surface-3 text-muted">
        <FolderOpen size={22} strokeWidth={1.7} aria-hidden />
      </span>
      <p className="m-0 text-[15px] font-bold text-ink">{title}</p>
      {detail ? <p className="m-0 text-[13px] text-muted max-w-md">{detail}</p> : null}
    </div>
  );
}

/**
 * A route that exists in the menu tree but has no screen behind it yet.
 *
 * Production rule: it renders a plain, customer-facing "not available" state —
 * no API path, no permission code, no roadmap wording, no «قيد التطوير». Those
 * belong in the repository, not in front of an accountant. In development the
 * same state is kept; the engineering detail is available in the code and in
 * `docs/ui-v5/SCREENS.md` instead.
 */
export function ScreenScaffold({ href }: { href: string }) {
  const item = findScreenByHref(href);
  return (
    <Screen title={item?.labelAr ?? 'صفحة غير متاحة'} crumbs={item ? [item.moduleLabelAr, item.groupLabelAr] : undefined}>
      <Empty
        title="هذه الصفحة غير متاحة في نسختك"
        detail="إن وصلت إلى هنا من رابط قديم، فارجع إلى القائمة الجانبية أو تواصل مع مسؤول الحساب لتفعيل الوحدة."
      />
      <Link className="btn" href="/">
        العودة إلى الرئيسية
      </Link>
    </Screen>
  );
}
