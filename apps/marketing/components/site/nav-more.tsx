'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export type SiteItem = { key: string; href: string; label: string };

/**
 * «المزيد» في ترويسة الموقع.
 *
 * تسعةُ روابط لا تسع صفًّا واحدًا داخل عرض 1180px: كان الشريط يلتفّ إلى صفٍّ
 * ثانٍ نصفِ فارغ، أو يتجاوز صندوقه فيغطّي الشعار. هنا تبقى الروابط الخمسة
 * الأساسية في الصف، وتنتقل الثانوية إلى قائمةٍ منسدلة — لا رابط يُحذف.
 */
export function NavMore({ items, label }: { items: SiteItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="nav-more" ref={ref}>
      <button
        type="button"
        className="nav-more-btn"
        aria-expanded={open}
        aria-controls="nav-more-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div id="nav-more-panel" className="nav-more-panel" hidden={!open}>
        {items.map((item) => (
          <Link key={item.key} href={item.href} onClick={() => setOpen(false)}>
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
