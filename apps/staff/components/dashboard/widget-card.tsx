'use client';

import { Panel } from '@erp/ui';
import { GripVertical, Minus, TrendingDown, TrendingUp, X } from 'lucide-react';

import { money } from '../../lib/lookups';
import type { WidgetFigure } from '../../lib/bi-dashboards';
import { Table } from '../ui/table';

function figureText(widget: WidgetFigure): string {
  if (widget.error) return '—';
  if (widget.value === undefined) return '—';
  if (widget.unit === 'money') return `${money(widget.value)} ر.س`;
  return money(widget.value);
}

export function WidgetCard({
  widget,
  editable,
  onDragStart,
  onDrop,
  onRemove,
}: {
  widget: WidgetFigure;
  editable?: boolean;
  onDragStart?: (id: string) => void;
  onDrop?: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const delta = widget.deltaPercent === undefined ? null : Number(widget.deltaPercent);
  const up = (delta ?? 0) >= 0;
  return (
    <div
      draggable={Boolean(editable)}
      onDragStart={() => onDragStart?.(widget.id)}
      onDragOver={(event) => {
        if (editable) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop?.(widget.id);
      }}
      className="h-full"
    >
      <Panel
        className="flex h-full flex-col"
        title={widget.titleAr}
        actions={
          <>
            {editable ? <GripVertical size={14} className="shrink-0 text-muted" aria-hidden /> : null}
            {editable && onRemove ? (
              <button
                type="button"
                className="rounded-md p-1 text-muted hover:bg-surface-3 hover:text-danger"
                onClick={() => onRemove(widget.id)}
                aria-label="حذف المؤشر"
              >
                <X size={14} />
              </button>
            ) : null}
          </>
        }
        bodyClassName="min-h-0 flex-1 p-3"
      >
        {widget.error ? <p className="m-0 text-[13px] text-warn-ink">{widget.error}</p> : null}
        {!widget.error && widget.kind === 'kpi' ? (
          <div>
            <p className="m-0 text-[28px] font-bold tracking-tight text-ink">{figureText(widget)}</p>
            {delta !== null && Number.isFinite(delta) ? (
              <p
                className={`m-0 mt-1 inline-flex items-center gap-1 text-[12px] font-semibold ${up ? 'text-ok' : 'text-danger'}`}
              >
                {delta === 0 ? (
                  <Minus size={13} />
                ) : up ? (
                  <TrendingUp size={13} />
                ) : (
                  <TrendingDown size={13} />
                )}
                {up && delta > 0 ? '+' : ''}
                {delta.toFixed(1)}%
                {widget.comparisonAr ? (
                  <span className="font-normal text-muted">{widget.comparisonAr}</span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}
        {!widget.error && widget.kind === 'chart' ? <Bars series={widget.series ?? []} /> : null}
        {!widget.error && (widget.kind === 'table' || widget.kind === 'list') ? (
          <Rows columns={widget.columns ?? []} rows={widget.rows ?? []} />
        ) : null}
      </Panel>
    </div>
  );
}

function Bars({ series }: { series: { label: string; value: string }[] }) {
  if (series.length === 0) return <p className="m-0 text-[13px] text-muted">لا توجد بيانات</p>;
  const max = Math.max(...series.map((item) => Number(item.value) || 0), 1);
  return (
    <ul className="m-0 grid list-none gap-1.5 p-0">
      {series.map((item) => (
        <li key={item.label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-[12px]">
          <span className="truncate text-muted">{item.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-3">
            <span
              className="block h-full rounded-full bg-brand-600"
              style={{ width: `${Math.max(4, ((Number(item.value) || 0) / max) * 100)}%` }}
            />
          </span>
          <span className="tabular-nums text-ink-2">{money(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The BI layer sends every cell as a raw string, so quantities arrive as `0.0000` while the
 * rest of the interface shows `0`. Strip the noise decimals here — presentational only, the
 * number itself is untouched.
 */
function formatCell(cell: string): string {
  if (!/^-?\d+\.\d{3,}$/.test(cell)) return cell;
  const value = Number(cell);
  return Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : cell;
}

function Rows({ columns, rows }: { columns: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="m-0 text-[13px] text-muted">لا توجد بيانات</p>;
  return (
    <Table
      bare
      dense
      empty={<>لا توجد بيانات</>}
      columns={columns.map((column, index) => ({
        key: String(index),
        header: column,
        cell: (row: string[]) => formatCell(row[index] ?? ''),
      }))}
      rows={rows}
      rowKey={(_, index) => String(index)}
    />
  );
}
