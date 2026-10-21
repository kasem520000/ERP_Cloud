'use client';

import { Panel, Table } from '@erp/ui';
import type { ReactNode } from 'react';

import type { QueryState } from '../lib/use-query';

import { Empty, ErrorBox, Forbidden, Loading } from './screen';

/**
 * Renders the four states of a query in one place.
 *
 * Every module screen needs the same ladder — loading → forbidden → error → empty →
 * data — and repeating it per page is where inconsistencies (and silently swallowed
 * 403s) creep in.
 */
export function QueryView<T>({
  query,
  empty,
  emptyDetail,
  isEmpty,
  wrapEmpty,
  panel,
  panelHint,
  panelActions,
  children,
}: {
  query: QueryState<T>;
  empty?: string;
  emptyDetail?: string;
  /** Defaults to "an array with no elements". */
  isEmpty?: (data: T) => boolean;
  /**
   * Wraps the empty state in the screen's own frame (a `Panel` with its head),
   * so an empty result keeps the same panel every populated result has instead
   * of replacing it with a bare card.
   */
  wrapEmpty?: (empty: ReactNode) => ReactNode;
  /**
   * Wraps the whole result — the table or the empty state — in a titled `Panel`.
   * A section that is a direct child of the screen must be a panel like every
   * other section; otherwise its heading disappears when the list is empty.
   */
  panel?: ReactNode;
  /** A sentence under the panel title — what the current mode/list means. */
  panelHint?: ReactNode;
  /** Controls that belong to the list itself (a bulk quantity, an export, a link). */
  panelActions?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const render = (): ReactNode => {
    if (query.status === 'loading') return <Loading />;
    if (query.status === 'forbidden') return <Forbidden />;
    if (query.status === 'error') return <ErrorBox message={query.error} onRetry={query.reload} />;

    const data = query.data as T;
    const blank = isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0;
    if (blank) {
      const node = <Empty title={empty ?? 'لا توجد بيانات'} detail={emptyDetail} />;
      return <>{wrapEmpty ? wrapEmpty(node) : node}</>;
    }
    return <>{children(data)}</>;
  };

  const body = render();
  if (panel === undefined) return <>{body}</>;
  return (
    <Panel title={panel} hint={panelHint} actions={panelActions} flush>
      {body}
    </Panel>
  );
}

export type Column<T> = {
  key: string;
  header: string;
  /** `num` right-aligns and uses tabular figures; `ltr` forces latin direction. */
  align?: 'num' | 'ltr';
  cell: (row: T, index: number) => ReactNode;
};

/**
 * جدولُ المكتب — **غلافٌ رقيق** حول `Table` المشتركة، لا نسخةٌ ثانية منها.
 *
 * كان هذا الملف جدولاً كاملاً مكتوباً بخطّ اليد (`<table>` + `thead` + `tbody`)، بينما
 * 44 شاشةً أخرى تستعمل `Table` من `@erp/ui`؛ فيختلف الحشو والزبرا والحالة الفارغة
 * بين شاشتين تعرضان الشيء نفسه. الآن كلاهما واحد: هذه الدالّة تُترجم أسماء الخصائص
 * القديمة (`align`, `compact`, `expanded`) إلى خصائص الجدول المشترك، فتبقى 111
 * نقطةَ استدعاء كما هي بلا تعديل.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  zebra = true,
  compact,
  onRowClick,
  activeKey,
  footer,
  expanded,
  empty,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  zebra?: boolean;
  compact?: boolean;
  onRowClick?: (row: T) => void;
  activeKey?: string;
  /** Cells of the totals row, in column order. */
  footer?: ReactNode[];
  /** Detail rendered under the row — lot, serial, the source document. */
  expanded?: (row: T) => ReactNode;
  /** Shown in place of the body when the query returned nothing. */
  empty?: string;
}) {
  return (
    <Table
      bare
      zebra={zebra}
      dense={compact}
      rows={rows}
      rowKey={rowKey}
      onRowClick={onRowClick}
      activeKey={activeKey}
      footer={footer}
      renderRowDetail={expanded}
      empty={empty}
      columns={columns.map((column) => ({
        key: column.key,
        header: column.header,
        cell: column.cell,
        numeric: column.align === 'num',
        ltr: column.align === 'ltr',
      }))}
    />
  );
}

/** Inline feedback after a mutation. */
export function Notice({ notice }: { notice?: { kind: 'ok' | 'danger' | 'info' | 'warn'; text: string } }) {
  if (!notice) return null;
  return <p className={`alert ${notice.kind}`}>{notice.text}</p>;
}
