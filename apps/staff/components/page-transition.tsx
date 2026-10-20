'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * A route transition that is intentionally short (240 ms).
 *
 * It explains that the page changed; it never delays the route. Under
 * `prefers-reduced-motion` the content is rendered with no animation at all.
 * `key={pathname}` makes the animation run once per navigation instead of on
 * every re-render of the authenticated shell.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const reduce = useReducedMotion();

  if (reduce) return <>{children}</>;

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
