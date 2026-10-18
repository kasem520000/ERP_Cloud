'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageFrame, PageHeader } from '@erp/ui/page';

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
    <PageFrame>
      <PageHeader
        title={title}
        description={subtitle}
        actions={actions}
        breadcrumbs={
          crumbs && crumbs.length > 0 ? (
            <ol className="flex flex-wrap items-center gap-1.5">
              {crumbs.map((crumb, index) => (
                <li key={`${crumb}-${index}`} className="flex items-center gap-1.5">
                  {index > 0 ? <span aria-hidden="true">‹</span> : null}
                  <span aria-current={index === crumbs.length - 1 ? 'location' : undefined}>{crumb}</span>
                </li>
              ))}
            </ol>
          ) : undefined
        }
      />
      {children}
    </PageFrame>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-1 grid gap-3" aria-busy="true">
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
      <span className="grid place-items-center size-12 rounded-2xl bg-warn-soft text-warn">🔒</span>
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
      <span className="grid place-items-center size-12 rounded-2xl bg-surface-3 text-muted">🗂️</span>
      <p className="m-0 text-[15px] font-bold text-ink">{title}</p>
      {detail ? <p className="m-0 text-[13px] text-muted max-w-md">{detail}</p> : null}
    </div>
  );
}

/**
 * Placeholder for a screen that exists in the menu tree but is not built yet.
 * It never fakes data or exposes implementation details such as endpoints and codes.
 * The route remains explicit so an unavailable feature cannot masquerade as a working screen.
 */
export function ScreenScaffold({ href }: { href: string }) {
  const item = findScreenByHref(href);

  if (!item) {
    return (
      <Screen title="صفحة غير متاحة">
        <Empty title="هذه الشاشة غير مسجلة في شجرة النظام" detail="تحقق من الرابط أو ارجع للرئيسية." />
        <Link className="btn" href="/">
          الرئيسية
        </Link>
      </Screen>
    );
  }

  return (
    <Screen
      title={item.labelAr}
      subtitle="هذه الخدمة غير متاحة حالياً"
      crumbs={[item.moduleLabelAr, item.groupLabelAr]}
    >
      <div className="rounded-xl border border-line bg-surface p-6 shadow-1 grid gap-3">
        <h2 className="m-0 text-lg font-bold text-ink">لم تتوفر هذه الشاشة بعد</h2>
        <p className="m-0 text-[13.5px] text-ink-2">
          لا يمكن تنفيذ هذا الإجراء من هنا الآن. ارجع إلى الصفحة الرئيسية أو تواصل مع مسؤول النظام لمعرفة
          البدائل المتاحة.
        </p>
        <Link className="btn" href="/">
          العودة إلى الرئيسية
        </Link>
      </div>
    </Screen>
  );
}
