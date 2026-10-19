'use client';

import { Panel } from '@erp/ui';
import { Fragment, type ReactNode } from 'react';

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
    <Panel title={panel} flush>
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

/** Plain, dense table. No sorting or pagination magic — the API decides the order. */
/**
 * Dense table with the extras a document screen needs: zebra rows, clickable rows,
 * an expandable detail row and a totals footer. Every option is opt-in, so the
 * thirteen screens already calling it keep working unchanged.
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
    <div className="table-wrap">
      <table
        className={[zebra ? 'zebra' : '', compact ? 'compact' : ''].filter(Boolean).join(' ') || undefined}
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === 'num' ? 'num' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty ? (
            <tr>
              <td colSpan={columns.length} className="table-blank">
                {empty}
              </td>
            </tr>
          ) : null}
          {rows.map((row, index) => {
            const key = rowKey(row, index);
            const active = activeKey !== undefined && activeKey === key;
            return (
              <Fragment key={key}>
                <tr
                  className={
                    [onRowClick ? 'clickable' : '', active ? 'row-active' : ''].filter(Boolean).join(' ') ||
                    undefined
                  }
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={column.align === 'num' ? 'num' : undefined}
                      dir={column.align === 'ltr' ? 'ltr' : undefined}
                    >
                      {column.cell(row, index)}
                    </td>
                  ))}
                </tr>
                {expanded ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      style={{ background: 'var(--surface-2)', padding: '8px 12px' }}
                    >
                      {expanded(row)}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
        {footer ? (
          <tfoot>
            <tr>
              {footer.map((cell, index) => (
                <td
                  key={columns[index]?.key ?? index}
                  className={columns[index]?.align === 'num' ? 'num' : undefined}
                >
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** Inline feedback after a mutation. */
export function Notice({ notice }: { notice?: { kind: 'ok' | 'danger' | 'info' | 'warn'; text: string } }) {
  if (!notice) return null;
  return <p className={`alert ${notice.kind}`}>{notice.text}</p>;
}
