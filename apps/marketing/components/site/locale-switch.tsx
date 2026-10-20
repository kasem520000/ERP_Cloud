'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { dir, localePath, t, type Locale } from '../../lib/i18n';
import { hasEnglishTwin } from '../../lib/site';

/**
 * P-M1 — مبدّل اللغة: **مسارٌ لا كوكي**.
 *
 * الزائر في `/blog/x` يرى زرّاً ينقله إلى `/en/blog/x` (والعكس)، والمقصد يُبنى بـ`localePath`
 * نفسها التي تبني `hreflang` — فما يراه الزائر هو ما يُعلنه الموقع لمحرّك البحث.
 *
 * P-M10 — لا نظيرَ إنجليزيّ لكل صفحة: `/contact` و`/pricing` و`/industries`… عربيّةٌ وحدها
 * (`BILINGUAL_PATHS`). كان الزرّ يبني `/en/contact` فيفتح **404**. الآن يقود إلى نظير الصفحة
 * إن وُجد، وإلا إلى الصفحة الرئيسية في اللغة الأخرى — رابطٌ صادق خيرٌ من رابطٍ ميّت.
 */
export function LocaleSwitch({ locale }: { locale: Locale }) {
  const pathname = usePathname() || '/';
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  const base = locale === 'en' ? (pathname === '/en' ? '/' : pathname.replace(/^\/en/, '') || '/') : pathname;
  const twin = hasEnglishTwin(base);
  const href = twin ? localePath(base, other) : localePath('/', other);
  const label = t(locale, 'lang.switch');
  return (
    <Link
      className="lang-switch"
      href={href}
      hrefLang={other}
      dir={dir(other)}
      title={twin ? undefined : other === 'en' ? 'English home — this page is not translated yet' : 'الصفحة الرئيسية العربية — هذه الصفحة غير مترجمة بعد'}
    >
      {label}
    </Link>
  );
}
