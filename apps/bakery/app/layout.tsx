import './globals.css';
import '@erp/ui/controls.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ThemeProvider, ThemeScript } from '@erp/ui';
import { SessionProvider } from '@erp/web-core/session';
import { TokenBridge } from '@erp/web-core/token-bridge';

import { AuthGate } from '../components/auth-gate';
import { ServiceWorkerRegister } from '../components/service-worker-register';

export const metadata: Metadata = {
  title: 'المخابز: الإنتاج والتوزيع — Cloud ERP',
  description:
    'واجهة المخابز: دفعة الإنتاج، وحمولة التوزيع، والمناديب، والتحصيل، وإقفال العهدة — كلّها على بيانات منشأتك وصلاحياتها.',
  /**
   * قابليةُ التثبيت على الهاتف (تطبيقُ المندوب `/rep`): ‏`start_url` في الملفّ `/rep`
   * و`display: standalone`. ويُقال صريحًا ما لا يفعله هذا: فالعاملُ يُخزِّن **القشرة** لا
   * المال (`/api/` لا تُمسّ في `public/sw.js`)، والعملُ منقطعًا من طابور IndexedDB.
   */
  manifest: '/manifest.webmanifest',
};

/**
 * 📱 ‏`viewportFit: 'cover'` لتطبيق المندوب المثبَّت على الهاتف: فبلا «cover» لا تصل الصفحةُ
 * إلى حافّة الشاشة ولا تُقرأ `env(safe-area-inset-*)` فتختفي الأزرارُ السفلية خلف شريط
 * النظام. و`themeColor` هو لونُ الـmanifest نفسه (`#b45309`) — والمثبّتةُ تحكم بتطابقهما،
 * فلا لونَ شريطٍ في النظام ولونَ ترويسةٍ في التطبيق.
 *
 * ‏**ولا `maximumScale`**: فمنعُ التكبير قرارُ وصوليةٍ يُتّخذ ضدّ المستخدم، وتكبيرُ الخطّ
 * حقٌّ لا يُسحب لأجل لقطةِ شاشةٍ أنظف.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#b45309',
};

/**
 * الجذر: لا مزوّدَ محليّاً ولا جسرَ إعادة تصدير — الجلسة والجسر من `@erp/web-core` مباشرةً
 * (المرحلة 2 من plan المخابز: الواجهة تستهلك الحزمة المشتركة بلا طبقة وسيطة). و`TokenBridge`
 * بلا `failedRedirect` لأنّ هدف الفشل الافتراضي `/?handoff=failed` صحيحٌ هنا: لا مسار
 * `/login` في هذه الواجهة، فشاشة الدخول ترسمها القشرة على أيّ مسارٍ محميّ.
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <ThemeScript defaultChoice="system" />
      </head>
      <body>
        <ThemeProvider defaultChoice="system">
          <SessionProvider>
            <TokenBridge />
            <ServiceWorkerRegister />
            <AuthGate>{children}</AuthGate>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
