import type { ReactNode } from 'react';

/**
 * Bakery's icon set — hand-rolled line SVGs, 24×24, one weight.
 *
 * The app deliberately ships no icon package; these eleven glyphs are all the
 * bakery surface needs, and keeping them here means the shell and the module
 * map speak the same visual language without adding a dependency.
 */
const PATHS: Record<string, ReactNode> = {
  overview: (
    <>
      <path d="M4 9.5C4 6.5 7 4 12 4s8 2.5 8 5.5c0 1.1-.9 1.9-2 1.9H6c-1.1 0-2-.8-2-1.9Z" />
      <path d="M6 11.4V18a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6.6" />
      <path d="M9.5 14h5" />
    </>
  ),
  production: (
    <>
      <path d="M3 20V9l5 3V8l5 3V7l5 3v10H3Z" />
      <path d="M7 20v-4h3v4M14 20v-4h3v4" />
    </>
  ),
  distribution: (
    <>
      <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.7" />
      <circle cx="17" cy="18" r="1.7" />
    </>
  ),
  reps: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 20c.6-3.4 3-5.2 6.5-5.2s5.9 1.8 6.5 5.2" />
    </>
  ),
  sales: (
    <>
      <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  collection: (
    <>
      <path d="M3 7h16v10H3z" />
      <path d="M3 10h16" />
      <circle cx="16.5" cy="14" r="1.2" />
    </>
  ),
  custody: (
    <>
      <path d="M8 4h8v3H8z" />
      <path d="M6 5H4v16h16V5h-2" />
      <path d="M8 11h8M8 15h6" />
    </>
  ),
  treasury: (
    <>
      <path d="M3 9 12 3l9 6M4 9h16M5 9v8M9 9v8M15 9v8M19 9v8M3 20h18" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </>
  ),
  accounting: (
    <>
      <path d="M10 13a4 4 0 0 1 0-6l2-2a4 4 0 0 1 5.7 5.7l-1.2 1.2" />
      <path d="M14 11a4 4 0 0 1 0 6l-2 2a4 4 0 0 1-5.7-5.7l1.2-1.2" />
    </>
  ),
  'rep-app': (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.4" />
      <path d="M10.5 5.5h3" />
      <circle cx="12" cy="18.2" r="0.9" />
    </>
  ),
};

export function BakeryModuleIcon({ moduleKey, size = 16 }: { moduleKey: string; size?: number }) {
  const path = PATHS[moduleKey] ?? PATHS.overview;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {path}
    </svg>
  );
}

/** The bakery brand mark — the same loaf as `overview`, drawn on a navy plate. */
export function BakeryLogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS.overview}
    </svg>
  );
}
