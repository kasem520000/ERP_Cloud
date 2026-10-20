/**
 * 📱 عاملُ خدمة تطبيق المندوب — يُخزِّن **القشرة** فقط، ولا يُخزِّن مالًا.
 *
 * والقاعدةُ التي بُني عليها: ‏`/api/` **لا تُمسّ** (أدناه خروجٌ مبكّر). فأرقامُ العهدة
 * والإيراد والذمم تُقرأ من الخادم حيّةً (`GET /van-sales/me`)، وقراءةٌ مخزّنةٌ من عاملِ
 * الخدمة تعني عرضَ مالٍ قديم بعنوان «الآن» — وهذا أخطرُ من عدم العمل بلا شبكة. وأمّا
 * العملُ منقطعًا فمصدرُه طابورُ IndexedDB (`vanQueue` في `@erp/web-core/offline-db`):
 * تُحفظ النيّةُ بمفتاح عدم تكرارها وتُعاد إلى مسارها الرسميّ عند العودة، والخادمُ هو
 * السلطةُ بعدها. فالعاملُ هنا يجعل **الشاشةَ** تُفتح بلا شبكة، لا **الأرقام**.
 *
 * والاسمُ `erpcloud-bakery-shell-v1` منفصلٌ عن `erpcloud-staff-shell-v2` (عاملُ الطاقم):
 * فكاشان باسمٍ واحد بين تطبيقين يعني أن يمسح أحدهما قشرةَ الآخر عند التفعيل.
 */
const CACHE_NAME = 'erpcloud-bakery-shell-v1';
const APP_SHELL = ['/rep', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          APP_SHELL.map((path) =>
            fetch(path)
              .then((response) => (response.ok ? cache.put(path, response) : undefined))
              .catch(() => undefined),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // ‏ولا أصلٌ آخر ولا API: فلا قراءةَ مالٍ من الكاش، ولا طلبَ كتابةٍ يُبتلع.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        // ‏وبلا شبكة: القشرةُ المخزّنة، وإلا شاشةُ المندوب نفسها — فلا صفحةَ خطأٍ بيضاء
        // ‏لمندوبٍ في قبوٍ بلا تغطية.
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/rep'))),
    );
    return;
  }

  if (request.method === 'GET' && (url.pathname.startsWith('/_next/') || APP_SHELL.includes(url.pathname))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
