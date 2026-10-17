import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const source = (name: string) => new URL(`../${name}`, import.meta.url);

/**
 * 📱 سطحُ PWA لتطبيق المندوب — على نمط `apps/staff/tests/offline-pos.spec.ts` (فحصُ
 * الـmanifest والعامل بالشاشة التي تفتحه)، وبأحكامٍ تقول **ما لا يفعله** العامل أيضًا:
 * فالقشرةُ تُخزَّن والمالُ لا يُخزَّن.
 */
describe('rep PWA surface (bakery)', () => {
  it('manifest قابلٌ للتثبيت ويفتح على شاشة المندوب', async () => {
    const manifest = JSON.parse(
      await readFile(source('public/manifest.webmanifest'), 'utf8'),
    ) as {
      start_url: string;
      display: string;
      scope: string;
      lang: string;
      dir: string;
      icons: unknown[];
    };
    expect(manifest.start_url).toBe('/rep');
    expect(manifest.display).toBe('standalone');
    // ‏و`scope: '/'` لا `/rep`: فأصولُ `/_next/` خارج `/rep`، ونطاقٌ أضيق كان يمنع
    // ‏العاملَ من اعتراضها فتسقط القشرةُ بلا شبكة.
    expect(manifest.scope).toBe('/');
    expect(manifest.lang).toBe('ar');
    expect(manifest.dir).toBe('rtl');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it('العاملُ يُخزِّن القشرة ويُسقط إلى `/rep` — و`/api/` لا تُمسّ', async () => {
    const worker = await readFile(source('public/sw.js'), 'utf8');
    expect(worker).toContain("request.mode === 'navigate'");
    expect(worker).toContain("caches.match('/rep')");
    expect(worker).toContain("const APP_SHELL = ['/rep', '/manifest.webmanifest', '/icon.svg']");
    /**
     * ‏**الحكمُ الأهمّ**: المالُ لا يُخزَّن. فقراءةٌ مخزّنة من عامل الخدمة تعني عرضَ
     * عهدةٍ أو إيرادٍ قديم بعنوان «الآن»، وهذا أخطرُ من عدم العمل بلا شبكة — والعملُ
     * منقطعًا مصدرُه طابورُ IndexedDB لا كاش العامل.
     */
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    // ‏والخروجُ المبكر عن `/api/` **قبل** أيّ `respondWith`: فلو جاء بعده لكان الحظرُ زينة.
    expect(worker.indexOf("url.pathname.startsWith('/api/')")).toBeLessThan(worker.indexOf('event.respondWith'));
    // ‏وكاشُ المخابز منفصلٌ عن كاش الطاقم: فاسمٌ مشتركٌ يعني أن يمسح أحدهما قشرةَ الآخر.
    /**
     * ‏والحكمُ على **شكل السطر البرمجيّ** لا على النصّ المجرّد: فشرحُ العامل يذكر اسمَ كاش
     * الطاقم نفيًا («لا اسمَ مشترك»)، وحكمٌ نصيٌّ كان سيسقط على تعليقٍ يقول عكسَ ما
     * يُتَّهم به — وهو الخطأُ نفسه الذي وقع في مثبّتة `van-queue-store` وصُحِّح هناك.
     */
    expect(worker).toContain("const CACHE_NAME = 'erpcloud-bakery-shell-v1';");
    expect(worker).not.toContain("const CACHE_NAME = 'erpcloud-staff-shell");
    // ‏ولا معالجَ دفعٍ (web push): فلا خادمَ يدفع، ومستمعٌ لا يُستدعى أبدًا كذبٌ في الملفّ.
    expect(worker).not.toContain("addEventListener('push'");
  });

  it('التسجيلُ لا يجعل الوضعَ دون اتصال اعتمادًا صلبًا، والجذرُ يعلن الـmanifest', async () => {
    const register = await readFile(source('components/service-worker-register.tsx'), 'utf8');
    expect(register).toContain("navigator.serviceWorker.register('/sw.js', { scope: '/' })");
    // ‏والفشلُ يُبتلع عمدًا: فمن بلا `serviceWorker` يبقى يعمل متصلًا ومنقطعًا بالطابور.
    expect(register).toContain('.catch(() => undefined)');
    expect(register).toContain("if (!('serviceWorker' in navigator)) return;");

    const layout = await readFile(source('app/layout.tsx'), 'utf8');
    expect(layout).toContain("manifest: '/manifest.webmanifest'");
    expect(layout).toContain('<ServiceWorkerRegister />');
  });

  it('شاشةُ المندوب تقرأ حالةَ الشبكة وتستعمل الطابور — لا العامل وحده', async () => {
    const page = await readFile(source('app/rep/page.tsx'), 'utf8');
    // ‏حالةُ الشبكة من المتصفّح، والطابورُ من `@erp/web-core/offline-db`.
    expect(page).toContain('navigator.onLine');
    expect(page).toContain("window.addEventListener('offline'");
    expect(page).toContain('enqueueVanOperation');
    expect(page).toContain('syncPlan');
    // ‏والإقفالُ والاستلامُ لا يُحفظان: فالحظرُ من `queueVerdict` لا من اختفاء الزرّ.
    expect(page).toContain('queueVerdict');
    expect(page).toContain('NOT_QUEUEABLE_OPERATIONS.closing.reasonAr');
    // ‏ومسحُ التخزين يقرأ النتيجةَ ولا يفترض أنّها تمّت.
    expect(page).toContain('result.cleared');
  });
});
