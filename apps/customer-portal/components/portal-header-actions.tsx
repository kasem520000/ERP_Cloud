'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { fetchProfile, logout, readToken, type PortalProfile } from '../lib/api';

/**
 * الشريط العلوي يحمل هوية العميل، لا زرّ دخول فقط.
 *
 * التخطيط خادميّ ولا يقرأ الكوكي، فكان الشريط بعد الدخول فارغاً إلا من الشعار —
 * مساحةٌ بيضاء في أعلى كل صفحة. هذه الجزيرة تقرأ الجلسة والملف، وتعرض اسم
 * العميل والمنشأة وزرّ خروج، وتُخفي دعوة الدخول إن كان المستخدم داخل البوابة.
 */
export function PortalHeaderActions() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<PortalProfile | null>(null);

  useEffect(() => {
    if (!readToken()) {
      setSignedIn(false);
      return;
    }
    setSignedIn(true);
    fetchProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
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

  const name = profile?.party?.name;
  const company = profile?.company?.nameAr;

  return (
    <div className="row" style={{ gap: 10, alignItems: 'center' }}>
      {name ? (
        <Link className="row" href="/portal/profile" style={{ gap: 8, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
          <span className="portal-avatar" aria-hidden style={{ width: 30, height: 30, fontSize: 13 }}>
            {name.trim().slice(0, 1)}
          </span>
          <span style={{ display: 'grid', lineHeight: 1.25 }}>
            <strong style={{ fontSize: 13 }}>{name}</strong>
            {company ? <small className="muted" style={{ fontSize: 11 }}>{company}</small> : null}
          </span>
        </Link>
      ) : null}
      <button className="btn sm" type="button" onClick={logout}>
        تسجيل الخروج
      </button>
    </div>
  );
}
