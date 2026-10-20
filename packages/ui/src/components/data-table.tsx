'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn';

import { Table } from './table';

/**
 * DataTable — **مُهايئٌ** فوق `Table` المشتركة، لا جدولٌ ثانٍ.
 *
 * كان في الحزمة جدولان كاملان: `Table` (ترويسة لاصقة، فرز، تحديد، إجماليات، صفٌّ
 * منفتح) و`DataTable` (فرز، مخفيّ أعمدة، ترقيم، أربع حالات). فاختلف الحشو والحالة
 * الفارغة والزبرا بين شاشتين تعرضان الشيء نفسه، وأيُّ إصلاحٍ في أحدهما يترك الآخر.
 *
 * الآن كل صفوف `<table>` تُرسم في مكانٍ واحد (`Table`)، وهذا الملف يُضيف فوقها فقط
 * ما كان حصريًّا به ولا يوجد في `Table`: **مُخفي الأعمدة المحفوظ في `localStorage`**
 * و**الحالتان الخطأ/بلا صلاحية** و**الترقيم بزرّي السابق/التالي**.
 */

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** End-align with tabular figures. */
  numeric?: boolean;
  /** Force LTR for codes, serials and amounts. */
  ltr?: boolean;
  grow?: boolean;
  width?: number | string;
  sortable?: boolean;
  /** A column can be hidden by the visitor. */
  hideable?: boolean;
  /** Hidden by default (a wide, rarely-read column). */
  defaultHidden?: boolean;
};

export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export type TableState =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'forbidden'; message?: string };

export type DataTableProps<T> = {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  state?: TableState;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  activeKey?: string;
  /** Sticky footer cells in column order — totals. */
  footer?: ReactNode[];
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  sortable?: boolean;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  actions?: (row: T) => Array<{ label: string; icon?: ReactNode; onClick: () => void; danger?: boolean }>;
  dense?: boolean;
  zebra?: boolean;
  /** Enables the column chooser and names its `localStorage` entry. */
  storageKey?: string;
  pageSize?: number;
  /** Extra class on the scrolling wrapper. */
  className?: string;
  labels?: Partial<TableLabels>;
};

export type TableLabels = {
  selectAll: string;
  selectRow: string;
  openActions: string;
  closeActions: string;
  empty: string;
  error: string;
  forbidden: string;
  loading: string;
  columns: string;
  page: string;
  previous: string;
  next: string;
};

const DEFAULT_LABELS: TableLabels = {
  selectAll: 'تحديد الكل',
  selectRow: 'تحديد الصف',
  openActions: 'فتح القائمة',
  closeActions: 'إغلاق القائمة',
  empty: 'لا توجد سجلات لعرضها',
  error: 'تعذّر تحميل البيانات',
  forbidden: 'لا تملك صلاحية عرض هذه الشاشة',
  loading: 'جارٍ التحميل…',
  columns: 'الأعمدة',
  page: 'صفحة',
  previous: 'السابق',
  next: 'التالي',
};

/** Prefix for every column-chooser key — one namespace, never per-app forks. */
const STORAGE_PREFIX = 'erp.table.columns.';

const buttonChrome =
  'h-7 rounded-sm border border-line bg-surface px-2 font-bold transition-colors duration-150 hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-55';

function readHidden(storageKey: string | undefined, columns: Array<Column<never>>): Set<string> {
  const fallback = new Set(columns.filter((column) => column.defaultHidden).map((column) => column.key));
  if (!storageKey) return fallback;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
  } catch {
    return fallback;
  }
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  state = { kind: 'ready' },
  empty,
  onRowClick,
  activeKey,
  footer,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  sortable = false,
  sort,
  onSortChange,
  actions,
  dense = false,
  zebra = true,
  storageKey,
  pageSize,
  className = '',
  labels: labelOverrides,
}: DataTableProps<T>) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const [hidden, setHidden] = useState<Set<string>>(() =>
    readHidden(storageKey, columns as Array<Column<never>>),
  );
  const [page, setPage] = useState(0);
  const [chooserOpen, setChooserOpen] = useState(false);
  const chooserRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify([...hidden]));
    } catch {
      /* a blocked storage must not break the chooser */
    }
  }, [hidden, storageKey]);

  useEffect(() => {
    if (!chooserOpen) return;
    const onDown = (event: MouseEvent) => {
      if (chooserRef.current && !chooserRef.current.contains(event.target as Node)) setChooserOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChooserOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [chooserOpen]);

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hidden.has(column.key)),
    [columns, hidden],
  );
  const hideable = useMemo(() => columns.filter((column) => column.hideable !== false), [columns]);

  const paged = useMemo(() => {
    if (!pageSize || pageSize <= 0) return { items: rows, pages: 1, current: 0 };
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const current = Math.min(page, pages - 1);
    return { items: rows.slice(current * pageSize, current * pageSize + pageSize), pages, current };
  }, [rows, pageSize, page]);

  /** الحالة غير الجاهزة تُعرض مكان الجسم — لا صفَّ فارغاً يبدو كخطأ تحميل. */
  const statePlaceholder =
    state.kind === 'error' ? (
      <div className="grid place-items-center gap-1 py-4 text-center">
        <strong className="text-[13.5px] text-danger-ink">{state.message || labels.error}</strong>
        <span className="text-[12.5px] text-muted">تحقّق من الاتصال ثم أعد المحاولة.</span>
      </div>
    ) : state.kind === 'forbidden' ? (
      <div className="grid place-items-center gap-1 py-4 text-center">
        <strong className="text-[13.5px] text-warn-ink">{state.message || labels.forbidden}</strong>
        <span className="text-[12.5px] text-muted">تُمنح الصلاحية من «تعديل الصلاحيات».</span>
      </div>
    ) : undefined;

  const items = state.kind === 'ready' || state.kind === 'loading' ? paged.items : [];

  return (
    <div className={cn('grid gap-2', className)}>
      <Table
        bare
        dense={dense}
        zebra={zebra}
        loading={state.kind === 'loading'}
        rows={items}
        rowKey={rowKey}
        activeKey={activeKey}
        onRowClick={onRowClick}
        footer={footer}
        selectable={selectable}
        selectedKeys={selectedKeys}
        onSelectionChange={onSelectionChange}
        sortable={sortable}
        sort={sort}
        onSortChange={onSortChange}
        actions={actions}
        empty={statePlaceholder ?? empty ?? labels.empty}
        columns={visibleColumns.map((column) => ({
          key: column.key,
          header: column.header,
          cell: column.cell,
          numeric: column.numeric,
          ltr: column.ltr,
          grow: column.grow,
          width: column.width,
          sortable: column.sortable,
        }))}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
        <div className="flex items-center gap-2">
          {pageSize && pageSize > 0 && paged.pages > 1 ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={paged.current === 0}
                onClick={() => setPage(paged.current - 1)}
                className={buttonChrome}
              >
                {labels.previous}
              </button>
              <span className="num px-1">
                {labels.page} {paged.current + 1} / {paged.pages}
              </span>
              <button
                type="button"
                disabled={paged.current >= paged.pages - 1}
                onClick={() => setPage(paged.current + 1)}
                className={buttonChrome}
              >
                {labels.next}
              </button>
            </div>
          ) : (
            <span className="num">{rows.length}</span>
          )}
        </div>

        {storageKey && hideable.length > 1 ? (
          <div className="relative" ref={chooserRef}>
            <button
              type="button"
              onClick={() => setChooserOpen((value) => !value)}
              aria-expanded={chooserOpen}
              className={cn(buttonChrome, 'text-ink')}
            >
              {labels.columns}
            </button>
            {chooserOpen ? (
              <div className="absolute end-0 bottom-full z-30 mb-1 max-h-64 w-52 overflow-auto rounded-md border border-line bg-raised p-1.5 shadow-4">
                {hideable.map((column) => (
                  <label
                    key={column.key}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[12.5px] text-ink transition-colors duration-150 hover:bg-surface-3"
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 accent-brand"
                      checked={!hidden.has(column.key)}
                      onChange={(event) =>
                        setHidden((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.delete(column.key);
                          else next.add(column.key);
                          return next;
                        })
                      }
                    />
                    <span className="truncate">{column.header}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
