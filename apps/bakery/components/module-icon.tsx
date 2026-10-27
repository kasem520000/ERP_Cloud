import type { ReactNode } from 'react';

/**
 * مجموعة أيقونات واجهة المخابز الشاملة — خطوط SVG موحّدة بقياس 24×24 بلا مكتبة خارجية،
 * تغطّي جميع الوحدات عبر مجموعات القائمة الجانبية الثلاث عشرة.
 */
const PATHS: Record<string, ReactNode> = {
  overview: (
    <>
      <path d="M4 9.5C4 6.5 7 4 12 4s8 2.5 8 5.5c0 1.1-.9 1.9-2 1.9H6c-1.1 0-2-.8-2-1.9Z" />
      <path d="M6 11.4V18a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6.6" />
      <path d="M9.5 14h5" />
    </>
  ),
  pos: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 19h20M7 8h4M7 12h6M15 8h2v4h-2z" />
    </>
  ),
  'sales-invoices': (
    <>
      <path d="M6 3h12v18l-2.5-1.7L13 21l-2.5-1.7L8 21l-2-1.7V3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  prices: (
    <>
      <path d="M12 3H5v7l9.5 9.5a2.1 2.1 0 0 0 3 0l4-4a2.1 2.1 0 0 0 0-3L12 3Z" />
      <circle cx="8.5" cy="6.5" r="1.2" />
    </>
  ),
  'sales-registry': (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  purchases: (
    <>
      <path d="M3 5h2l2.4 9.5a2 2 0 0 0 2 1.5h7.8a2 2 0 0 0 1.9-1.4L21 8H6" />
      <circle cx="9.5" cy="19.5" r="1.5" />
      <circle cx="17" cy="19.5" r="1.5" />
    </>
  ),
  inventory: (
    <>
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
      <path d="M3 7.5v9L12 21l9-4.5v-9M12 12v9" />
    </>
  ),
  'inventory-vouchers': (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 9h8M12 6v6M8 15h8" />
    </>
  ),
  counts: (
    <>
      <path d="M9 4h6v3H9z" />
      <path d="M7 5H5v16h14V5h-2" />
      <path d="m9 13 2 2 4-4" />
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
  policy: (
    <>
      <path d="M12 3 4 6.5v5.5c0 4.8 3.4 8.2 8 9.5 4.6-1.3 8-4.7 8-9.5V6.5L12 3Z" />
      <path d="m9.5 12 2 2 3.5-3.5" />
    </>
  ),
  'cash-boxes': (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M16 12.5h5M16 10h5v5h-5a2.5 2.5 0 0 1 0-5Z" />
    </>
  ),
  'treasury-vouchers': (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h5M15 15l2 2 3-3" />
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
  'system-reports': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 15v-3M11 15V9M15 15v-5M19 15v-7" />
    </>
  ),
  accounting: (
    <>
      <path d="M10 13a4 4 0 0 1 0-6l2-2a4 4 0 0 1 5.7 5.7l-1.2 1.2" />
      <path d="M14 11a4 4 0 0 1 0 6l-2 2a4 4 0 0 1-5.7-5.7l1.2-1.2" />
    </>
  ),
  items: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.4" />
      <rect x="13" y="4" width="7" height="7" rx="1.4" />
      <rect x="4" y="13" width="7" height="7" rx="1.4" />
      <rect x="13" y="13" width="7" height="7" rx="1.4" />
    </>
  ),
  categories: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </>
  ),
  units: (
    <>
      <path d="M4 8h16v8H4z" />
      <path d="M8 8v3M12 8v4M16 8v3" />
    </>
  ),
  parties: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="16.5" cy="9.5" r="2.3" />
      <path d="M3.5 19c.6-2.9 2.7-4.5 5.5-4.5s4.9 1.6 5.5 4.5M14.5 19c.4-2 1.8-3.3 4-3.3 1 0 1.8.3 2.5.9" />
    </>
  ),
  employees: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="10" r="2.6" />
      <path d="M7.5 17.5c.7-2 2.3-3 4.5-3s3.8 1 4.5 3" />
    </>
  ),
  adjustments: (
    <>
      <path d="M12 3v18M8 7h6a2 2 0 0 1 0 4h-4a2 2 0 0 0 0 4h6" />
    </>
  ),
  payroll: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9h.01M18 15h.01" />
    </>
  ),
  'employee-account': (
    <>
      <path d="M5 4h14v16H5z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  'ai-assistant': (
    <>
      <path d="m12 3 1.8 4.4L18 9.2l-4.2 1.8L12 15.5l-1.8-4.5L6 9.2l4.2-1.8L12 3Z" />
      <path d="M18.5 15.5 19.3 17.5 21.3 18.3 19.3 19.1 18.5 21 17.7 19.1 15.7 18.3 17.7 17.5 18.5 15.5Z" />
    </>
  ),
  'ai-settings': (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </>
  ),
  'tax-filings': (
    <>
      <path d="M5 3h14v18H5z" />
      <path d="m9 14 6-6M9.5 8.5h.01M14.5 13.5h.01" />
    </>
  ),
  org: (
    <>
      <path d="M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M14 10h5a1 1 0 0 1 1 1v9M2 20h20" />
      <path d="M7 8h4M7 12h4M7 16h4" />
    </>
  ),
  users: (
    <>
      <circle cx="10" cy="8" r="3.2" />
      <path d="M4 19c.6-3.1 2.9-4.8 6-4.8s5.4 1.7 6 4.8M17 8v6M14 11h6" />
    </>
  ),
  roles: (
    <>
      <path d="M12 3 5 6v5.5c0 4.5 2.9 7.9 7 9.5 4.1-1.6 7-5 7-9.5V6l-7-3Z" />
      <circle cx="12" cy="11" r="2" />
      <path d="M12 13v3" />
    </>
  ),
  support: (
    <>
      <path d="M5 13v-1a7 7 0 0 1 14 0v1" />
      <rect x="3" y="12" width="3.5" height="6" rx="1.5" />
      <rect x="17.5" y="12" width="3.5" height="6" rx="1.5" />
      <path d="M19 18a3 3 0 0 1-3 3h-3" />
    </>
  ),
  notifications: (
    <>
      <path d="M6 10a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10Z" />
      <path d="M10 19a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  printers: (
    <>
      <path d="M7 8V4h10v4" />
      <rect x="4" y="8" width="16" height="8" rx="2" />
      <path d="M7 14h10v6H7z" />
    </>
  ),
  'change-password': (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
      <circle cx="12" cy="15.5" r="1.2" />
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
