'use client';

import { animate, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * رقم يعدّ تصاعدياً من 0 حتى قيمته عند دخوله مجال الرؤية (count-up).
 * يقبل `format` لضبط الشكل (فواصل، عملة…).
 */
export function CountUp({
  value,
  format,
  duration = 0.9,
  className = '',
}: {
  value: number;
  format?: (value: number) => string;
  duration?: number;
  className?: string;
}) {
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(format ? format(0) : '0');
  const reduce = useReducedMotion();
  /** The value currently painted — a data refresh animates from here, not from 0. */
  const current = useRef(0);
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const paint = (next: number) => {
      current.current = next;
      setDisplay(formatRef.current ? formatRef.current(next) : Math.round(next).toLocaleString('en-US'));
    };
    if (reduce) {
      paint(value);
      return;
    }
    const controls = animate(current.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: paint,
    });
    return () => controls.stop();
  }, [inView, value, duration, reduce]);

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }} dir="ltr">
      {display}
    </span>
  );
}

/** غلاف ظهور تدريجي (fade + slide) عند دخول مجال الرؤية. */
export function Reveal({
  children,
  delay = 0,
  y = 14,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  /**
   * A `whileInView` reveal leaves content at `opacity: 0` until it is scrolled to —
   * which means the browser prints a blank section and a page opened with a focus
   * anchor shows nothing below it. Reduced motion and print therefore render the
   * content plainly; `.reveal` is the hook the print rule in globals.css uses.
   */
  if (reduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`reveal ${className}`.trim()}
      data-reveal=""
    >
      {children}
    </motion.div>
  );
}
