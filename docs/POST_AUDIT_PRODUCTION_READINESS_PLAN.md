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
| **المرحلة 4** | **(البندان 8، 9):** الفحص الشامل لكل الشاشات في `staff` و`bakery` و`platform-admin` و`marketing` و`customer-portal` + التحقق الحيّ من عزل الإشعارات بين الإدارة والمناديب + اكتشاف وإصلاح أي مشاكل إضافية | 🔄 **قيد التنفيذ** |
| **المرحلة 5** | **(البند 10):** تجهيز بيئة الإنتاج والنشر على `VPS` وتوليد متغيرات `sahabaccounting.com` في `.env` و`setup-env.mjs` وإعدادات النطاقات الفرعية والـ Reverse Proxy | ⏳ مخطط |

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


