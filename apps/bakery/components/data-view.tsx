'use client';

import type { ReactNode } from 'react';
import { DataTable as DesignDataTable } from '@erp/ui';

import type { QueryState } from '../lib/use-query';

import { Empty, ErrorBox, Forbidden, Loading } from './screen';

/**
 * 🧭 حالاتُ القائمة في مكوّنٍ واحد — كما في `apps/staff/components/data-view.tsx`.
 *
 * كلُّ شاشةٍ كانت تكرّر السلّم نفسه (`loading` → `error` → صفوف)، وبصيغٍ
 * مختلفةٍ قليلًا في كلّ صفحة — فكانت «جارٍ تحميل الدفعات…» و«تعذّر التحميل»
 * و«لا صفوف» تُرسم بثلاثة أشكال في تسع شاشات. والآن: الشاشةُ تُمرّر حالة
 * الطلب، وهذا المكوّن يقرأها في مكانٍ واحد.
 */
export function QueryView<T>({
  query,
  empty,
  emptyDetail,
  isEmpty,
  children,
}: {
  query: QueryState<T>;
  empty?: string;
  emptyDetail?: string;
  /** افتراضيًّا: «مصفوفةٌ بلا عناصر». */
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (query.status === 'loading') return <Loading />;
  if (query.status === 'forbidden') return <Forbidden />;
  if (query.status === 'error')
    return <ErrorBox message={query.error} onRetry={query.reload} />;

  const data = query.data as T;
  const blank = isEmpty
    ? isEmpty(data)
    : Array.isArray(data) && data.length === 0;
  if (blank) return <Empty title={empty ?? 'لا توجد بيانات'} detail={emptyDetail} />;
  return <>{children(data)}</>;
}

/**
 * 📣 تغذيةٌ راجعةٌ بعد الكتابة — بدلَ أربع نسخٍ من `NOTICE_CLASSES` كانت
 * موزّعةً على الشاشات (collection وreports وreps وsales) وبنبرةٍ خامسة
 * في كلّ صفحةٍ تُنسخ فيها. والأنباءُ الآن من رموز النظام وحدها
 * (‏`ok`/`warn`/`danger`/`info`) فلا لونَ لحنٍّ ولا لونَ لخطأ.
 */
export type NoticeKind = 'ok' | 'danger' | 'info' | 'warn';

export type ScreenNotice = { kind: NoticeKind; text: string };

const NOTICE_CLASSES: Record<NoticeKind, string> = {
  ok: 'border-ok-line bg-ok-soft text-ok-ink',
  danger: 'border-danger-line bg-danger-soft text-danger-ink',
  warn: 'border-warn-line bg-warn-soft text-warn-ink',
  info: 'border-line bg-surface-2 text-ink-2',
};

export function Notice({ notice }: { notice?: ScreenNotice }) {
  if (!notice) return null;
  return (
    <p
      className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES[notice.kind]}`}
      role={notice.kind === 'danger' ? 'alert' : 'status'}
    >
      {notice.text}
    </p>
  );
}

/**
 * جدولُ التصميم — إعادةُ تصديرٍ لا غلافٌ: فالمكوّنُ من نظام التصميم
 * (‏`@erp/ui`) وهو الذي ترحّلت إليه `/reports` و`/treasury` بالفعل،
 * والشاشاتُ الأخرى ترحّل إليه عبر `lib/ui-kit.ts` (‏`tableColumns` و
 * ‏`listState` و`rowKeyFrom`). ومستوردُه من هنا ليكون لواجهة المخابز
 * موضعٌ واحدٌ لكلمات الشاشات كما في staff: ‏`DataTable` و`Notice` و
 * ‏`QueryView` من `components/data-view`.
 */
export const DataTable = DesignDataTable;
export type { Column, DataTableProps, SortState, TableState } from '@erp/ui';
