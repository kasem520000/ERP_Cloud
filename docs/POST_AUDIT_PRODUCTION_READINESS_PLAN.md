# خطة التنفيذ المرحلية للإصلاحات الشاملة وتجهيز الإنتاج (`sahabaccounting.com`)

- **الفرع النشط:** `arena/4c98c7f3-erp-cloud`
- **الالتزام الأساسي المرفوع مسبقاً:** `6f5115e` (`origin/arena/4c98c7f3-erp-cloud` — يضم جميع إصلاحات مطابقة הـ `261` بطاقة + `ACC-061` + `ACC-139`)

---

## جدول المراحل وحالة التقدّم

| المرحلة | النطاق والبنود المشمولة | الحالة |
|---|---|---|
| **المرحلة 0** | رفع وحفظ جميع الإصلاحات المحاسبية السابقة إلى `origin/arena/4c98c7f3-erp-cloud` (`6f5115e`) | ✅ **مكتمل** |
| **المرحلة 1** | **(البنود 1، 2، 6، 7):** بطاقة المجموعة الضريبية في `المستودعات -> التعاريف` (`15%` و`0%`) + التوليد التلقائي الكامل للمنشآت الجديدة (الحسابات، `مجموعة عامة`، الضرائب، الوحدات الأساسية، الفرع، المستودع، الخزينة، السنة والفترات المالية، الصلاحيات) + تفعيل التسجيل الذاتي من `apps/marketing` وإصلاح خطأ `الطلب غير صحيح` عند إنشاء المعاملات في الحسابات الجديدة | ✅ **مكتمل** |
| **المرحلة 2** | **(البندان 3، 4):** إصلاح الحفظ وعرض المفاتيح المخزنة في `/settings/general` + إزالة جميع إشارات الديسكتوب وأسماء نوافذ `frm*` من الواجهات والتقارير + تعريب الصلاحيات ورسائل الرفض بالكامل | ✅ **مكتمل** |
| **المرحلة 3** | **(البند 5):** لوحة تحكم المنصة (`apps/platform-admin`): إصلاح زر `افتح` في سجل المشاكل + إصلاح صحة النظام للبريد (`Resend` من قاعدة البيانات بدل `console`) والعامل (`Worker`) + إصلاح صفحة البيانات والاسترجاع (إلغاء وهمية Google Drive وتمكين رفع واستيراد وتنزيل واستعادة النسخ الاحتياطية فعلياً) | ✅ **مكتمل** |
| **المرحلة 4** | **(البندان 8، 9):** الفحص الشامل والحيّ لكل الشاشات في `staff` و`bakery` و`platform-admin` و`marketing` و`customer-portal` + التحقق الحيّ والبصري من عزل الإشعارات بين الإدارة والمناديب + اكتشاف وإصلاح العيوب الخفية (`500 -> 422` في إنشاء المنشآت والجهات والفواتير + تحسينات العرض على الجوال) | ✅ **مكتمل** |
| **المرحلة 5** | **(البند 10):** تجهيز بيئة الإنتاج والنشر على `VPS` وتوليد متغيرات `sahabaccounting.com` في `.env` و`setup-env.mjs` و`check-env.mjs` وإعدادات النطاقات الفرعية وNginx وPM2 | ✅ **مكتمل** |

---

## سجل الإنجاز التفصيلي حسب المراحل

### المرحلة 1 — مكتملة (`Items 1, 2, 6, 7`)
1. **البند 1 — بطاقة مجموعة ضريبية (`المستودعات -> التعاريف`):**
   - إضافة شاشة `/inventory/tax-groups` في `apps/staff/app/inventory/tax-groups/page.tsx` وإدراجها في القائمة الجانبية (`apps/staff/lib/navigation.ts` ضمن `المستودعات -> التعاريف`).
   - دعم الإنشاء والتعديل والحذف المحمي (`DELETE /organization/catalog/tax-groups/:id` يرفض الحذف عند الارتباط بأصناف أو فواتير برمز `TAX_GROUP_IN_USE`).
   - ضبط المجموعتين الافتراضيتين: **«ضريبة القيمة المضافة» (`15%`)** و**«ضريبة صفرية» (`0%`)**.
2. **البند 2 والبند 7 — التوليد التلقائي الكامل للمنشآت الجديدة وإصلاح `الطلب غير صحيح`:**
   - **السبب الجذري لخطأ `الطلب غير صحيح` (البند 7):** كانت المنشآت الجديدة المُنشأة عبر لوحة المنصة أو التسجيل الذاتي تُنشأ بدون سنة مالية وفترات محاسبية (`fiscal_years` / `fiscal_periods`) وبدون تصنيف أصناف أو وحدات قياس، وعند محاولة ترحيل أي معاملة كان المحرّك يرمي `FISCAL_PERIOD_NOT_FOUND` بحالة `HTTP 400` غير معرَّبة في `errors-ar.ts` فتظهر للمستخدم عبارة `الطلب غير صحيح.`.
   - **الإصلاح:** ترقية `OrgProvisioningService.provisionOrgDefaults` بخيار `seedStarterData: true` وربطه بجميع منافذ إنشاء المنشآت (`POST /platform/tenants`، `POST /signup`، تحويل العملاء المتوقعين `leads`، وإنشاء ملفات الشركات `company-files`) ليولّد تلقائياً:
     - دليل الحسابات الكامل (`118` حساباً) + ملف الترحيل المحاسبي (`branch_posting_profiles`).
     - مجموعة أصناف واحدة فقط باسم **`مجموعة عامة`** (`GEN`).
     - المجموعتين الضريبيتين **`ضريبة القيمة المضافة` (`15%`)** و**`ضريبة صفرية` (`0%`)**.
     - الوحدات الأساسية (`حبة`، `كرتون`، `علبة`، `كيلوجرام`، `لتر`، `متر`).
     - السنة المالية الحالية المفتوحة + `12` فترة شهرية مفتوحة + طرق الدفع الأساسية + إعدادات المنشأة الافتراضية + الفرع والمستودع والصندوق الرئيسي.
   - إضافة الهجرة `0154_tax_groups_and_tenant_provisioning_backfill.sql` لاستكمال بيانات أي منشأة أُنشئت مسبقاً على الخادم بلا فترات مالية أو تصنيف أو وحدات أو ضرائب.
   - إضافة `FISCAL_PERIOD_NOT_FOUND` و`TAX_GROUP_RATE_LOCKED` و`TAX_GROUP_IN_USE` إلى `packages/contracts/src/errors-ar.ts`.
3. **البند 6 — تفعيل التسجيل الذاتي من `apps/marketing`:**
   - إضافة مفتاح إعدادات المنصة الحيّ `platform.self_signup` (`defaultValue: true`) في `@erp/contracts` وقراءته في `SignupService.isSelfSignupEnabled` بحيث يعمل التسجيل الذاتي فوراً ويمكن التحكم به من لوحة تحكم المنصة `/settings` دون الحاجة لتعديل `.env` يدوياً، مع تصحيح `DEPLOYMENT_VPS_AR.md` إلى `SIGNUP_ENABLED=true` وإضافة مسار `/signup` في `apps/marketing`.
   - **الاختبارات الآلية المجتازة:** `164 / 164` اختبار `vitest` ناجح (`organization-provisioning.spec.ts`، `signup-flow.spec.ts`، `platform-console-rbac.spec.ts`، `sales-posting.spec.ts`، `seed-demo.spec.ts`، وجميع اختبارات `apps/marketing`).

### المرحلة 2 — مكتملة (`Items 3, 4` + إصلاح روابط محاسبة المخابز)
1. **البند 3 — إصلاح شاشة `/settings/general` (`apps/staff/app/settings/general/page.tsx`):**
   - **السبب الجذري:** تُرجع نقطة `GET /api/v1/settings` الهيكل `{ data: { settings: TenantSettingsMap, registry: [...] } }`، بينما كانت الصفحة تعامل الكائن المغلّف `{ settings, registry }` كأنه خريطة الإعدادات المسطّحة مباشرةً؛ ما أدّى إلى:
     1. ظهور صف مشوّه بعنوان `settingssettings` وقيمة JSON خام `{"allow_negative_stock":false,...}` في جدول «كل المفاتيح المخزنة».
     2. قراءة جميع الحقول بقيمة `undefined` ومسح القيم عند التحديث، وإرسال `""` و`0` لحقول الترقيم التي تشترط `.min(1)` فيفشل الحفظ بـ `400 VALIDATION_FAILED`.
   - **الإصلاح:** إضافة `extractEffectiveSettings` لفك تغليف `{ settings, registry }` بأمان، وإضافة قسم مستقل لتحرير وحفظ «السياسات المحاسبية والمخزنية والضريبية» بجانب «ترقيم المستندات» و«إعدادات الكاشير والمبيعات»، والتحقق المسبق من القيم قبل `PUT /settings/:key` مع `await settings.reload()`، وعرض التسميات العربية النظيفة لجميع المفاتيح المخزنة دون رموز إنجليزية خام.
2. **البند 4 — إزالة إشارات الديسكتوب وأسماء نوافذ `frm*` وتعريب الصلاحيات والأدوار بالكامل:**
   - إزالة جميع الإشارات المرئية إلى `الديسكتوب` / `النسخة المكتبية` / `النافذة المكتبية` وأسماء شاشات `frm*` و`.xaml` من واجهات `apps/staff` (`21` ملف شاشة ومكوّن + `apps/staff/lib/navigation.ts` + `packages/ui/src/design/gallery.tsx`) ومن أوصاف التقارير `hintAr` / `emptyAr` في `apps/api/src/modules/reporting/report-catalog.ts` (`26` موضعاً).
   - تعريب أسماء الأدوار النظامية (`Owner` / `Accountant` / `Cashier`) في `/settings/users`، واستكمال تعريب جميع صلاحيات لوحة المنصة (`29 / 29` بما فيها `console.releases.view` و`console.releases.manage`) وإزالة الرموز الإنجليزية من `/roles` وتوطين رسائل الرفض `403` في `apps/platform-admin/lib/api.ts` و`packages/web-core/src/api.ts`.
   - تعريب جميع رسائل الصلاحيات وحواجز الوصول وأوصاف الوحدات في `apps/bakery` (`apps/bakery/lib/permissions-ar.ts`، `rep-queue.ts`، `reps-screen.ts`، `sales-screen.ts`، `navigation.ts`، `reps/page.tsx`، `accounting/page.tsx`، `treasury/page.tsx`) + استكمال مسارات التسليم المحاسبية الـ5 في `apps/bakery/lib/staff-handoff.ts`.
   - **الاختبارات الآلية المجتازة:** `445 / 445` اختبار وحدة ناجح (`@erp/staff` `104/104` بما فيها `general-settings.spec.ts` لفحص خلو الواجهات من `frm*`/`الديسكتوب` وتعريب كل الصلاحيات، `@erp/bakery` `259/259`، `@erp/platform-admin` `27/27`، `@erp/web-core` `55/55`، و`settings.spec.ts` `7/7`) + `0` أخطاء `tsc` عبر الحزم الأربع.

### المرحلة 3 — مكتملة (`Item 5`: لوحة تحكم المنصة `apps/platform-admin`)
1. **البند 5A — سجل المشاكل (`سجل المشاكل` — `/problems`):**
   - التحقق من خلو `notifications.service.ts` تماماً من استعلام `s.deleted_at` القديم على جدول `salesmen`.
   - **السبب الجذري لعدم استجابة زر «افتح»:** كانت صفوف `server` تشير إلى `/problems?filter[source]=server` (نفس الصفحة الحالية دون تزامن مع `useSearchParams` أو نافذة تفاصيل)، فتضغط «افتح» ولا يحدث شيء.
   - **الإصلاح:** إضافة نقاط `GET /platform/problems/server/:id` و`DELETE /platform/problems/server/:id` و`DELETE /platform/problems/server`، وتحديث `apps/platform-admin/app/problems/page.tsx` بحيث يفتح زر **«افتح»** نافذة تشخيصية كاملة تعرض المسار، طريقة الطلب، رمز الاستجابة، بصمة التتبّع، المكدّس الكامل (`stack`/`meta`)، زر نسخ التقرير، زر حذف السجل بعد المعالجة، ورابط انتقال مباشر لشاشة الإصلاح لكل مصدر (`email` · `einvoice` · `webhook` · `outbox` · `backup`).
2. **البند 5B — صحة النظام (`صحة النظام` — `/health`):**
   - **السبب الجذري:** كانت `PlatformOperationsService.probeEmail()` تقرأ `platform_settings` (`key = 'email.provider'`) وتجهل جدول `email_settings` الفعلي الذي تحفظ فيه شاشة `/email` إعدادات `Resend` ومفتاح `api_key_enc` المشفّر! كما كان الخادم الرئيسي لا يشغّل `WorkerRunner` المدمج لتصريف `outbox_jobs`، فيظهر `العامل: غير مهيّأ` و`البريد: متدهوّر — المزوّد console`.
   - **الإصلاح:** تحديث `probeEmail()` لقراءة `email_settings` (`tenant_id IS NULL`) وفك تشفير `api_key_enc` عبر `openSecret` لاعتماد `resend` و`smtp` و`http` بحالة **`سليم (up)`** عند اكتمال اعتماداتها، وتشغيل `WorkerRunner` مدمجاً تلقائياً داخل `bootstrap()` (`EMBEDDED_WORKER` مفعّل افتراضياً خارج الاختبارات) مع تسجيل نبض العامل في `platform_settings` (`worker.heartbeat`) وقراءته في `workerHeartbeat()`، وتوطين رموز الصلاحيات في `health/page.tsx`.
3. **البند 5C — البيانات والاسترجاع (`صفحة البيانات والاسترجاع` — `/backups`):**
   - استبدال المحاكي الوهمي `GoogleDriveSimulator` (`backup@erp-cloud.local` في الذاكرة) بمنفذ `GoogleDriveRestPort` الفعلي المتصل بـ `oauth2.googleapis.com` و`Google Drive REST API v3` مع حفظ الاعتمادات مشفّرة بـ`AES-256-GCM` في `platform_settings` (`backups.google_drive`) أو قراءتها من `GOOGLE_DRIVE_*` في البيئة، وإظهار حالة `غير مهيّأ بعد` بصدق عند غياب الاعتمادات، وإصلاح مسار الاستعادة من جوجل درايف ليستورد النسخة ويطبّق محرك الاستعادة الحقيقي بدل استعلام SQL المعطوب سابقاً.
   - إضافة نقطة `POST /platform/backups/import` بالتدفق الثنائي المباشر (`application/octet-stream` حتى `MAX_DUMP_BYTES` دون التقيّد بحد 1MB لمحلل JSON) مع دعم الملفات الخام `.ndjson` والمضغوطة `.gz` والمشفّرة `.enc` والتحقق الكامل عبر `parseDump` وحفظها مشفّرة في مخزن النسخ، وإضافة لوحة **«رفع واستيراد نسخة احتياطية»** في `/backups` مع زر **«رفع ومعاينة الاستعادة فوراً»**.
   - **الاختبارات الآلية المجتازة:** `78 / 78` اختبار ناجح (`platform-backups.spec.ts` `30/30`، `platform-operations.spec.ts` `13/13`، `permission-codes.spec.ts` `5/5`، `platform-problems.spec.ts` `3/3`، و`@erp/platform-admin` `27/27`) + `0` أخطاء `tsc`.

### المرحلة 4 — مكتملة (`Items 8, 9`: الفحص الحيّ والبصري الشامل وعزل الإشعارات وتحصين الأعطال الخفية)
1. **البند 8 — عزل الإشعارات بين الإدارة والمناديب وتدقيق تطبيق المخابز (`apps/bakery`):**
   - فرض عزل صارم ثنائي الاتجاه في `NotificationsService` (`apps/api/src/modules/platform-services/notifications/notifications.service.ts`) و`VanSalesService.myWorkspace` (`GET /van-sales/me`) و`AnnouncementsService`:
     - **الإدارة والمحاسبون (غير المناديب المحصورين):** لا تُعرض لهم إشعارات `audience: 'rep'` أو `van_sales_supply_pending_receipt` أو `van_sales_closing_approved` مطلقاً حتى لو اشتركوا في نفس العضوية أثناء الاختبار أو تعددت أدوارهم.
     - **المناديب المحصورون (`rep-scoped`):** لا تُعرض لهم إشعارات الإدارة (`audience: 'management'` أو `van_sales_closing_request`) ولا تعميمات الإدارة الداخلية، ويرون فقط إشعارات عهدتهم وأوامر التحميل الخاصة بهم.
   - إضافة مكوّن جرس الإشعارات المخصّص **`BakeryNotificationBell`** (`apps/bakery/components/notification-bell.tsx`) وربطه في ترويسة `BakeryGuard` لكلٍّ من شاشات الإدارة وشاشة المندوب المحمولة `/rep` (مع التمركز التلقائي النظيف `fixed inset-x-3` على شاشات الهواتف `390px` دون أي قصّ جانبي).
   - إزالة جميع الإشارات التقنية الداخلية في واجهة المخابز (`apps/staff`، `POST /salesmen/:id/account`، `VAN-`، `van_sales.*`، `sales.*`) واستبدالها بصياغة عربية واضحة للمستخدم النهائي.
2. **البند 9 — الاكتشاف الاستباقي للأخطاء الخفية وتحصين الخادم والواجهات:**
   - **إصلاح خطأ Next.js 15 App Router في `apps/staff/app/settings/general`:** فصل الدالة المساعدة `extractEffectiveSettings` إلى `settings-helpers.ts` لضمان نجاح البناء الإنتاجي الكامل `next build` عبر جميع التطبيقات الخمسة دون أخطاء تصدير.
   - **تحصين `PlatformAdminService.provisionTenant` (`POST /platform/tenants`):** التحقق المسبق الصارم من `code` و`name` و`ownerEmail` و`ownerFullName` وإرجاع `422 VALIDATION_FAILED` واضحة بدلاً من `500 INTERNAL` عند غياب أو تشوّه الحقول.
   - **تحصين `PartiesService.create` (`POST /parties`):** قبول `name` أو الاسم البديل `nameAr` ورفض الأسماء الفارغة بـ `422 VALIDATION_FAILED` بدلاً من خطأ قاعدة البيانات `NOT NULL` (`500 INTERNAL`).
   - **تحصين `PurchasesService.create` و`SalesService.createInTx`:** استنتاج `branchId` تلقائياً من المستودع المختار (`warehouses.branch_id`) أو من الفرع الافتراضي للمنشأة عند عدم تمريره، وقبول `supplierId` / `customerId` كمرادفات آمنة لـ `partyId`، وإرجاع `422` بدلاً من `500 INTERNAL` مع الحفاظ الكامل على فحص `SALES_WAREHOUSE_REQUIRED` عند الترحيل.
   - **تحسين شبكة مجسّات صحة النظام (`/health`):** تحويل شريط المجسّات المضغوط إلى شبكة بطاقات متجاوبة من 4 أعمدة (`sm:grid-cols-2 lg:grid-cols-4`) تمنع تداخل العناوين العربية الطويلة.
3. **نتائج الفحص الحيّ والبصري والمحاسبي الشامل:**
   - **بناء الإنتاج الكامل (`NODE_ENV=production`):** نجاح بناء `@erp/api` وجميع تطبيقات الويب الخمسة (`staff:3001`، `marketing:3002`، `platform-admin:3003`، `customer-portal:3004`، `bakery:3005`) بـ **`0` أخطاء**.
   - **المطابقة المحاسبية الشاملة (`pnpm verify-seed -- --reset`):** **`28 / 28 PASS`** على الخادم الحيّ.
   - **جناح التحقق البصري والحيّ بمتصفح Chromium الحقيقي:** **`19 / 19 PASS`** (`pageErrors = 0` في جميع الشاشات التسع المفحوصة بصرياً، وتوازن ميزان المراجعة لمنشأة جديدة بالكامل: `مدين = 905.00 / دائن = 905.00`).
   - **الاختبارات الآلية المجتازة للمرحلة 4:** `286 / 286` اختبار وحدة وتكامل ناجح (`@erp/bakery` `259/259` + `notifications.spec.ts` `6/6` + اختبارات `van-sales` `21/21`).

### المرحلة 5 — مكتملة (`Item 10`: جاهزية الإنتاج والنشر على VPS لنطاق `sahabaccounting.com`)
1. **توليد ملف `.env` الإنتاجي القياسي (`scripts/setup-env.mjs` و`.env.example` و`deploy/.env.example`):**
   - تحديث `scripts/setup-env.mjs` و`.env.example` و`deploy/.env.example` لتوليد عناوين الإنتاج المعتمدة افتراضياً:
     - `PUBLIC_APP_URL=https://sahabaccounting.com`
     - `NEXT_PUBLIC_STAFF_URL=https://staff.sahabaccounting.com`
     - `NEXT_PUBLIC_PORTAL_URL=https://portal.sahabaccounting.com`
     - `NEXT_PUBLIC_PLATFORM_URL=https://admin.sahabaccounting.com`
     - `NEXT_PUBLIC_MARKETING_URL=https://sahabaccounting.com`
     - `NEXT_PUBLIC_BAKERY_URL=https://bakery.sahabaccounting.com`
     - `NEXT_PUBLIC_SUPPORT_EMAIL=support@sahabaccounting.com`
   - إضافة وضع التطوير المحلي الاختياري `node scripts/setup-env.mjs --local` عند الرغبة في روابط `localhost` أثناء التطوير، مع إبقاء `pnpm env:setup` يولّد روابط `sahabaccounting.com` مباشرةً.
   - ترقية `scripts/check-env.mjs` للتحقق الصارم من جميع عناوين الواجهات الـ6 وبريد الدعم عند `NODE_ENV=production`.
2. **تحديث قوالب VPS (Nginx + PM2 + التوثيق العربي):**
   - تحديث `deploy/vps/nginx-erpcloud.conf`: توجيه النطاقات الـ6 (`sahabaccounting.com`، `www`، `staff`، `admin`، `portal`، `bakery`، `api`) مع رفع `client_max_body_size` إلى `70m` على مسار `/api/v1/platform/backups/import` لدعم استيراد النسخ الاحتياطية المشفّرة عبر المتصفح.
   - تحديث `deploy/vps/ecosystem.config.cjs`: ضبط `EMBEDDED_WORKER: '0'` لعملية `erp-api` عند تشغيل عملية `erp-worker` المستقلة لمنع ازدواج مستهلكي الطوابير، مع تمرير جميع عناوين `sahabaccounting.com` الموحّدة.
   - تحديث `apps/marketing/lib/surfaces.ts` و`docs/DEPLOYMENT_VPS_AR.md` بالكامل لمطابقة النطاق المعتمد `sahabaccounting.com`.
   - **الاختبارات الآلية المجتازة للمرحلة 5:** `52 / 52` اختبار ناجح (`@erp/config` `32/32` بما فيها `deployment-surface.spec.ts` `16/16`، و`deployment-artifacts.spec.ts` `20/20`).



