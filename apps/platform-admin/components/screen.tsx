'use client';

import { KpiStrip, Page, PageHead, type KpiItem } from '@erp/ui';
import { FolderOpen, LockKeyhole } from 'lucide-react';
import type { ReactNode } from 'react';

export function Screen({
  title,
  subtitle,
  crumbs,
  actions,
  kpis,
  filters,
  chips,
  meta,
  children,
}: {
  title: string;
  subtitle?: string;
  crumbs?: string[];
  actions?: ReactNode;
  /** شريط المؤشرات — سطرٌ واحد فوق التصفية. */
  kpis?: KpiItem[];
  /** شريط التصفية الموحّد (`ui-filter-bar`). */
  filters?: ReactNode;
  /** صفّ الحالات (`ui-chip-row`). */
  chips?: ReactNode;
  /** سياق صغير في رأس الصفحة (الفترة، البيئة، الحالة). */
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Page>
      <PageHead
        title={title}
        description={subtitle}
        breadcrumbs={crumbs}
        actions={actions}
        meta={meta}
      />
      <div className="ui-screen-body">
        {kpis && kpis.length > 0 ? <KpiStrip items={kpis} /> : null}
        {filters}
        {chips}
        {children}
      </div>
    </Page>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
 <div className="grid gap-3 rounded-[10px] border border-line bg-surface p-4 shadow-1" aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
 <div key={index} className="h-4 animate-pulse rounded-md bg-surface-3" style={{ width: `${100 - index * 8}%` }} />
      ))}
 </div>
  );
}

export function ErrorBox({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
 <div className="grid gap-3 rounded-[10px] border border-line bg-surface p-4 shadow-1">
 <p className="m-0 flex items-center gap-2 rounded-[10px] border border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger-ink">
 تعذر تحميل البيانات: {message ?? 'خطأ غير معروف'}
 </p>
      {onRetry ? (
 <button
          type="button"
          onClick={onRetry}
          className="h-10 rounded-[8px] bg-brand-600 px-4 text-[13.5px] font-bold text-on-accent transition-colors duration-150 hover:bg-brand-700"
          style={{ justifySelf: 'start' }}
        >
 إعادة المحاولة
 </button>
      ) : null}
 </div>
  );
}

export function Forbidden() {
  return (
 <div className="grid place-items-center gap-2 rounded-[10px] border border-line bg-surface p-8 text-center shadow-1">
 <span className="grid size-12 place-items-center rounded-2xl bg-warn-soft text-warn"><LockKeyhole size={22} strokeWidth={1.7} /></span>
 <p className="m-0 text-[15px] font-bold text-ink">لا تملك صلاحية الوصول</p>
 <p className="m-0 max-w-md text-[13px] text-muted">
 اطلب من مشغّل المنصة منحك الدور المطلوب من «المستخدمون والأدوار».
 </p>
 </div>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
 <div className="grid place-items-center gap-2 rounded-[10px] border border-line bg-surface p-8 text-center shadow-1">
 <span className="grid size-12 place-items-center rounded-2xl bg-surface-3 text-muted"><FolderOpen size={22} strokeWidth={1.7} /></span>
 <p className="m-0 text-[15px] font-bold text-ink">{title}</p>
      {detail ? <p className="m-0 max-w-md text-[13px] text-muted">{detail}</p> : null}
 </div>
  );
}
