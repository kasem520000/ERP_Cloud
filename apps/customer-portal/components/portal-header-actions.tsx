'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { logout, readToken } from '../lib/api';

/**
 * الشريط العلوي يحمل زرّ الجلسة فقط.
 *
 * هوية العميل ومنشأته مكانها لوحة السياقة في جانب الصفحة، فلا تتكرّر في الرأس؛
 * ويكفي الصفحات الداخلية زرُّ خروج. التخطيط خادميّ لا يقرأ الكوكي، فهذه الجزيرة
 * تقرأ الجلسة وتُبدّل بين «دخول» و«تسجيل الخروج».
 */
export function PortalHeaderActions() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    setSignedIn(Boolean(readToken()));
  }, []);

  if (signedIn === null) return null;

  if (!signedIn) {
    return (
      <nav className="nav" aria-label="portal navigation">
        <Link className="btn primary" href="/auth/login">
          دخول
        </Link>
      </nav>
    );
  }

  return (
    <button className="btn sm" type="button" onClick={logout}>
      تسجيل الخروج
    </button>
  );
}
