'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@erp/ui/theme';

/** The sign-in action belongs to public pages, not to a form already asking users to sign in. */
export function PortalHeaderActions() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="روابط البوابة">
      <ThemeToggle variant="icon" lang="ar" />
      {!pathname.startsWith('/auth/') && !pathname.startsWith('/portal') ? (
        <Link className="btn primary" href="/auth/login">
          دخول
        </Link>
      ) : null}
    </nav>
  );
}
