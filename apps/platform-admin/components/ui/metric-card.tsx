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
  bare = false,
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
  /**
   * داخل لوحةٍ لها سطحها: تُسقط الخليّةُ حدودَها وحشوها وتبقى شبكةً نصّية —
   * فلا سطحٌ داخل سطح.
   */
  bare?: boolean;
}) {
  const toneDef = TONES[tone];
  const positive = (delta ?? 0) >= 0;
  const points = (spark ?? []).slice(-30);
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.3, delay, ease: [0.16, 1, 0.3, 1] }}
      className={bare ? 'ui-kpi-cell-plain' : 'ui-kpi-cell'}
    >
      <span className="ui-kpi-label">
        {icon ? (
          <span className={`ui-kpi-icon ${toneDef.text}`} aria-hidden>
            {icon}
          </span>
        ) : null}
        {label}
        {live ? (
          <span className="relative inline-flex size-2 rounded-full bg-ok">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-70" />
          </span>
        ) : null}
      </span>
      <span className="ui-kpi-value" dir="ltr">
        <CountUp value={value} />
        {suffix ? <span className="text-[1rem] font-semibold text-muted"> {suffix}</span> : null}
      </span>
      {delta !== null && delta !== undefined ? (
        <span className={`ui-kpi-delta ${positive ? 'is-up' : 'is-down'}`}>
          <span dir="ltr">
            {positive ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
          </span>
          {deltaLabel ? <span className="ui-kpi-delta-label">{deltaLabel}</span> : null}
        </span>
      ) : hint ? (
        <span className="ui-kpi-hint">{hint}</span>
      ) : null}
      {points.length > 1 ? (
        <svg width="88" height="30" viewBox="0 0 88 30" className="overflow-visible" aria-hidden>
          <polyline
            fill="none"
            stroke={toneDef.accent}
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={points
              .map((p, i) => `${(i / (points.length - 1)) * 88},${26 - ((p - min) / range) * 22 + 2}`)
              .join(' ')}
          />
          <circle
            cx="88"
            cy={26 - (((points[points.length - 1] ?? max) - min) / range) * 22 + 2}
            r="2.4"
            fill={toneDef.accent}
          />
        </svg>
      ) : null}
    </motion.div>
  );
}
