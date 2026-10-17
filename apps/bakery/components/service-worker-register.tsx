'use client';

import { useEffect } from 'react';

/**
 * تسجيلُ عاملِ خدمة تطبيق المندوب — على نمط `apps/staff/components/service-worker-register.tsx`
 * (نسخةٌ لا استيراد: فالتطبيقان حزمَتا Next منفصلتان ولا حزمةَ مشتركةً لمكوّنات React،
 * والتسجيلُ ثلاثةُ أسطر). والفشلُ **لا يُعطل الشاشة**: فمن لا يدعم المتصفّحُ فيه
 * `serviceWorker` (أو رفض التسجيل) يبقى يعمل متصلًا ومنقطعًا بطابور IndexedDB — فالعاملُ
 * يضيف فتحَ القشرة بلا شبكة، لا قدرةَ الحفظ.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}
