'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * بطاقة مؤشر — أيقونة في مربع ملون، رقم 32px، نسبة تغيّر، وخيط sparkline خلف الرقم.
 * `stagger` يتحكم بتوقيت الدخول ضمن المجموعة.
 */
export type KpiTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate';

const TONE_BOX: Record<KpiTone, string> = {
  blue: 'bg-info-soft text-info',
  green: 'bg-ok-soft text-ok',
  amber: 'bg-warn-soft text-warn',
  red: 'bg-danger-soft text-danger',
  purple: 'bg-brand-soft text-brand',
  slate: 'bg-surface-3 text-muted',
};

const TONE_SPARK: Record<KpiTone, string> = {
  blue: 'var(--color-chart-1)',
  green: 'var(--color-chart-3)',
  amber: 'var(--color-chart-4)',
  red: 'var(--color-chart-5)',
  purple: 'var(--color-chart-2)',
  slate: 'var(--muted)',
};

/** Tiny inline sparkline — an SVG path over normalized points. */
export function Sparkline({ points, color, width = 120, height = 36 }: { points: number[]; color: string; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => `${(i * stepX).toFixed(1)},${(height - 3 - ((p - min) / span) * (height - 6)).toFixed(1)}`);
  const path = `M${coords.join(' L')}`;
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <path d={area} fill={color} opacity={0.12} />
      <motion.path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </svg>
  );
}

export type KpiCardProps = {
  title: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: KpiTone;
  /** Percent vs previous period, e.g. +12.4 or -3.1. */
  delta?: number | null;
  deltaLabel?: string;
  spark?: number[];
  hint?: ReactNode;
  /** Enter animation delay (stagger), seconds. */
  delay?: number;
};

export function KpiCard({ title, value, icon, tone = 'blue', delta, deltaLabel, spark, hint, delay = 0 }: KpiCardProps) {
  const positive = (delta ?? 0) >= 0;
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className="exec-card kpi-exec relative overflow-hidden p-4"
    >
      <span
        aria-hidden
        className="absolute inset-x-4 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${TONE_SPARK[tone]}, transparent)`, opacity: 0.5 }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{title}</p>
          <p className="m-0 mt-2 text-[31px] font-extrabold leading-none tracking-[-0.02em] text-ink" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </p>
        </div>
        <span className={`grid size-10 flex-none place-items-center rounded-[11px] border border-line/70 ${TONE_BOX[tone]}`}>{icon}</span>
      </div>

      <div className="mt-3.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          {delta !== null && delta !== undefined ? (
            <p
              className="m-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-bold"
              style={{
                color: positive ? 'var(--ok-ink)' : 'var(--danger-ink)',
                background: positive ? 'var(--ok-soft)' : 'var(--danger-soft)',
              }}
            >
              {positive ? <ArrowUpRight size={13} /> : delta < 0 ? <ArrowDownRight size={13} /> : <Minus size={13} />}
              <span dir="ltr">{Math.abs(delta).toFixed(1)}%</span>
              {deltaLabel ? <span className="font-medium text-muted">{deltaLabel}</span> : null}
            </p>
          ) : hint ? (
            <p className="m-0 truncate text-[11.5px] font-medium text-muted">{hint}</p>
          ) : null}
        </div>
        {spark && spark.length > 1 ? (
          <Sparkline points={spark} color={TONE_SPARK[tone]} />
        ) : null}
      </div>
    </motion.article>
  );
}
