'use client';

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

import { CountUp } from './count-up';

export type MetricTone = 'violet' | 'green' | 'amber' | 'red' | 'sky' | 'slate';

const TONES: Record<MetricTone, { accent: string; text: string }> = {
  violet: { accent: 'var(--gold)', text: 'text-gold-ink' },
  green: { accent: 'var(--brand)', text: 'text-brand' },
  amber: { accent: 'var(--warn)', text: 'text-warn' },
  red: { accent: 'var(--danger)', text: 'text-danger' },
  sky: { accent: 'var(--info)', text: 'text-info' },
  slate: { accent: 'var(--muted)', text: 'text-muted' },
};

/**
 * بطاقة مقياس — الأرقام بخط Mono (JetBrains) مع وسم اتجاه وخط شرارة صغير.
 * صك Vercel/Linear: بطاقة خفيفة، رقم كبير، شرارة 40px.
 */
export function MetricCard({
  label,
  value,
  suffix,
  icon,
  tone = 'violet',
  delta,
  deltaLabel,
  spark,
  hint,
  delay = 0,
  live,
}: {
  label: string;
  value: number;
  suffix?: string;
  icon?: ReactNode;
  tone?: MetricTone;
  /** نسبة التغيّر (تُعرض سهمًا أخضر/أحمر). */
  delta?: number;
  deltaLabel?: string;
  /** نقاط الشرارة (تُرسم آخر 30 نقطة). */
  spark?: number[];
  hint?: string;
  delay?: number;
  /** نقطة نابضة — «live» مثل مؤشرات Linear. */
  live?: boolean;
}) {
  const toneDef = TONES[tone];
  const positive = (delta ?? 0) >= 0;
  const points = (spark ?? []).slice(-30);
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className="exec-card relative overflow-hidden p-4"
    >
      <span
        aria-hidden
        className="absolute inset-x-4 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${toneDef.accent}, transparent)`, opacity: 0.6 }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted">
            {label}
            {live ? (
              <span className="relative inline-flex size-2 rounded-full bg-ok">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-70" />
              </span>
            ) : null}
          </p>
          <p
            className="m-0 mt-2 text-[27px] font-extrabold leading-none tracking-[-0.025em] text-ink"
            style={{ fontFamily: 'var(--font-num)', fontVariantNumeric: 'tabular-nums' }}
            dir="ltr"
          >
            <CountUp value={value} />
            {suffix ? <span className="text-[15px] font-semibold text-muted"> {suffix}</span> : null}
          </p>
        </div>
        {icon ? (
          <span className={`grid size-9 flex-none place-items-center rounded-[10px] border border-line/70 bg-surface-2 ${toneDef.text}`}>
            {icon}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {delta !== null && delta !== undefined ? (
            <p className="m-0 flex items-center gap-1 text-[11.5px] font-bold" style={{ color: positive ? 'var(--ok)' : 'var(--danger)' }}>
              <span dir="ltr">{positive ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%</span>
              {deltaLabel ? <span className="font-medium text-muted">{deltaLabel}</span> : null}
            </p>
          ) : hint ? (
            <p className="m-0 truncate text-[11.5px] font-medium text-muted">{hint}</p>
          ) : null}
        </div>
        {points.length > 1 ? (
          <svg width="88" height="36" viewBox="0 0 88 36" className="flex-none overflow-visible" aria-hidden>
            <polyline
              fill="none"
              stroke={toneDef.accent}
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={points.map((p, i) => `${(i / (points.length - 1)) * 88},${32 - ((p - min) / range) * 28 + 2}`).join(' ')}
            />
            <circle
              cx="88"
              cy={32 - (((points[points.length - 1] ?? max) - min) / range) * 28 + 2}
              r="2.4"
              fill={toneDef.accent}
            />
          </svg>
        ) : null}
      </div>
    </motion.article>
  );
}
