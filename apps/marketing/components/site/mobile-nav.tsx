'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Item = { key: string; href: string; label: string };

/**
 * قائمةُ الهاتف في الموقع التسويقي.
 *
 * كان `.site-nav` يُخفى تحت 980px **بلا بديل**: زائرُ الهاتف لا يجد إلا روابط
 * التذييل. هذا المكوّن يعيد المقصد نفسه (نفس `.site-nav` التي تظهر على سطح
 * المكتب) داخل لوحةٍ منسدلة، مع `aria-expanded` و`aria-controls`، وإغلاقٍ
 * بـEscape، واحترام `prefers-reduced-motion` (الحركة في CSS).
 */
export function MobileNav({
  items,
  loginHref,
  loginLabel,
  startHref,
  startLabel,
  label,
}: {
  items: Item[];
  loginHref: string;
  loginLabel: string;
  startHref: string;
  startLabel: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="mobile-nav-wrap">
      <button
        type="button"
        className="mobile-nav-btn"
        aria-expanded={open}
        aria-controls="site-mobile-nav"
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`mobile-nav-icon${open ? ' is-open' : ''}`} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      <nav id="site-mobile-nav" className="mobile-nav" hidden={!open} aria-label={label}>
        {items.map((item) => (
          <Link key={item.key} href={item.href} onClick={() => setOpen(false)}>
            {item.label}
          </Link>
        ))}
        <div className="mobile-nav-actions">
          <Link className="btn ghost" href={loginHref} onClick={() => setOpen(false)}>
            {loginLabel}
          </Link>
          <Link className="btn primary" href={startHref} onClick={() => setOpen(false)}>
            {startLabel}
          </Link>
        </div>
      </nav>
    </div>
  );
}
