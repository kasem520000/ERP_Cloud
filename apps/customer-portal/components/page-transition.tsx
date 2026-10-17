'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * A dependency-free route entrance. The portal deliberately ships no motion
 * library; a 220 ms CSS animation is enough to soften navigation and is
 * disabled under `prefers-reduced-motion` in globals.css.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
