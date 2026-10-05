# مطالبة إصلاح شاملة — مشروع ERP Cloud

> **الغرض من هذا الملف**: قائمة موثَّقة بكل المشاكل والأخطاء المُكتشَفة في المشروع، مُهيَّأة على شكل مطالبات (requirements) قابلة للتنفيذ، بحيث يمكن إرسالها مباشرةً إلى وكيل ذكاء اصطناعي (AI agent) لإصلاحها واحدةً واحدة. كل بند يحتوي على: الموقع، وصف المشكلة، الإصلاح المطلوب، ومعايير القبول.

> **قواعد التنفيذ**:
> - لا تُجرِ أي تعديل خارج نطاق البند المُحدَّد.
> - لكل بند معايير قبول (Acceptance Criteria) يجب التحقق منها قبل اعتبار البند مُنجَزاً.
> - إن وُجِد اختبار مُصدَّق (spec) يغطّي المنطقة المُعدَّلة، يجب أن يبقى مُنجَزاً بعد التعديل.
> - يجب الالتزام بأسلوب الكود القائم (Drizzle ORM، NestJS، Zod، Argon2id، AES-256-GCM، DomainError).
> - لا تُضِف رموز صلاحية جديدة إلى `permissionRegistry` دون ADR.
> - التواريخ باللغة العربية في التعليقات؛ الكود بالإنجليزية.

---

## الفهرس

- [القسم 1: الصلاحيات والأدوار (RBAC)](#القسم-1-الصلاحيات-والأدوار-rbac)
- [القسم 2: الأمن والمصادقة](#القسم-2-الأمن-والمصادقة)
- [القسم 3: قاعدة البيانات والـRLS والـmigrations](#القسم-3-قاعدة-البيانات-والrls-والmigrations)
- [القسم 4: الواجهات الأمامية (Frontend)](#القسم-4-الواجهات-الأمامية-frontend)
- [القسم 5: أخطاء الكود (Race conditions / Money / Errors)](#القسم-5-أخطاء-الكود-race-conditions--money--errors)
- [ملخص الأولويات](#ملخص-الأولويات)

---

## القسم 1: الصلاحيات والأدوار (RBAC)

### R-01 — إضافة `@Public()` إلى خطّ Salla webhook
- **الخطورة**: عالية
- **الموقع**: `apps/api/src/modules/integrations/salla/salla.controller.ts:175-184`
- **المشكلة**: المسار `POST /integrations/salla/webhooks/:storeId/orders` يحمل تعليقاً يقول "No permission: the signature is the credential" لكن بدون `@Public()`. النتيجة: `AuthGuard` يرفض طلب Salla بـ401 قبل التحقق من التوقيع. الـhandler أيضاً يستدعي `this.tenantId` (`getTenantContext().tenantId`) الذي يكون `undefined` للطلبات غير المُصدَّق عليها.
- **الإصلاح المطلوب**:
  1. أضِف `@Public()` على الميثود.
  2. استخرج `tenantId` من حمولة الـwebhook أو من `storeId` بدلاً من `getTenantContext()` (مثل `apps/api/src/modules/ecommerce/ecommerce.controller.ts:60-61`).
  3. أكِّد أن `SallaService.webhook()` يستدعي `verifySallaSignature()` قبل أي كتابة على قاعدة البيانات.
- **معايير القبول**:
  - طلب POST من Salla بدون `Authorization` يصل إلى الخدمة ولا يُرفض بـ401.
  - توقيع غير صالح يُرجِع 401 من داخل الخدمة.
  - الاختبارات في `salla-utils.spec.ts` لا تنكسر.

---

### R-02 — إضافة `@Public()` إلى خطّ Stripe webhook
- **الخطورة**: عالية
- **الموقع**: `apps/api/src/modules/platform/billing/billing.controller.ts:22-30`
- **المشكلة**: `POST /billing/webhook` بلا `@Public()`. Stripe لا يرسل JWT، فيُرفض بـ401 قبل التحقق من `stripe.webhooks.constructEvent`.
- **الإصلاح المطلوب**: أضِف `@Public()` على الميثود. أكِّد أن `BillingService.handleStripeWebhook()` يستخدم الـraw body + signature.
- **معايير القبول**: طلب Stripe webhook بدون `Authorization` يصل إلى `handleStripeWebhook` ولا يُرفض بـ401 من قِبَل `AuthGuard`.

---

### R-03 — حماية مسارَي تفعيل الاشتراك بـ`PlatformAdminGuard`
- **الخطورة**: عالية
- **الموقع**: `apps/api/src/modules/platform/billing/billing.controller.ts:50, 56`
- **المشكلة**: `GET /billing/activation-requests` و`POST /billing/activation-requests/:id/review` متاحان لأي عضو مستأجر مصدَّق عليه. الخدمة تفحص `isPlatformAdmin` داخلياً فقط (دفاع عميق). نفس العملية موجودة بشكل صحيح في `apps/api/src/modules/platform/admin/platform-admin.controller.ts:101-102`.
- **الإصلاح المطلوب**: اختر أحد الخيارين:
  - (أ) احذف المسارين من `BillingController` ووجِّه العملاء إلى `POST /platform/activation-requests/:id/review`.
  - (ب) أضِف `@UseGuards(PlatformAdminGuard)` + `@RequiresPlatformRole('console.activation.review')` على المسارين في `BillingController`.
- **معايير القبول**: عضو مستأجر عادي يحصل على 403 عند الوصول للمسارين. الـplatform admin يمكنه إتمام الموافقة.

---

### R-04 — إصلاح خريطة الأسماء المستعارة (PERMISSION_ALIASES) في `apps/staff`
- **الخطورة**: عالية
- **الموقع**: `apps/staff/lib/session.tsx:38-50`
- **المشكلة**: التعليق يقول إنها mirror لـ`@erp/contracts`، لكن 9 من 10 إدخالات تشير إلى رموز **غير موجودة** في السجل الكنسي (مثل `tenant.profile.view`, `tenant.billing.view`, `tenant.users.view`, `tenant.roles.view`, `tenant.devices.view`). الرمز الكنسي الحقيقي هو `tenant.view`, `tenant.manage`, `tenant.membership.manage`, `tenant.role.manage`, `tenant.settings.manage`, `tenant.audit.view`, `tenant.file.upload`, `tenant.notification.view`, `tenant.notification.manage`, `tenant.job.view` — راجع `packages/contracts/src/permissions.ts:55-66`.
- **الإصلاح المطلوب**: استبدل خريطة `PERMISSION_ALIASES` بالنسخة الصحيحة من `packages/contracts/src/permissions.ts:55-66` (`permissionAliases`). يُفضَّل استيرادها مباشرةً: `import { permissionAliases } from '@erp/contracts'`.
- **معايير القبول**:
  - مستخدم يملك `platform.tenant.view` فقط، يرى عناصر القائمة التي تطلب `tenant.view` في `apps/staff`.
  - `can('tenant.view')` يُرجِع `true` عند امتلاك `platform.tenant.view` أو العكس.

---

### R-05 — إصلاح خريطة الأسماء المستعارة في `apps/platform-admin`
- **الخطورة**: عالية
- **الموقع**: `apps/platform-admin/lib/session.tsx:35-47`
- **المشكلة**: نفس الخطأ في R-04.
- **الإصلاح المطلوب**: نفس الإصلاح في R-04.
- **معايير القبول**: نفس معايير R-04.

---

### R-06 — احترام الأسماء المستعارة في `visibleModules`
- **الخطورة**: متوسطة
- **الموقع**: `apps/staff/lib/navigation.ts:2294-2319`
- **المشكلة**: الدالة `visibleModules` تستخدم `permissions.includes(permission)` حرفياً. مستخدم يملك رمزاً قديماً (`platform.*`) لن يرى عناصر القائمة التي تطلب الرمز الكنسي `tenant.*`، رغم أن الـAPI سيُجيزها عبر `permissionGrants`.
- **الإصلاح المطلوب**: استبدل `permissions.includes(permission)` بفحص يستخدم `permissionGrants` من `@erp/contracts`. مثال:
  ```ts
  import { permissionGrants } from '@erp/contracts';
  const allows = (permission?: string) =>
    !permission || permissions.includes('*') || permissionGrants(permissions, permission);
  ```
- **معايير القبول**: مستخدم يملك `platform.tenant.view` يرى عناصر `tenant.view` في القائمة.

---

### R-07 — إصلاح الخطأ المطبعي `sales.invoices.view`
- **الخطورة**: متوسطة
- **الموقع**: `apps/staff/app/page.tsx:136`
- **المشكلة**: الرمز `sales.invoices.view` غير موجود في السجل. الرمز الصحيح هو `sales.view`. زر "كل الفواتير" في الصفحة الرئيسية مخفيٌّ لكل المستخدمين ما عدا المالك (الذي يملك `*`).
- **الإصلاح المطلوب**: استبدل `can('sales.invoices.view')` بـ `can('sales.view')`.
- **معايير القبول**: مستخدم يملك `sales.view` يرى زر "كل الفواتير" في الصفحة الرئيسية.

---

### R-08 — نقل `EmployeeController` إلى `@RequiresPermission`
- **الخطورة**: منخفضة
- **الموقع**: `apps/api/src/modules/employee/employee.controller.ts:9-114`
- **المشكلة**: 14 مساراً تستخدم `assertAny([...])` يدوياً بدل `@RequiresPermission(...)`. الرموز كلها صحيحة، لكن النمط غير مرئي لـ`PermissionsGuard` metadata ولا لاختبار `permission-codes.spec.ts`. الشقيق `EmployeeHrmController` في نفس الملف يستخدم الـdecorator القياسي.
- **الإصلاح المطلوب**: استبدل `assertAny` بـ`@RequiresPermission(...)` على كل مسار. للمنطق OR (مثل `['employee.self.view', 'employee.self.manage', 'hrm.view']`)، أضِف دعم OR للـdecorator أو استخدم مُزخرفاً جديداً `@RequiresAnyPermission(...)`، أو أعد هيكلة المسار إلى عدة routes.
- **معايير القبول**: `permission-codes.spec.ts` يرى جميع رموز `EmployeeController`. لا يوجد `assertAny` في الملف.

---

### R-09 — إضافة `tenant.settings.view` للقراءة فقط
- **الخطورة**: منخفضة
- **الموقع**: `apps/api/src/modules/platform/tenancy/settings.controller.ts:19-20` + `packages/contracts/src/permissions.ts` (بعد رموز `tenant.*`)
- **المشكلة**: `GET /settings` يتطلب `tenant.settings.manage` (رمز الكتابة). لا يوجد رمز قراءة منفصل. لا يمكن إنشاء دور "قارئ إعدادات" (للمُدقِّق) دون منح كتابة.
- **الإصلاح المطلوب**:
  1. أضِف `perm('tenant.settings.view', 'Read effective tenant settings and the typed key registry.')` إلى `permissionRegistry` في `packages/contracts/src/permissions.ts`.
  2. غيِّر `@RequiresPermission('tenant.settings.manage')` على `GET /settings` إلى `@RequiresPermission('tenant.settings.view')`.
  3. أبقِ `PUT /settings/:key` على `tenant.settings.manage`.
- **معايير القبول**: دور يملك `tenant.settings.view` فقط يمكنه قراءة الإعدادات لكن لا تعديلها.

---

### R-10 — تحديث البذور الأساسية لاستخدام الرموز الكنسية
- **الخطورة**: منخفضة
- **الموقع**: `packages/config/src/seeds/roles.ts:32, 103`
- **المشكلة**: أدوار `accountant` و`cashier` ما زالت تكتب `'platform.tenant.view'` (التهجئة المهجورة). الـresolver في `seed.ts:105-115` يُطبِّعها وقت البذر، لكن الملف بارد نسبة لإعادة تنظيم RBAC في 2026-09.
- **الإصلاح المطلوب**: استبدل `'platform.tenant.view'` بـ`'tenant.view'` في `roles.ts:32` و`:103`.
- **معايير القبول**: لا يوجد رمز `platform.*` في `seeds/roles.ts`.

---

### R-11 — تحديث التعليقات التوثيقية المتقادمة
- **الخطورة**: منخفضة
- **المواقع**:
  - `apps/api/src/modules/platform-services/audit/audit.controller.ts:11`
  - `apps/api/src/modules/platform-services/files/files.controller.ts:31`
  - `apps/api/src/modules/platform-services/jobs/jobs.controller.ts:19`
- **المشكلة**: التعليقات تقول `platform.*` بينما الـdecorator الفعلي `tenant.*`.
- **الإصلاح المطلوب**: حدِّث التعليقات لتشير إلى الرموز الكنسية.
- **معايير القبول**: لا يوجد `platform.audit.view` / `platform.file.upload` / `platform.job.view` في التعليقات.

---

## القسم 2: الأمن والمصادقة

### S-01 — حماية `DATA_ENC_KEY` في كل البيئات (لا فقط `production`)
- **الخطورة**: حرجة
- **المواقع**:
  - `apps/api/src/modules/platform/auth/secret-box.ts:17, 20` — `FALLBACK_KEY = 'local-development-data-key'`
  - `apps/api/src/modules/einvoicing/einvoicing.service.ts:40`
  - `apps/api/src/modules/payments/payments.service.ts:108`
  - `apps/api/src/modules/ecommerce/ecommerce.utils.ts:15`
  - `apps/api/src/modules/integrations/salla/salla-utils.ts:2`
  - `packages/config/src/env.ts:263` — يفرض `DATA_ENC_KEY` فقط عند `NODE_ENV === 'production'`
- **المشكلة**: خمس مساعدات AES-256-GCM ترجع إلى سلسلة `'local-development-data-key'` عند غياب `DATA_ENC_KEY`. أي بيئة غير `production` (staging, test، أو `NODE_ENV` غير معرَّف) ستُشفِّر أسرار MFA وZATCA CSID ومفاتيح بوابات الدفع وأسرار الـwebhooks بمفتاح مُلتزَم في المستودع.
- **الإصلاح المطلوب**:
  1. في `packages/config/src/env.ts:258-274` (`assertRuntimeEnv`): أضِف `DATA_ENC_KEY` إلى قائمة الـrequired لكل بيئة ما عدا `test`. تحقَّق أن طول المفتاح ≥ 32 بايت.
  2. في كل من المواقع الخمسة: احذف `FALLBACK_KEY` واجعل `keyBytes()` ترمي `DATA_ENC_KEY_MISSING` عند الغياب. القالب الصحيح موجود في `apps/api/src/modules/backups/artifact-store.ts:80-90`.
- **معايير القبول**:
  - `process.env.NODE_ENV=staging` بدون `DATA_ENC_KEY` → فشل الإقلاع مع رسالة واضحة.
  - لا يوجد `'local-development-data-key'` في أي ملف مصدر.

---

### S-02 — إصلاح ثغرة race condition في تدوير refresh token
- **الخطورة**: عالية
- **الموقع**: `apps/api/src/modules/platform/auth/auth.service.ts:161-243`
- **المشكلة**: SELECT للتحقق من `revokedAt = null` يجري في معاملة (transaction) منفصلة عن UPDATE الذي يدوِّن. طلبان متزامنان بـrefresh token واحد سيمران كلاهما من فحص إعادة الاستخدام، وينتج كلٌّ منهما token صالح، ويُكسِر آلية إلغاء العائلة (family revocation).
- **الإصلاح المطلوب**:
  - اختر أحد الخيارين:
    - (أ) أضِف `AND revoked_at IS NULL` إلى WHERE في UPDATE وتحقَّق من عدد الصفوف المُؤثَّرة. إذا كان 0، ألغِ العائلة وارفض.
    - (ب) نفِّذ SELECT + UPDATE + INSERT في معاملة واحدة باستخدام `SELECT ... FOR UPDATE`.
- **معايير القبول**: اختبار تكافُؤ يُؤكِّد أن طلبَين متزامنَين بـrefresh token واحد لا يُنتِجان tokenين صالحين.

---

### S-03 — تطبيق `ZodValidationPipe` على الـ`@Body()` غير المُتحقَّق منها
- **الخطورة**: عالية
- **الموقع**: 299 من 413 `@Body()` عبر 60+ متحكِّم
- **أبرز المخالفين**:
  - `hrm.controller.ts` (19 مساراً)
  - `sales.controller.ts` (13), `accounting.controller.ts` (9), `treasury.controller.ts` (10), `tailoring.controller.ts` (18), `marina.controller.ts` (18), `pos.controller.ts` (9), `purchases.controller.ts` (7), `salla.controller.ts` (9)
  - `supplier-portal.controller.ts:23, 41, 69, 104, 120, 135` (بما في ذلك invite مع `password` في الجسم)
  - `compat.controller.ts:14, 23, 43, 47, 55` (مسارات عامة)
- **المشكلة**: مسارات تستخدم `@Body() body: SomeType` بلا `ZodValidationPipe`. الـTypeScript type يُمحى وقت التشغيل. المفاتيح الزائدة، الكائنات المتداخلة المشوَّهة، والحقول المفقودة تصل إلى الخدمة فتُسبِّب 500 أو كتابة خاطئة.
- **الإصلاح المطلوب**:
  1. أنشِئ Zod schemas في `packages/contracts/src/<module>/` لكل مسار.
  2. طبِّق `new ZodValidationPipe(schema)` على كل `@Body()`.
  3. ابدأ بالمسارات العامة: `compat/*`, `supplier-portal/*`, `esign/*`, `public/*`.
  4. أضِف قاعدة lint تمنع `@Body()` بلا ZodValidationPipe.
- **معايير القبول**: 100% من `@Body()` ملفوفة بـ`ZodValidationPipe`. `pnpm openapi:export` يُنتِج OpenAPI specs متوافقة.

---

### S-04 — إصلاح Compat service: sessions, rate limit, pepper
- **الخطورة**: حرجة
- **الموقع**: `apps/api/src/modules/compat/compat.service.ts:18, 19, 25, 166` + `compat.controller.ts:21-23, 25-59`
- **المشكلة**:
  - (أ) الجلسات في `Map` في الذاكرة only — تختفي عند إعادة التشغيل، غير مشتركة بين الـreplicas.
  - (ب) `rateLimit()` مُعدَّل على `return true` (no-op).
  - (ج) `compatPepper()` يرجع إلى `'dev-compat-pepper-change-me'` ولا يُتحقَّق منه في `assertRuntimeEnv`.
  - (د) `hashApiKey` = `SHA-256(pepper:key)` تكرار واحد فقط.
- **الإصلاح المطلوب**:
  1. انقل الجلسات إلى قاعدة البيانات (جدول `compat_sessions`) أو Redis.
  2. نفِّذ `rateLimit` فعلياً باستخدام `RateLimiterService` بمفتاح `tenantId + deviceId`.
  3. أضِف `COMPAT_KEY_PEPPER` إلى `env.ts` و`assertRuntimeEnv`.
  4. استبدل `SHA-256` بـ`HMAC-SHA-256` بـ100,000 تكرار، أو Argon2id.
- **معايير القبول**: جلسة compat تنجو من إعادة تشغيل الـAPI. `rateLimit` يُرجِع `false` عند تجاوز الحد. `COMPAT_KEY_PEPPER` مطلوب للإقلاع في كل بيئة ما عدا `test`.

---

### S-05 — حماية OTP الخاص بـe-sign (rate limit + lockout)
- **الخطورة**: عالية
- **الموقع**: `apps/api/src/modules/supplier-portal/supplier-portal.controller.ts:178-193` + `supplier-esign.ts:44-47, 84-93` + `supplier-portal.service.ts:399, 437`
- **المشكلة**:
  - OTP مكوّن من 6 أرقام، صالح لمدة 7 أيام (`SIGN_DAYS = 7`).
  - المسار `POST /esign/:token/sign` عام (`@Public`) ولا يحمل `@RateLimit`.
  - الافتراضي العام 600/min/IP × replicas (انظر S-08) = ملايين المحاولات قبل انتهاء الصلاحية.
  - لا يوجد قفل بعد المحاولات الفاشلة.
  - `previewOtp: env.MAIL_TRANSPORT === 'console' ? otp : undefined` يُرجِع OTP في استجابة الـAPI لكل موظف يملك `esign.manage` عندما `MAIL_TRANSPORT=console` (وهو الافتراضي في `.env.example:133`).
- **الإصلاح المطلوب**:
  1. أضِف `@RateLimit({ name: 'esign-otp', limit: 5, windowMs: 60_000 })` إلى المسار.
  2. أضِف عمود `failed_attempts` و`locked_until` إلى جدول الـesign tokens. بعد 5 محاولات، أدر OTP جديد وأرسله بالبريد.
  3. احذف `previewOtp` أو قيِّده بـ`NODE_ENV === 'test'`.
  4. استبدل `randomBytes(4).readUInt32BE(0) % 1_000_000` بـ`randomInt(0, 1_000_000)` من `node:crypto`.
- **معايير القبول**:
  - 6 محاولات فاشلة متتالية تُغلِق الـOTP.
  - `previewOtp` غير موجود في الاستجابة في كل البيئات ما عدا `test`.
  - استخدام `randomInt` بدلاً من modulo.

---

### S-06 — إصلاح HMAC لروابط تنزيل الـbackups (nonce + actor)
- **الخطورة**: عالية
- **الموقع**: `apps/api/src/modules/backups/platform-backups.controller.ts:142-158, 285-298, 305-322` + `apps/api/src/modules/platform-services/files/download-token.ts:56-60`
- **المشكلة**: HMAC يغطّي `fileId|tenantId|expires` فقط. لا يوجد nonce ولا actor. رابط مسرَّب يمنح حامله الـplaintext الكامل للـdump حتى انتهاء الـTTL (افتراضياً 5 دقائق، قابل للرفع إلى 24 ساعة). المسار `@Public()`، فلا توجد إسنادات في سجل التدقيق.
- **الإصلاح المطلوب**:
  1. أضِف `actorUserId` و`nonce` إلى حمولة الـHMAC.
  2. سجِّل الـnonce في جدول `backup_runs` (أو جدول جانبي) وأبطِله بعد أول تنزيل ناجح.
  3. خفِّض `FILES_DOWNLOAD_URL_TTL_SECONDS` لروابط الـbackup إلى 60 ثانية.
  4. اكتب صف تدقيق من المعالج العام (tenant_id = null للمنصة).
- **معايير القبول**: رابط تنزيل backup لا يعمل بعد أول استخدام. سجل التدقيق يُسجِّل من نزَّل الـbackup.

---

### S-07 — إيقاف إرسال كلمات مرور الـsupplier portal كنص صريح بالبريد
- **الخطورة**: عالية
- **الموقع**: `apps/api/src/modules/supplier-portal/supplier-portal.service.ts:124-172, 233-267`
- **المشكلة**: `invite()` يُرسِل كلمة المرور المؤقتة كـplaintext في البريد. لا يوجد قفل حساب على `supplier_portal_users` (`failed_login_attempts` غير موجود).
- **الإصلاح المطلوب**:
  1. استبدل إرسال كلمة المرور بـرابط إعداد لمرة واحدة (one-time setup link) يتيح للمورد اختيار كلمة مروره (النمط موجود في `signup.service.ts`).
  2. أضِف `failed_login_attempts` و`locked_until` إلى `supplier_portal_users`.
  3. زِد العداد في `login()` وأغلق الحساب بعد 5 محاولات.
- **معايير القبول**: لا توجد كلمة مرور في رسائل البريد المُرسَلة. الحساب يُغلَق بعد 5 محاولات فاشلة.

---

### S-08 — نقل rate limiter إلى Redis + ضبط `trust proxy`
- **الخطورة**: عالية
- **الموقع**: `apps/api/src/modules/platform/rate-limit/rate-limiter.service.ts:7-9, 21` + `apps/api/src/modules/platform/guards/rate-limit.guard.ts:35` + `apps/api/src/bootstrap.ts:10-36`
- **المشكلة**:
  - `Map` في الذاكرة only — كل replica يحتفظ بـbuckets مستقلة، فالحدود الفعّالة = `limit × replicas`.
  - `app.set('trust proxy', ...)` غير مضبوط. خلف load balancer، `request.ip` يصبح IP الـLB، فينهار كل العملاء في bucket واحد (إما DoS جماعي أو ضرب الحد).
- **الإصلاح المطلوب**:
  1. نفِّذ variant مبني على Redis خلف نفس الـinterface (`RateLimiterService.consume`). استخدم Lua script للذرة.
  2. اضبط `app.set('trust proxy', <number-of-hops>)` في `bootstrap.ts` بناءً على متغير بيئة `TRUSTED_PROXY_HOPS`.
  3. حتى يصبح Redis متاحاً، وثِّق أن الـAPI يجب أن يعمل كـreplica واحد خلف proxy موثوق.
- **معايير القبول**: اختبار تكافُؤ يُؤكِّد أن 3 replicas تشترك في bucket واحد. `request.ip` يُرجِع IP العميل الحقيقي خلف proxy.

---

### S-09 — تشغيل ماسح فيروسات حقيقي (ClamAV)
- **الخطورة**: متوسطة
- **الموقع**: `apps/api/src/modules/platform-services/files/virus-scanner.ts:25-33` + `files.service.ts:163, 174`
- **المشكلة**: `NoopVirusScanner` يُرجِع `skipped` لكل ملف. لا يوجد انتقال إلى `quarantined`، لا رفض، لا تنبيه. النتيجة `skipped` غير مميَّزة عن `clean` في سجل التدقيق.
- **الإصلاح المطلوب**:
  1. وَصِل ClamAV sidecar (الحل الموثَّق).
  2. حتى ذلك الحين: عامل `skipped` كـ`pending_scan` في صف الـfile، وارفض إنشاء روابط تنزيل للملفات في هذه الحالة.
  3. ميِّز `skipped` عن `clean` في `meta.scan` للتدقيق.
- **معايير القبول**: ملف مُصاب لا يصلح للتنزيل. الفرق بين `skipped` و`clean` واضح في سجل التدقيق.

---

### S-10 — تحديد حجم جسم الطلب (body size limit)
- **الخطورة**: منخفضة
- **الموقع**: `apps/api/src/bootstrap.ts`
- **المشكلة**: لا يوجد `app.use(express.json({ limit: ... }))`. الافتراضي Express (100KB) يطبَّق بصمت.
- **الإصلاح المطلوب**: اضبط `app.use(json({ limit: '1mb' }))` صراحةً.
- **معايير القبول**: طلب بجسم > 1MB يُرجِع 413.

---

### S-11 — توثيق عمليات الـwebhook بـ`tenantId` صحيح في سجل التدقيق
- **الخطورة**: متوسطة
- **الموقع**: `apps/api/src/modules/platform-services/audit/audit.interceptor.ts:137-209`
- **المشكلة**: مسارات الـwebhook (`POST crm/webhooks/whatsapp`, `POST webhooks/:provider`, `POST payments/webhooks/:provider`) تعمل بلا سياق tenant، فيُكتَب صف التدقيق بـ`tenantId: null` رغم أن الـwebhook عدَّل بيانات tenant محدَّد. الحمولة تُكتَب في `after` بدون تنقية PII (أسماء عملاء، جوالات، بريد).
- **الإصلاح المطلوب**:
  1. اجعل خدمات الـwebhook تستدعي `audit.recordInTx()` بـ`tenantId` الحقيقي الذي تحلُّه داخلياً.
  2. استدعِ `markRequestAudited()` لتخطّي الصف العام.
  3. وسِّع `redactAuditPayload` لتتعرف على مفاتيح PII الشائعة: `email`, `phone`, `mobile`, `fullName`, `customerName`.
- **معايير القبول**: عمليات الـwebhook تظهر في سجل التدقيق بـ`tenantId` صحيح. لا PII في `audit_log.after`.

---

## القسم 3: قاعدة البيانات والـRLS والـmigrations

### D-01 — تفعيل `RetentionService` ومُجزِّئ `audit_log`
- **الخطورة**: عالية
- **الموقع**: `apps/api/src/ops/retention.service.ts:1-29` + `packages/database/src/schema/platform-services.ts:34-58`
- **المشكلة**: `RetentionService.plan()` يحسب خطة (audit قبل 365 يوم، outbox قبل 90 يوم، idempotency قبل 30 يوم) لكن لا أحد يستدعيه — كود ميت. جدول `audit_log` لا تجزئة له ولا سياسة احتفاظ، ينمو بلا حدود.
- **الإصلاح المطلوب**:
  1. أضِف migration يُجزِّئ `audit_log` بـ`RANGE (created_at)` شهرياً.
  2. أنشِئ مهمة مجدولة (BullMQ `maintenance` queue) تستدعي `RetentionService.plan()` وتُنفِّذ: `DETACH PARTITION` للأجزاء القديمة، `DELETE` لـ`idempotency_keys` المنتهية، `DELETE` لـ`outbox_jobs` بـ`status IN ('published','dead')`.
  3. استخدم role مخصَّص (`erp_retention`) يملك `DELETE` على هذه الجداول (لا `erp_api`).
- **معايير القبول**: `audit_log` مُجزَّأ شهرياً. المهمة المجدولة تعمل يومياً وتنقل الأجزاء القديمة إلى أرشيف.

---

### D-02 — إضافة down migrations لـ 15 migration
- **الخطورة**: متوسطة
- **الموقع**: `packages/database/migrations/{0033,0034,0035,0036,0061,0064,0065,0079,0093,0094,0095,0109,0110,0111,0112}.sql`
- **المشكلة**: 15 migration بلا `down/<n>_*.down.sql`. `runMigrationsDown` يرمي `"No down migration found"` ويُجهِض الـrollback، تاركاً الـmigration مطبَّقاً.
- **الإصلاح المطلوب**: أضِف down migration لكل من الملفات الـ15. الأهم: `0035_item_units_barcodes.sql` (data backfill + destructive orphan deletes)، `0094_employee_branches.sql` (جدول جديد)، `0111_comments_mentions.sql` + `0112_project_kanban.sql`.
- **معايير القبول**: `pnpm migrate:down` يعمل بنجاح لكل migration.

---

### D-03 — إصلاح `hrm.service.ts` (soft-delete + missing filter)
- **الخطورة**: متوسطة
- **الموقع**: `apps/api/src/modules/hrm/hrm.service.ts:376-379`
- **المشكلة**:
  - `listJobs`: `tx.select().from(jobs).where(eq(jobs.tenantId, tenantId))` — لا `isNull(jobs.deletedAt)`. الوظائف المحذوفة ناعماً تظهر في القائمة.
  - `updateJob`: نفس المشكلة — قد يُعدِّل وظيفة محذوفة.
  - `deleteJob`: `tx.delete(jobs).where(...)` — hard-delete على جدول له `baseSoftDeleteColumns()`. يكسر نمط الحذف الناعم ويفقد أثر التدقيق.
- **الإصلاح المطلوب**:
  - `listJobs`: أضِف `and(eq(jobs.tenantId, tenantId), isNull(jobs.deletedAt))`.
  - `updateJob`: نفس الإصلاح.
  - `deleteJob`: استبدل `tx.delete` بـ`tx.update(jobs).set({ deletedAt: new Date(), deletedBy: actorUserId }).where(...)`.
- **معايير القبول**: الوظائف المحذوفة لا تظهر في `listJobs`. `deleteJob` يضع `deleted_at` بدل الحذف الفعلي.

---

### D-04 — إضافة فهرس على `outbox_jobs.processed_at`
- **الخطورة**: منخفضة
- **الموقع**: `packages/database/src/schema/platform-services.ts:139-142`
- **المشكلة**: لا يوجد فهرس على `processed_at`. عملية الـretention المستقبلية ستمسح الجدول كاملاً.
- **الإصلاح المطلوب**: أضِف `index('outbox_jobs_processed_at_idx').on(processedAt)` في schema + migration.
- **معايير القبول**: الفهرس موجود ويُستخدَم في `EXPLAIN` لاستعلامات التنقية.

---

### D-05 — إضافة فهرس على `item_price_history`
- **الخطورة**: متوسطة
- **الموقع**: `packages/database/src/schema/catalog.ts:220`
- **المشكلة**: لا يوجد فهرس على `(tenantId, itemId, recordedAt)`. كل بحث في تاريخ سعر صنف يمسح قسم الـtenant كاملاً.
- **الإصلاح المطلوب**: أضِف `index('item_price_history_tenant_item_recorded_idx').on(tenantId, itemId, recordedAt)`.
- **معايير القبول**: الفهرس موجود.

---

### D-06 — إضافة `onDelete` صريحة لكل الـFKs
- **الخطورة**: متوسطة
- **المواقع**:
  - `parties.ts:24` — `payment_methods.cash_location_id`
  - `parties.ts:35` — `parties.payment_method_id`
  - `catalog.ts:28` — `item_categories.parent_id` (self-FK مفقود)
  - `catalog.ts:38, 213` — `item_categories.branch_id`, `item_components.warehouse_id`
  - `catalog.ts:102-111` — `items.category_id`, `base_unit_id`, `tax_group_id`
  - `accounting.ts:33` — `accounts.parent_id` (self-FK مفقود)
  - `accounting.ts:186` — `cost_centers.parent_id`
  - `inventory.ts:108, 180-184, 261, 386-390` — `branch_id`, `warehouse_id`, `from_warehouse_id`
  - `sales.ts:39-45, 43, 54, 77` — `branch_id`, `warehouse_id`, `party_id`, `reference_invoice_id`, `converted_invoice_id`, `combined_into`
- **المشكلة**: كل هذه FKs بلا `onDelete` — يطبَّق افتراضياً `NO ACTION` (deferred restrict). حذف parent يفشل عند الـcommit فقط، برسالة غامضة.
- **الإصلاح المطلوب**: أضِف `onDelete: 'restrict'` أو `'set null'` صريحة لكل FK. للـself-references (`parent_id`) استخدم `references((): AnyPgColumn => <table>.id, { onDelete: 'restrict' })`.
- **معايير القبول**: كل FK له `onDelete` صريحة في Drizzle schema. الـmigrations متوافقة.

---

### D-07 — إضافة FKs على الأعمدة العارية (polymorphic + soft references)
- **الخطورة**: منخفضة
- **المواقع**:
  - `parties.ts:38` — `payment_allocations.voucher_id` (FK إلى `vouchers(id) ON DELETE CASCADE`)
  - `hrm.ts:33, 174, 194` — `employees.photo_file_id`, `payroll_wps_files.file_id`, `payroll_gosi_files.file_id` (FK إلى `files(id)`)
  - `catalog.ts:123` — `items.image_file_id` (FK إلى `files`)
  - `sales.ts:45, 89` — `sales_invoices.salesman_id` (FK إلى `salesmen`), `cashier_id` (FK إلى `memberships`)
- **المشكلة**: أعمدة `uuid` بلا FK. مرجع وحيد (orphaned file) غير مرئي لجمع القمامة.
- **الإصلاح المطلوب**: أضِف `references(() => <table>.id, { onDelete: 'set null' })` لكل منها.
- **معايير القبول**: FKs موجودة في schema وmigrations.

---

### D-08 — تقييد طول الأعمدة النصية الحساسة
- **الخطورة**: منخفضة
- **المواقع**:
  - `parties.ts:35` — `tax_no` (15 حرف)، `national_id` (10 حروف)
  - `hrm.ts:31` — `employees.national_id`, `insurance_no`
  - `sales.ts:73-74` — `zatca_hash` (64 hex)، `zatca_qr` (2000)
- **المشكلة**: أعمدة `text` بلا قيود. مخزَّنة بشكل غير محدود.
- **الإصلاح المطلوب**: استبدل بـ`char(15)` / `char(10)` / `char(64)` / `varchar(2000)` أو أضِف CHECK.
- **معايير القبول**: الـschema يحدِّد الأطوال.

---

### D-09 — تطبيع `cash_locations.bank` jsonb
- **الخطورة**: منخفضة
- **الموقع**: `packages/database/src/schema/organization.ts:162`
- **المشكلة**: `cash_locations.bank` jsonb (`{bankName, iban, swift, accountNo}`) يكرِّر جدول `bank_accounts` في `schema/banking.ts`. مصدران للحقيقة.
- **الإصلاح المطلوب**: إما أحذِف الـjsonb لصالح FK إلى `bank_accounts`، أو وثِّق سبب وجودهما معاً.
- **معايير القبول**: مصدر واحد لحقيقة بيانات البنك، أو توثيق صريح.

---

### D-10 — إصلاح race condition في `MAX(code)+1` للـparties
- **الخطورة**: عالية
- **الموقع**: `apps/api/src/modules/parties/parties.service.ts:40`
- **المشكلة**: `SELECT COALESCE(MAX(CAST(code AS INTEGER)),0)+1` يجري في `withTenantTx` منفصل عن INSERT اللاحق. طلبان متزامنان يحسبان نفس الرمز، يصطدمان بـ`parties_tenant_code_key` (500 غير مُلتقَط، خلافاً لـ`createPaymentMethod`).
- **الإصلاح المطلوب**:
  - استخدم `SequencesService.next({ docType: 'party', ... }, tx, ...)` داخل معاملة INSERT واحدة.
  - أو: ادمج SELECT + INSERT في `withTenantTx` واحدة + `INSERT ... ON CONFLICT DO NOTHING` + إعادة محاولة.
- **معايير القبول**: اختبار تكافُؤ يُؤكِّد أن طلبَين متزامنَين يُنتِجان رمزين مختلفين أو أحدهما يُعيد المحاولة بنجاح.

---

### D-11 — إصلاح `nextAdjustmentNumber` / `nextSalaryPaymentNumber`
- **الخطورة**: عالية
- **الموقع**: `apps/api/src/modules/hrm/hrm.service.ts:838-846, 1401-1409`
- **المشكلة**: كلتا الدالتين `SELECT number FROM salary_adjustments/salary_payments WHERE tenant_id = ?` (بلا LIMIT)، تحمِّل كل الصفوف إلى JS، وتحسب `Math.max(...)+1`. هذا O(n) عبر عمر الـtenant AND race condition.
- **الإصلاح المطلوب**: استبدل بـ`SELECT COALESCE(MAX(CAST(number AS INTEGER)),0)+1 FROM ... WHERE tenant_id = ?` داخل المعاملة + فهرس فريد جزئي على `number`. أو استخدم `SequencesService.next`.
- **معايير القبول**: اختبار تكافُؤ يُؤكِّد الإنتاج المتزامن لأرقام فريدة.

---

### D-12 — معالجة race conditions في `MAX(number)+1` للمارينا والمحتوى
- **الخطورة**: متوسطة
- **المواقع**:
  - `apps/api/src/modules/marina/additions.service.ts:135-138`
  - `apps/api/src/modules/marina/group-cards.service.ts:291-295`
  - `apps/api/src/modules/content/content.service.ts:255-272`
- **المشكلة**: SELECT `coalesce(max(...),0)+1` داخل معاملة لكن بلا `FOR UPDATE`. طلبان متزامنان يصطدمان بـUNIQUE (500 للعميل).
- **الإصلاح المطلوب**: استخدم `Sequences.next` أو `FOR UPDATE` على صف parent + UNIQUE index + retry-on-conflict.
- **معايير القبول**: لا 500 عند الإنشاء المتزامن.

---

### D-13 — تحديث قائمة `rlsProtectedTables` في `rls.ts`
- **الخطورة**: منخفضة (توثيقي)
- **الموقع**: `packages/database/src/rls.ts:119-223`
- **المشكلة**: القائمة موثَّقة كـ"kept next to the schema for review" لكنها تفتقد عشرات الجداول الـtenant-scoped التي فعلاً لها RLS على مستوى الـDB عبر الـmigrations (`accounts`, `journal_entries`, `parties`, `items`, `sales_invoices`, `purchase_invoices`, `vouchers`, `employees`, إلخ.).
- **الإصلاح المطلوب**: صالح القائمة مع الـschema الفعلي، أو احذفها واشتقها من `pg_policies` وقت التشغيل.
- **معايير القبول**: القائمة في `rls.ts` تطابق الجداول الـtenant-scoped الفعلية.

---

### D-14 — إضافة CHECK على `sales_invoices.number`
- **الخطورة**: منخفضة
- **الموقع**: `packages/database/src/schema/sales.ts:56`
- **المشكلة**: `sales_invoices.number` nullable. الفهرس الفريد جزئي على `number IS NOT NULL` يمنع التكرار لكن يسمح بـNULL للفواتير المُرسَلة نظرياً.
- **الإصلاح المطلوب**: أضِف CHECK: `status = 'draft' OR number IS NOT NULL`.
- **معايير القبول**: لا يمكن لفاتورة `posted` أن تكون بلا `number`.

---

### D-15 — إصلاح `gen_random_uuid()` في migration 0044
- **الخطورة**: منخفضة
- **الموقع**: `packages/database/migrations/0044_shift_close_number_scope.sql:19`
- **المشكلة**: يستخدم `gen_random_uuid()` لـ`id`، مخالفاً لـ`packages/database/src/columns.ts:7` ("`gen_random_uuid()` is deliberately never used"). المشروع يستخدم UUID v7 مولَّداً application-side.
- **الإصلاح المطلوب**: استبدل بـUUID v7 مولَّد application-side، أو وثِّق الاستثناء.
- **معايير القبول**: لا `gen_random_uuid()` في أي migration.

---

## القسم 4: الواجهات الأمامية (Frontend)

### F-01 — نقل tokens من localStorage إلى HttpOnly cookies
- **الخطورة**: عالية
- **المواقع**:
  - `apps/staff/lib/api.ts:44-46, 101-103`
  - `apps/platform-admin/lib/api.ts:44-46, 86-88`
  - `apps/customer-portal/lib/api.ts:21-23` (cookie بلا HttpOnly/Secure)
  - `apps/marketing/lib/api.ts:21-23` (نفس المشكلة)
- **المشكلة**: access + refresh tokens في `localStorage` (أو cookie غير HttpOnly) — أي XSS يستخرج الـrefresh token طويل العمر.
- **الإصلاح المطلوب**:
  1. الـAPI يضبط `HttpOnly; Secure; SameSite=Strict` cookies عبر `Set-Cookie` في استجابة `/auth/login` و`/auth/refresh`.
  2. العميل لا يقرأ الـtoken مباشرة؛ يستخدمه تلقائياً عبر `credentials: 'include'`.
  3. أضِف `/auth/session` endpoint للتحقق من حالة الجلسة.
- **معايير القبول**: لا `localStorage.getItem('erp.admin.access')` في الكود. الـtoken غير قابل للقراءة من JS.

---

### F-02 — إيقاف تمرير الـrefresh token عبر URL
- **الخطورة**: حرجة
- **المواقع**:
  - `apps/marketing/components/smart-login.tsx:64-67` — `?token=${accessToken}&refresh=${refreshToken}&tenant=${tenantCode}`
  - `apps/staff/components/token-bridge.tsx:21-32`
  - `apps/customer-portal/components/token-bridge.tsx:16-24`
- **المشكلة**: الـrefresh token في URL query string يُكتَب في: تاريخ المتصفح، سجلات الخادم، سجلات الـreverse proxy، و`Referer` لأي مورد فرعي محمَّل قبل `replaceState`.
- **الإصلاح المطلوب**:
  - استخدم `POST` من marketing إلى `/auth/bridge` endpoint في staff يضبط cookie عبر `Set-Cookie`.
  - أو استخدم `postMessage` بين الـorigins.
  - لا تضع أي token في URL إطلاقاً.
- **معايير القبول**: لا `?token=` أو `?refresh=` في أي URL.

---

### F-03 — إضافة `app/error.tsx` و`app/global-error.tsx`
- **الخطورة**: متوسطة
- **المواقع**: `apps/staff/app/`, `apps/platform-admin/app/`, `apps/customer-portal/app/`, `apps/marketing/app/`
- **المشكلة**: لا يوجد error boundary. خطأ render-time في أي شاشة يُسقِط التطبيق كله إلى صفحة Next.js الافتراضية.
- **الإصلاح المطلوب**: أضِف `app/error.tsx` و`app/global-error.tsx` لكل تطبيق. يُسجِّل الخطأ إلى الـAPI ويُقدِّم "إعادة تحميل" + "العودة للوحة".
- **معايير القبول**: خطأ render يُظهِر صفحة خطأ أنيقة بدل السقوط الكامل.

---

### F-04 — إضافة `can()` check قبل `useQuery` في الشاشات
- **الخطورة**: عالية
- **المواقع**:
  - `apps/staff/app/sales/invoices/new/page.tsx:39-48, 163`
  - `apps/staff/app/settings/users/page.tsx:87-91, 118`
  - `apps/staff/app/accounting/journal-entries/new/page.tsx:80-85, 212`
  - `apps/staff/app/treasury/vouchers/page.tsx:168-184` (بلا فحص إطلاقاً)
  - `apps/platform-admin/components/platform-guard.tsx:41-49, 73`
  - `apps/platform-admin/app/tenants/page.tsx:64-79` (بلا `canConsole('console.tenants.view')`)
  - `apps/platform-admin/app/impersonation/page.tsx:62-103` (بلا `canConsole('console.support.manage')`)
  - `apps/platform-admin/app/tenants/[id]/page.tsx:132-135`
- **المشكلة**: استدعاءات `useQuery` تُنفَّذ قبل فحص `can()`. مستخدم بلا صلاحية يُطلِق استدعاءات API تُرجِع 403. بعض الصفحات لا تفحص إطلاقاً (مثل `treasury/vouchers`).
- **الإصلاح المطلوب**:
  1. غلِّف كل صفحة بـ`<Forbidden/>` في الأعلى قبل الـhooks.
  2. أو مرِّر `enabled` flag إلى `useQuery` بناءً على `can()`.
  3. لـ`treasury/vouchers`: أضِف `if (!can('treasury.voucher.view')) return <Forbidden/>`.
  4. لـ`platform-admin`: أضِف `canConsole('console.tenants.view')` و`canConsole('console.support.manage')` في الأعلى.
- **معايير القبول**: مستخدم بلا صلاحية لا يُطلِق استدعاءات API للصفحة.

---

### F-05 — إظهار `ImpersonationBanner` في `EmployeeShell`
- **الخطورة**: عالية
- **الموقع**: `apps/staff/components/employee-shell.tsx`
- **المشكلة**: الـ`/m/*` routes تستخدم `EmployeeShell` الذي لا يُصدِر `<ImpersonationBanner>`. موظف دعم في جلسة دخول مؤقَّت يفتح `/m/attendance` لا يرى اللافتة الحمراء — مخالفة P-C8.
- **الإصلاح المطلوب**: أضِف `<ImpersonationBanner impersonation={me?.impersonation} lang="ar" />` في أعلى `EmployeeShell`.
- **معايير القبول**: اللافتة تظهر في كل صفحات `/m/*` أثناء الدخول المؤقَّت.

---

### F-06 — إصلاح `session.can('tenant.view')` في صفحة الاستخدام
- **الخطورة**: متوسطة
- **الموقع**: `apps/staff/app/settings/usage/page.tsx:62`
- **المشكلة**: `session.can('tenant.view')` يستخدم رمزاً ليس كنسياً (`tenant.view` هو الكنسي، لكن الرمز المُستخدَم هنا قد يُربَك مع `tenant.profile.view` الذي **غير موجود** في الـalias map المكسور في `session.tsx:38-50`). النتيجة تعتمد على إصلاح R-04/R-05.
- **الإصلاح المطلوب**: بعد إصلاح R-04، تأكَّد أن `can('tenant.view')` يُنجَز صحيحاً. أو غيِّر الاستدعاء إلى `session.can('tenant.profile.view')` لو أُضيف للـalias map.
- **معايير القبول**: مستخدم يملك `tenant.view` (أو `platform.tenant.view`) يرى صفحة الاستخدام.

---

### F-07 — إصلاح قائمة بياض روابط الدفع في بوابة العملاء
- **الخطورة**: عالية
- **الموقع**: `apps/customer-portal/app/portal/invoices/[id]/pay/page.tsx:53`
- **المشكلة**: `<a href={link.url} target="_blank" rel="noreferrer">` — `link.url` من الـAPI. لو أُخترِق الـAPI أو حُقِن قيمة من tenant-admin، يُعاد توجيه المستخدم لموقع مهاجم. لا قائمة بياض للنطاقات.
- **الإصلاح المطلوب**:
  1. تحقَّق من hostname لـ`link.url` ضد قائمة بياض: `moyasar.com`, `hyperpay.com`, `tap.company`, `network.com.sa` (أو من إعداد).
  2. أظهِر خطأ إن لم يكن في القائمة.
  3. أضِف `rel="noopener noreferrer"`.
- **معايير القبول**: رابط لنطاق غير مُدرَج يُظهِر خطأ بدل التوجيه.

---

### F-08 — إخفاء token الدخول المؤقَّت من DOM
- **الخطورة**: عالية
- **الموقع**: `apps/platform-admin/app/impersonation/page.tsx:181-204`
- **المشكلة**: token الدخول المؤقَّت يُعرَض في DOM كـ`<a href="${staffUrl()}/#support=${started.accessToken}">`، ويُحفَظ في state، ويُنسَخ عبر `navigator.clipboard`. مرئي في view-source، React DevTools، shoulder-surfing.
- **الإصلاح المطلوب**:
  - اعرض زر "افتح tenant العميل" يُنشِئ الـURL في `useMemo` ولا يُرفِقه إلا عند النقر.
  - أو: اجعل تطبيق staff يسحب الـtoken عبر استدعاء server-to-server بدل تمريره في URL.
- **معايير القبول**: الـtoken غير مرئي في DOM أو في state React DevTools.

---

### F-09 — استبدال `useQuery` المخصوص بـ`@tanstack/react-query`
- **الخطورة**: متوسطة
- **الموقع**: `apps/staff/lib/use-query.ts:15-44` + `apps/platform-admin/lib/use-query.ts:15-44`
- **المشكلة**: hook مخصوص يعيد اختراع React Query بدون cache، dedup، retry، refetch-on-focus، SWR، GC. `@tanstack/react-query` مُعرَّف كـdependency في `apps/staff/package.json:11` لكن غير مُستورَد إطلاقاً. ليس مُعرَّفاً في `platform-admin`.
- **الإصلاح المطلوب**:
  1. استبدل الـhook المخصوص بـ`useQuery` من `@tanstack/react-query` + `QueryClient` مشترك.
  2. أضِف الـdependency إلى `apps/platform-admin/package.json`.
  3. أو استخرِج الـhook المشترك إلى `@erp/ui`.
- **معايير القبول**: `useQuery` المخصوص محذوف. `@tanstack/react-query` مستورَد فعلياً.

---

### F-10 — اعتماد `react-hook-form` + `zod` للنماذج المالية
- **الخطورة**: متوسطة
- **الموقع**: `apps/staff/components/invoice-editor.tsx` + `apps/staff/app/accounting/journal-entries/new/page.tsx` + `apps/staff/app/sales/invoices/new/page.tsx`
- **المشكلة**: `react-hook-form` و`zod` مُعرَّفان في `apps/staff/package.json:18, 20` لكن غير مُستورَدَين. كل النماذج تستخدم `useState` خام + validation مؤقت. `numeric()` في `invoice-editor.tsx:45` يحوِّل `NaN`/فارغ إلى `'0'` بصمت.
- **الإصلاح المطلوب**:
  1. استخدم `react-hook-form` + `zod` لنماذج: محرر الفاتورة، القيد المحاسبي، السندات.
  2. أضِف validation لكل حقل كمية/سعر/خصم.
- **معايير القبول**: نماذج مالية تستخدم RHF + Zod. لا `useState` للحقول المنفصلة.

---

### F-11 — إصلاح `key={index}` و O(n²) في محرر الفواتير
- **الخطورة**: متوسطة
- **الموقع**: `apps/staff/components/invoice-editor.tsx:191, 193`
- **المشكلة**:
  - `<tr key={index}>` لقائمة تدعم إضافة/حذف/إعادة ترتيب → أخطاء هوية input (قفز التركيز، قيم مح controlled تُلصَق خطأً).
  - `const computed = totals.lines[filledLines(lines).indexOf(line)]` داخل `lines.map(...)` → O(n²) لكل render.
- **الإصلاح المطلوب**:
  - استخدم id عميل مولَّداً لكل `LineDraft` كـ`key`.
  - احسب `Map<line, computed>` مرة واحدة لكل render خارج الـmap.
- **معايير القبول**: لا قفز تركيز عند حذف صف. أداء محسَّن مع 50+ صف.

---

### F-12 — تأكيد حذف الصف في محرر الفواتير
- **الخطورة**: منخفضة
- **الموقع**: `apps/staff/components/invoice-editor.tsx:277-280`
- **المشكلة**: `<button onClick={() => onChange(lines.filter(...))}>حذف</button>` — لا تأكيد، لا تراجع. نقرة خاطئة تُسقِط صف مليء بصمت.
- **الإصلاح المطلوب**: اعرض confirm أو (أفضل) toast تراجع لمدة 5 ثوانٍ.
- **معايير القبول**: حذف صف يُظهِر toast تراجع.

---

### F-13 — إضافة `next/dynamic` للمكوّنات الثقيلة
- **الخطورة**: متوسطة
- **الموقع**: `apps/staff/components/` (كامل التطبيق)
- **المشكلة**: `next/dynamic` غير مستخدم إطلاقاً. `recharts` (~200KB) مُستورَد بـeager عبر `components/ui/chart.tsx`. الـassistant chat، الـmodals، الـcharts كلها في bundle المشترك.
- **الإصلاح المطلوب**:
  1. غلِّف `recharts` في `dynamic(() => import(...), { ssr: false })`.
  2. غلِّف `AssistantChat` في dynamic import.
  3. غلِّف الـmodals الثقيلة.
- **معايير القبول**: bundle الـinitial أصغر. `recharts` يُحمَّل فقط في صفحات الـcharts.

---

### F-14 — تشديد CSP في كل التطبيقات
- **الخطورة**: متوسطة
- **المواقع**: `apps/staff/next.config.mjs:54-57`, `apps/platform-admin/next.config.mjs:50-53`, `apps/customer-portal/next.config.mjs`, `apps/marketing/next.config.mjs:50-53`
- **المشكلة**: CSP: `script-src 'self' 'unsafe-eval' 'unsafe-inline'` و`frame-ancestors *`. مع tokens في localStorage، `unsafe-inline` يجعل أي XSS فوري الـtoken-exfiltrating. `frame-ancestors *` يسمح clickjacking.
- **الإصلاح المطلوب**:
  1. احذف `unsafe-eval` و`unsafe-inline`. استخدم nonces/hashes.
  2. اضبط `frame-ancestors 'self'`.
- **معايير القبول**: لا `unsafe-eval`/`unsafe-inline` في CSP. `frame-ancestors 'self'`.

---

### F-15 — إصلاح `sw.js` (stale-while-revalidate + eviction)
- **الخطورة**: متوسطة
- **الموقع**: `apps/staff/public/sw.js:24-32, 39-49, 52-63`
- **المشكلة**:
  - لـ`/_next/*` و`/manifest.webmanifest`: cache-first بلا revalidation → chunks قديمة بعد deploy.
  - لا حد حجم لـ`APP_SHELL`، لا إخلاء.
  - push handler يُصدِر إشعار دائماً حتى لو الـtab مركَّز عليه.
- **الإصلاح المطلوب**:
  1. استخدم stale-while-revalidate لـ`/_next/*`.
  2. أضِف LRU eviction في `activate`.
  3. تحقَّق `clients.matchAll({type:'window'})` وتخطَّى الإشعار لو الـtab مركَّز.
- **معايير القبول**: بعد deploy، المستخدمون يرون الإصدار الجديد خلال زيارة واحدة. لا إشعارات مكررة للـtab المركَّز.

---

### F-16 — إصلاح مسار هجرة IndexedDB
- **الخطورة**: متوسطة
- **الموقع**: `apps/staff/lib/offline-db.ts:88-122`
- **المشكلة**: `DB_VERSION = 1` و`onupgradeneeded` يُنشِئ stores فقط. لا مسار هجرة. عند رفع الإصدار، الـstores الموجودة لن تُحدَّث.
- **الإصلاح المطلوب**: أضِف `switch (event.oldVersion)` migration block. اقرأ `schemaVersion` (موجود في `offline-db.ts:25` لكن غير مقروء).
- **معايير القبول**: رفع `DB_VERSION` يُحدِّث الـstores الموجودة دون فقدان البيانات.

---

### F-17 — تنظيف الفواتير offline المُزامَنة
- **الخطورة**: متوسطة
- **الموقع**: `apps/staff/lib/sync-engine.ts:40-68, 70-78, 85-105`
- **المشكلة**:
  - `syncOfflineInvoices` لا يحذف السجلات المُزامَنة. `clearSyncedOfflineInvoices` موجودة لكن غير مستدعاة. IndexedDB ينمو بلا حدود.
  - `retryOfflineConflict` يعيد المحاولة فوراً بلا backoff ولا max-retry.
  - `startOfflineAutoSync` يعمل كل 10 ثوانٍ حتى لو الطابور فارغ.
- **الإصلاح المطلوب**:
  1. استدعِ `clearSyncedOfflineInvoices()` بعد مزامنة ناجحة (مع فترة سماح).
  2. أضِف exponential backoff + عداد إعادة محاولة على سجلات conflict.
  3. تخطَّى tick لو `offlineQueueCounts().pending === 0`.
- **معايير القبول**: IndexedDB لا ينمو بلا حدود. تعارض دائم يُرفَع للكاشير بدل إعادة المحاولة اللانهائية.

---

### F-18 — إصلاح `openPrintWindow` في بوابة العملاء (XSS)
- **الخطورة**: منخفضة
- **الموقع**: `apps/customer-portal/lib/api.ts:129-136`
- **المشكلة**: `printWindow.document.write(html)` مع HTML خام من الـAPI. لو تسرَّب نص يحوي عميل-متحكَّم به (اسم عميل بـ`<script>`)، ينفَّذ في نافذة بنفس origin الـportal.
- **الإصلاح المطلوب**: اعرض HTML في `<iframe sandbox="allow-same-origin">` (بدون `allow-scripts`) مثل `apps/staff/app/print/[doc]/[id]/page.tsx:119`.
- **معايير القبول**: لا script ينفَّذ في نافذة الطباعة.

---

### F-19 — إضافة صورة OG افتراضية لموقع marketing
- **الخطورة**: منخفضة
- **الموقع**: `apps/marketing/app/layout.tsx:39-46`
- **المشكلة**: الـroot `openGraph` بلا `images`. الصفحات التي لا تُعيد تعريفها تُنتِج مشاركات اجتماعية بلا معاينة. `twitter:card = summary_large_image` لكن بلا صورة.
- **الإصلاح المطلوب**: أضِف صورة OG افتراضية (`/og.png` أو من `shell.ogImageUrl`).
- **معايير القبول**: مشاركة الصفحة الرئيسية تُظهِر معاينة صورة.

---

### F-20 — استخدام `useRouter().push()` بدل `window.location.href`
- **الخطورة**: منخفضة
- **الموقع**: `apps/staff/app/sales/invoices/page.tsx:296, 306, 313`
- **المشكلة**: `window.location.href = ...` يعمل إعادة تحميل كاملة بدل تنقُّل SPA. يكسر الحالة في الذاكرة ويُبطئ.
- **الإصلاح المطلوب**: استخدم `useRouter().push()`.
- **معايير القبول**: التنقُّل بين الفواتير لا يُعيد تحميل الصفحة.

---

### F-21 — تحسين الوصول (Accessibility)
- **الخطورة**: منخفضة
- **المواقع**:
  - `apps/staff/components/app-shell.tsx:277-283` — زر `🔐` بلا `aria-label`
  - `apps/staff/components/app-shell.tsx:198, 229` — `aria-label` لإعادة استخدام `nav.searchPlaceholder`
  - `apps/staff/components/invoice-editor.tsx:214-223, 227-245` — inputs رقمية بلا `<label>` أو `aria-label`
  - `apps/staff/app/accounting/journal-entries/new/page.tsx:348-365` — inputs مدين/دائن بلا label
- **الإصلاح المطلوب**: أضِف `aria-label` لكل زر أيقوني وكل input بلا `<label>` مرئي. أضِف مفاتيح i18n منفصلة (`nav.main`, `nav.menu`, `nav.twoFactor`).
- **معايير القبول**: قارئ الشاشة يُعلن كل عنصر تفاعلي بوضوح.

---

### F-22 — استخراج نصوص الشاشات العربية إلى قاموس i18n
- **الخطورة**: متوسطة
- **الموقع**: `apps/staff/lib/i18n.tsx:8-13` + كل الشاشات
- **المشكلة**: الوحدة موثَّقة كـ"Arabic-first"، فقط ~30 مفتاح chrome في `STRINGS`. كل شاشة لها مئات النصوص العربية المضمَّنة. تبديل اللغة إلى EN يقلب الـshell والـnav لكن جسم الشاشة يبقى عربياً.
- **الإصلاح المطلوب**: إما التزم بالعربية فقط (احذف مفتاح EN)، أو استخرج نصوص الشاشات إلى `messages/ar.json` + `messages/en.json` باستخدام `next-intl`.
- **معايير القبول**: تبديل اللغة يقلب كامل الواجهة (shell + شاشات) بشكل متسق.

---

## القسم 5: أخطاء الكود (Race conditions / Money / Errors)

### C-01 — تجميع `hrm.postRun` / `payRun` في معاملة واحدة
- **الخطورة**: حرجة
- **الموقع**: `apps/api/src/modules/hrm/hrm.service.ts:1418, 1419`
- **المشكلة**: `postRun` يستدعي `accounting.postJournal(...)` (يفتح معاملته الخاصة ويلتزم)، ثم يفتح معاملة منفصلة لتحديث `payrollRuns.status='posted'`. لو فشل التحديث الثاني (deadlock، شبكة)، القيد المالي ملتزم لكن الـpayroll run يبقى `draft` — يتيم محاسبي. `payRun` أسوأ: ينشئ سند، يُرسِل السند، يُحدِّث الـrun في 3 معاملات مستقلة.
- **الإصلاح المطلوب**: استخدم `accounting.postJournalInTx(tx, ...)` (موجودة) داخل `withTenantTx` واحدة تشمل أيضاً تحديث `payrollRuns`. نفس النمط لـ`treasury.createVoucher` + `postVoucher` + تحديث الـrun.
- **معايير القبول**: اختبار يُؤكِّد أن فشل تحديث الـrun يُلغي القيد المحاسبي أيضاً.

---

### C-02 — إصلاح `sales.updateDraft` delete+recreate عبر معاملتين
- **الخطورة**: عالية
- **الموقع**: `apps/api/src/modules/sales/sales.service.ts:418-434`
- **المشكلة**: لفاتورة draft تتغير صفوفها: يحذف كل `salesInvoiceLines` في `withTenantTx` واحدة (L425-429)، ثم يستدعي `this.create()` (L430) الذي يُدرِج الصفوف البديلة في معاملة مختلفة. لو فشل `create()`، الفاتورة تبقى بلا صفوف ولا خطأ للمستخدم — فقد بيانات صامت.
- **الإصلاح المطلوب**: انقل delete + replace إلى معاملة واحدة. مرِّر `tx` إلى helper `replaceLinesInTx`.
- **معايير القبول**: فشل استبدال الصفوف لا يُسقِط الصفوف الموجودة.

---

### C-03 — استبدال `Number()` على قيم مالية في ZATCA UBL والـportal
- **الخطورة**: عالية (امتثال ZATCA)
- **المواقع**:
  - `apps/api/src/modules/einvoicing/zatca/ubl.ts:178-179` — `const lineTotal = Number(line.net ?? 0) + Number(line.tax ?? 0);`
  - `apps/api/src/modules/portal/portal.service.ts:294` — `const remaining = Number(invoice.total) - Number(invoice.paidTotal ?? 0);`
- **المشكلة**: IEEE-754 floating arithmetic على أموال. للقيم SAR الكبيرة (≥ 2^53) أو بعد الضرب، تفقد الدقة بصمت. باقي الكود يستخدم `decimal.js`.
- **الإصلاح المطلوب**: استبدل بـ`new Decimal(line.net ?? '0').plus(line.tax ?? '0')` و`new Decimal(invoice.total).minus(invoice.paidTotal ?? '0')`.
- **معايير القبول**: اختبارات ZATCA تمر مع قيم SAR كبيرة.

---

### C-04 — إدخال helper `tenantDate(now, tz)` للتواريخ فقط-تاريخ
- **الخطورة**: عالية
- **المواقع**:
  - `hrm.service.ts:1050, 1418, 1419`
  - `inventory/inventory.service.ts:1289`
  - `inventory/production-orders.service.ts:45`
  - عشرات `new Date().toISOString().slice(0,10)` عبر الـservices
- **المشكلة**: حقول فقط-تاريخ (تاريخ الترحيل، تاريخ السند، تاريخ دفع الراتب) تُختَم بـ`new Date().toISOString().slice(0,10)` = UTC date. الرياض UTC+3، فالأحداث بين 21:00-24:00 بتوقيت الرياض تُختَم بيوم UTC التالي. ترحيل رواتب الساعة 22:00 بالرياض في 30 يقع في 31 في الدفتر.
- **الإصلاح المطلوب**:
  1. أَدخِل helper `tenantDate(now: Date, tz: string): string` يستخدم `Intl.DateTimeFormat` مع الـtz.
  2. استخدمه في كل مكان يُختَم فيه حقل فقط-تاريخ. اقرأ `tz` من إعداد الـtenant.
  3. أبقِ `Date.now()`/`new Date()` لحقول الـtimestamp.
- **معايير القبول**: تاريخ الترحيل يطابق يوم الرياض حتى بعد 21:00.

---

### C-05 — استبدال `throw new Error(...)` بـ`DomainError` في الـservices
- **الخطورة**: عالية
- **المواقع** (مع العدد):
  - `treasury/bank-feeds.utils.ts` — 12 instance (L104, 134, 149, 156, 161, 174, 183, 193, 195, 202, 204, 218)
  - `hrm/payroll-compliance.ts:155` — IBAN validation
  - `installments/installment-calculator.ts:5, 7`
  - `projects/progress-bill-calculator.ts:11`
  - `marina/marina-pricing.ts:4`
  - `payments/online-payments.ts:48, 175, 180`
  - `ocr/ocr.provider.ts:40, 63`
  - `platform/billing/billing.service.ts` — 6 instances (L26, 28, 36, 40, 42, 46)
  - `platform-services/jobs/outbox.service.ts:52`, `queue.service.ts:50, 102`
  - `inventory/wms-bom.service.ts:120, 131`, `wms-bom.ts:29`, `supplier-portal.service.ts:369`
- **المشكلة**: `throw new Error(...)` يُرجِع 500 بدل 422 لفشل التحقق. للـprovider misconfiguration، يُرجِع 500 بدل 503.
- **الإصلاح المطلوب**: استبدل بـ`throw new DomainError(errorCodes.VALIDATION_FAILED, msg, 422)`. للـprovider misconfiguration استخدم 503 `SERVICE_UNAVAILABLE`.
- **معايير القبول**: لا `throw new Error(...)` في service code. فشل التحقق يُرجِع 422.

---

### C-06 — إصلاح `MetricsService.routes` Map غير محدود
- **الخطورة**: متوسطة
- **الموقع**: `apps/api/src/ops/metrics.service.ts:18, 22-37` + `metrics.interceptor.ts:16`
- **المشكلة**: مفتاح الخريطة `${method} ${route}`. الـinterceptor يرجع إلى `request.path` (URL خام بالمعاملات) عندما `request.route` غير معرَّف. كل UUID فريد في URL → إدخال خريطة. خلال أسابيع يتسرب.
- **الإصلاح المطلوب**:
  - رجوع إلى `request.url.split('?')[0].replace(/\/[0-9a-f-]{8,}/g, '/:id')` (تطبيع UUIDs).
  - أو تخطَّي التسجيل عندما `request.route` غير معرَّف.
  - أضِف مسح دوري للإدخالات الأقدم من X دقيقة.
- **معايير القبول**: حجم الخريطة محدود. لا نمو بلا حدود.

---

### C-07 — استبدال `console.warn` بـNestJS Logger
- **الخطورة**: منخفضة
- **المواقع**: `modules/announcements/announcements.service.ts:413, 495, 547`; `modules/content/content.service.ts:993`; `main.ts:30, 38`
- **المشكلة**: `console.warn(...)` يتجاوز Pino logger المنظَّم (لا request-id، لا tenant context، لا JSON). الـscheduler يعمل في الـworker process فالسجلات إنتاجية حقيقية.
- **الإصلاح المطلوب**: حقن `private readonly logger = new Logger(...)` واستخدم `this.logger.warn(...)`.
- **معايير القبول**: لا `console.warn`/`console.log` في service code (ما عدا main.ts قبل إرفاق Pino).

---

### C-08 — معالجة فشل LLM بصمت في `ai-llm.ts`
- **الخطورة**: منخفضة
- **الموقع**: `apps/api/src/modules/ai/ai-llm.ts:95`
- **المشكلة**: `} catch {` الوحيد في الكود. أي خطأ LLM (مفتاح سيئ، rate limit، شبكة) يُبتلَع ويُسلَّم fallback. لا مقياس، لا سجل — لا تعرف أن AI تدهور لأسابيع.
- **الإصلاح المطلوب**: على الأقل `this.logger.warn({ provider, err: error.message }, 'llm fallback to grounded')` وزِد counter على `MetricsService`.
- **معايير القبول**: فشل LLM مُسجَّل ومرصَد.

---

### C-09 — تنبيه على outbox jobs في حالة `dead`
- **الخطورة**: متوسطة
- **الموقع**: `apps/api/src/modules/platform-services/jobs/outbox.publisher.ts:117-128`
- **المشكلة**: عندما `attempts >= OUTBOX_MAX_ATTEMPTS`، الصف يصير `dead` ويُسجَّل خطأ — لكن لا إشعار لإنسان. الـdead jobs تتطلب فحص DB يدوي.
- **الإصلاح المطلوب**: أصدِر إشعار (عبر `NotificationsService` للـplatform operators، أو webhook Slack) عندما job يصير `dead`.
- **معايير القبول**: job dead يُنشِئ إشعار للمشغِّلين.

---

### C-10 — تنبيه على توقّف الـqueue في outbox
- **الخطورة**: متوسطة
- **الموقع**: `apps/api/src/modules/platform-services/jobs/outbox.publisher.ts:60-64`
- **المشكلة**: لو `queue.isEnabled()` يُرجِع false، `drainOnce` يخرج مبكراً بـdebug log — لكن الصفوف المعلَّقة تتراكم بلا حدود بلا تنبيه. queue driver مُساء تكوينه (Redis down وقت الإقلاع) يبتلع كل حدث عمل بصمت.
- **الإصلاح المطلوب**: أضِف مقياس/فحص صحة يُظهِر `pending` count > threshold. أو افشل سريعاً عند الإقلاع لو `queue.isEnabled()` false لكن `OUTBOX_DRAIN_CRON` مُكوَّن.
- **معايير القبول**: queue معطَّل مع cron مُكوَّن → فشل إقلاع واضح.

---

### C-11 — إضافة `Idempotency-Key` إلزامي لمسارات الـpost الحرجة
- **الخطورة**: منخفضة
- **الموقع**: `apps/api/src/common/interceptors/idempotency.interceptor.ts` + مسارات: `POST /sales/invoices/:id/post`, `POST /hrm/payroll-runs/:id/post`, `POST /treasury/vouchers/:id/post`
- **المشكلة**: idempotency opt-in بـ`Idempotency-Key` header. لا مسار يُلزِمه. إعادة محاولة بلا مفتاح تُرسِل مرتين.
- **الإصلاح المطلوب**: اطلب `Idempotency-Key` على المسارات الحرجة؛ أرجِع 400 بدل الترك المزدوج.
- **معايير القبول**: طلب POST بلا `Idempotency-Key` يُرجِع 400 على المسارات الحرجة.

---

### C-12 — إصلاح فحص توقيع Salla (Buffer.from lossy)
- **الخطورة**: منخفضة
- **الموقع**: `apps/api/src/modules/integrations/salla/salla-utils.ts:5` + `payments/online-payments.ts:65-71`
- **المشكلة**: `verifySallaSignature` يعمل `Buffer.from(signature)` قبل فحص الطول. `Buffer.from(non-hex)` متساهل (يحذف أحرفاً غير صالحة). النمط footgun للنسخ المستقبلي.
- **الإصلاح المطلوب**: هاش الجانبين مرة أخرى (`sha256(a)` مقابل `sha256(b)`) بـ`timingSafeEqual` بطول ثابت 32 بايت.
- **معايير القبول**: لا `Buffer.from(non-hex)` في فحص التوقيع.

---

### C-13 — تنفيذ HaveIBeenPwned k-anonymity
- **الخطورة**: منخفضة
- **الموقع**: `apps/api/src/modules/platform/auth/password-policy.ts:12`
- **المشكلة**: TODO منذ phase:23. deny-list 14 إدخالاً يدوياً. `Password!23` (شائع، يحق قاعدة الـ3 classes) غير مُدرَج.
- **الإصلاح المطلوب**: نفِّذ k-anonymity range API lookup كما يخطط TODO.
- **معايير القبول**: كلمات مرور مُخترَقة (≥ 5 مرات في HIBP) تُرفَض.

---

### C-14 — التحقق من UUID لـ`x-tenant-id` في compat
- **الخطورة**: منخفضة
- **الموقع**: `apps/api/src/modules/compat/compat.controller.ts:27, 31, 35, 39, 43, 47, 51, 55, 59`
- **المشكلة**: `@Headers('x-tenant-id') tenantId: string` بلا تحقق UUID. الـRLS GUC cast `::uuid` يرمي 500 لقيم غير UUID. لا `ZodValidationPipe` للـheaders.
- **الإصلاح المطلوب**: تحقَّق UUID في controller edge (pipe صغير). أرجِع 400 `VALIDATION_FAILED` للقيم المشوَّهة.
- **معايير القبول**: `x-tenant-id` غير UUID يُرجِع 400 بدل 500.

---

## ملخص الأولويات

### حرجة (Critical) — إصلاح فوري
| ID | الوصف |
|---|---|
| S-01 | `DATA_ENC_KEY` fallback إلى سلسلة عامة في 5 modules |
| S-04 | Compat service: sessions, rate limit, pepper |
| C-01 | تجميع `hrm.postRun`/`payRun` في معاملة واحدة |
| F-02 | تمرير refresh token عبر URL في smart-login |

### عالية (High) — إصلاح قبل الإصدار القادم
| ID | الوصف |
|---|---|
| R-01, R-02 | Salla + Stripe webhooks بلا `@Public()` |
| R-03 | مسارا تفعيل الاشتراك مكشوفان |
| R-04, R-05 | خريطة الأسماء المستعارة المفبركة |
| R-06 | `visibleModules` لا تحترم الأسماء المستعارة |
| S-02 | race condition في تدوير refresh token |
| S-03 | 299 `@Body()` بلا ZodValidationPipe |
| S-05 | OTP الـe-sign بلا rate limit/lockout |
| S-06 | HMAC روابط الـbackups بلا nonce/actor |
| S-07 | إرسال كلمات مرور الـsupplier بـplaintext |
| S-08 | rate limiter في الذاكرة + لا `trust proxy` |
| D-01 | `RetentionService` ميت + `audit_log` بلا تجزئة |
| D-10, D-11 | race conditions في `MAX(code)+1` |
| C-02 | `sales.updateDraft` delete+recreate عبر معاملتين |
| C-03 | `Number()` على قيم مالية في ZATCA UBL |
| C-04 | تواريخ فقط-تاريخ بـUTC بدل تزامن الـtenant |
| C-05 | `throw new Error(...)` يُرجِع 500 بدل 422 |
| F-01 | tokens في localStorage/cookie بلا HttpOnly |
| F-04 | `useQuery` قبل فحص `can()` |
| F-05 | `ImpersonationBanner` مفقود في `EmployeeShell` |
| F-07 | لا قائمة بياض لروابط الدفع |
| F-08 | token الدخول المؤقَّت في DOM |

### متوسطة (Medium) — sprint القادم
| ID | الوصف |
|---|---|
| R-07, R-08, R-09 | خطأ `sales.invoices.view`، `EmployeeController`، `tenant.settings.view` |
| S-09, S-11 | NoopVirusScanner، تدقيق الـwebhooks |
| D-02, D-05, D-06, D-12 | down migrations، فهارس، `onDelete`، race conditions |
| F-03, F-09, F-10, F-13, F-14, F-15, F-16, F-17, F-22 | error boundaries، React Query، RHF+Zod، dynamic imports، CSP، sw.js، IndexedDB، i18n |
| C-06, C-09, C-10, C-11 | MetricsService Map، outbox dead/alert، idempotency إلزامي |

### منخفضة (Low) — backlog
| ID | الوصف |
|---|---|
| R-10, R-11 | البذور القديمة، التعليقات المتقادمة |
| S-10 | body size limit |
| D-04, D-07, D-08, D-09, D-13, D-14, D-15 | فهارس صغيرة، FKs، قيود طول، توثيق |
| F-06, F-12, F-18, F-19, F-20, F-21 | تحسينات صغيرة في الواجهة |
| C-07, C-08, C-12, C-13, C-14 | logger، LLM fallback، توقيع، HIBP، UUID compat |

---

## قواعد إضافية للوكيل المُنفِّذ

1. **قبل أي تعديل**: اقرأ `packages/contracts/src/permissions.ts` و`packages/database/src/rls.ts` و`apps/api/src/modules/platform/guards/permissions.guard.ts` لفهم نمط الـRBAC.
2. **الالتزام بالاسم**: لا تُغيِّر أسماء الرموز (`tenant.*`, `console.*`) دون ADR.
3. **الاختبارات**: لكل بند، تأكَّد أن الـspec الموجود (`*.spec.ts`) يبقى مُنجَزاً. أضِف specs جديدة لكل بند حرج/عالي.
4. **الـmigrations**: أي تغيير schema يتطلب migration جديد مرقَّم (التالي: `0113_*.sql`).
5. **الـdown migrations**: أي migration جديد يجب أن يُرفَق بـ`down/<n>_*.down.sql`.
6. **التوثيق**: حدِّث `docs/` لكل قرار معماري. أضِف ADR لكل تغيير حرج.
7. **التحقق النهائي**: بعد كل بند، شغِّل `pnpm verify` (إن وجد) أو `pnpm test` و`pnpm lint`.

---

## ختام

هذا الملف يُغطّي **86 بنداً** موزَّعة على خمسة أقسام. كل بند قابل للتنفيذ المستقل. الإصلاحات الحرجة (Critical) يجب أن تُنجَز قبل أي deploy إنتاجي. الإصلاحات العالية (High) يجب أن تُنجَز قبل الإصدار القادم. البقية يُمكن جدولتها عبر sprints.

> **ملاحظة**: لم تُجرَ أي تعديلات على المشروع. هذا الملف للتسليم إلى وكيل ذكاء اصطناعي آخر للتنفيذ.
