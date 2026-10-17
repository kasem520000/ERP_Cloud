'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { readToken } from '../lib/api';

/**
 * The portal layout is a server component and cannot read the client-stored
 * token, so it used to render «دخول» even for a signed-in customer. This
 * island hides the CTA once a session exists; the sidebar already owns logout.
 */
export function PortalHeaderActions() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    setSignedIn(Boolean(readToken()));
  }, []);

  if (signedIn === null || signedIn) return null;

  return (
    <nav className="nav" aria-label="portal navigation">
      <Link className="btn primary" href="/auth/login">
        دخول
      </Link>
    </nav>
  );
}
