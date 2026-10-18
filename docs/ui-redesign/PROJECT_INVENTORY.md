# جرد المشروع — 2026-10-18

## حدود النطاق المكتشف

بدأ العمل من `git status` نظيف على `arena/9aaa0e3e-erp-cloud`. المساحة أحادية المستودع pnpm/Next 15/React 19: **5 واجهات ويب** (staff، bakery، platform-admin، marketing، customer-portal)، و`apps/api` (NestJS) و`apps/migrator` (CLI) بلا صفحات ويب. الحزم ذات الصلة: `packages/ui` للمكونات والرموز، `packages/web-core` للجلسات وi18n وAPI، `packages/web-van` للمناديب؛ والبقية عقود وبيانات وتكوين واختبارات.

مسح `apps/*/app/**/{page,not-found}.{ts,tsx,js,jsx}`: **296 page.tsx + صفحتي 404 مخصصتين = 298 مدخلاً**: staff 201 (200 صفحة + 404)، bakery 11، platform-admin 38، marketing 37 (36 + 404)، customer-portal 11. القائمة المفصلة بالمصادر والمسارات والديناميكية في `SCREEN_REGISTRY.md`. ملفات `layout.tsx` الجذرية عددها 5؛ لا ينبغي احتسابها كشاشات مستقلة. المسارات `(group)` لا تدخل URL؛ `[id]`/`[slug]` مسارات قوالب وليست سجل بيانات واحد؛ `/` في البوابة يعيد التوجيه إلى `/portal`. تُطلب صفحات فواتير وتذاكر ومستخدمين ومستأجرين من روابط داخلية، لا من القائمة دائماً.

## الخريطة التقنية

| السطح | القشرة/التنقل | النمط الحالي | الاختبار والتشغيل |
| --- | --- | --- | --- |
| staff | `components/app-shell.tsx`, `auth-gate.tsx`, `login-screen.tsx`, `lib/navigation.ts`, حارس صلاحيات | `app/globals.css` (~2085 سطر) فوق `@erp/ui/tokens.css` + `@erp/ui` + تنسيق شاشة محلي | `pnpm --filter @erp/staff dev`, Vitest؛ يتطلب API وجلسة وأذونات/رخص وحدات وبيانات تجريبية |
| bakery | `components/auth-gate.tsx`, `login-screen.tsx`, `app/page.tsx` وقشرة محلية | `globals.css` (~539 سطر) فوق الرموز، `@erp/ui` و`@erp/web-van` | dev + API وجلسة ورخصة bakery_distribution |
| platform-admin | `components/auth-gate.tsx`, `components/screen.tsx`, `components/ui.tsx` | `globals.css` (~424 سطر) فوق الرموز، dark-first | dev + API وجلسة مشغل منصة |
| marketing | `components/site/shell.tsx`, `lib/navigation.ts`, middleware | `globals.css` (~1976 سطر) فوق الرموز؛ كانت تفتقد PostCSS رغم استيراد Tailwind، وصُحح ذلك في هذه الدفعة مع `@source`؛ محتوى `/public/site` من API مع fallback | dev، مسارات عربية و`/en/*` محدودة، صفحات ديناميكية من المحتوى |
| customer-portal | `components/portal-shell.tsx`, `components/forms.tsx`, `lib/navigation.ts` | **نظام موازٍ** في `globals.css` (~311 سطر) بألوان وخط منفصلين | dev + API وحساب عميل صادر من مستأجر؛ فواتير/دفع تحتاج بيانات اختبار |

يوجد kit فعلي مسبقاً، لا داعي لإعادة اختراعه: `packages/ui/src/components/{button,input,card,data-table,modal,tabs,toast,...}`, `tokens/tokens.css`, `theme/*`؛ `ThemeScript/Provider` مثبتان في 4 أسطح، لكن البوابة لا تستهلك الحزمة. CSS الخاص بالتطبيقات طويل ويتضمن قواعد للشاشات القديمة، وتوجد قيم inline وثوابت مباشرة وأغلفة مكونات خاصة في `apps/staff/components/ui*`, `apps/platform-admin/components/ui*`, `apps/marketing/components/{card,table,badge}`. بعض الفواتير والجداول تعيش داخل ملفات الصفحات لا في ملفات منفصلة. الاستيراد `@source '../../../packages/ui/src'` مهم لتوليد أصناف Tailwind v4. وضع RTL في جذور التطبيقات؛ marketing يشتق اللغة من المسار، staff من `@erp/web-core/i18n`، البقية عربية أولاً.

## مخاطر وحالات غير ممثلة بمسار مستقل

`AuthGate`, loading/error/forbidden/empty، قوائم filter وdropdown، print sheets، dialogs وforms متعددة الخطوات، staff POS offline، النوافذ الداخلية في invoice-editor، وسلوك PWA ليست مسارات منفصلة: يجب عمل مصفوفة حالات لكل شاشة قبل اعتبارها DONE. معلومات route وحدها لا تثبت صلاحية روابط داخلية أو الوصول إلى بيانات `[id]`. توفّر Chromium مؤقتاً وفُتحت الصفحات العامة وبوابات الدخول كما في TEST_REPORT؛ المحتوى المحمي يظل غير مثبت إلى حين توفر API/بيانات اعتماد تجريبية. لا تستخدم عمليات مالية إنتاجية. `README` الخاصة بكل تطبيق والحزم، وأوامر الجذر `pnpm test/typecheck/build` هي مداخل التشغيل؛ ملفات Next `next.config.mjs` تعيد توجيه `/api/v1/*` إلى backend.
