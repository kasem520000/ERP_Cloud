# المرحلة 3 — الشريحة 1: شاشة الإنتاج في تطبيق المخابز + إصلاحات كشفها التشغيل الحيّ

التاريخ: 2026-10-14 · الفرع: `arena/3e37b812-erp-cloud` · آخر commit قبل هذه الشريحة: `f290022`

> قاعدة العمل: تطبيق المخابز **سطحٌ رقيق فوق نفس الـ API** — لا قواعد جديدة، لا جداول جديدة
> لمفاهيم موجودة، لا محرّك محاسبة/مخزون ثانٍ. كل ما في هذه الشريحة شاشاتٌ تقرأ وتكتب عبر
> `apps/api` نفسه، وأذونات `@erp/contracts` نفسها، وبوابة الترخيص نفسها.

---

## 1) ما بُني

### 1.1 `packages/web-van` — عقد الإنتاج المشترك (مصدر واحد للسطرين)

نُقلت منطقية الإنتاج من `apps/staff/lib/van-production.ts` إلى حزمة جديدة `packages/web-van`
حتى لا يُنسخ العقد بين تطبيقين (`staff` و`bakery`)، وليبقى `apps/staff/lib/van-production.ts`
جسرًا انتقاليًا من سطرٍ واحد يعيد التصدير.

| الملف | المحتوى |
|---|---|
| `packages/web-van/src/production.ts` | `ProductionBatchDraft/Payload/Verdict`، `PRODUCTION_MESSAGES`، `num()`، `buildProductionBatchPayload`، `OfficialStockRowForEstimate`، `ComponentCostEstimate`، `estimateComponentCost` |
| `packages/web-van/tests/production.spec.ts` | 10 حالات |

خصائص العقد المُثبتة بالاختبار: ترتيب التحقّق **الصنف ← الكمية ← الهالك/سببه ← المكوّنات**؛
صفّ مكوّنات فارغ يُتجاهل ونصف المملوء يُرفض؛ الكميات `toFixed(4)`؛ `batchNo`/`warehouseId`/
`productionDate` تُرسل `undefined` حين تكون فارغة؛ **العقد لا يرسل `unitCost` أبدًا** (التكلفة
يقرّرها الخادم من رصيد المستودع الرسمي، لا ما يُكتب في الشاشة).

### 1.2 شاشة الإنتاج `apps/bakery/app/production/page.tsx` (557 سطرًا)

* البوابة: `useSession().can('van_sales.production.manage')` للنموذج، و`can('van_sales.view')`
  (`canView`) لتجنّب طلبٍ مآله 403 مؤكَّد.
* البيانات: `GET /van-sales/dashboard` + `Promise.allSettled` على `GET /organization/catalog/items`
  و`GET /warehouses` (بحثا الشاشة)، أي أنّ فشل بحثٍ لا يُسقط الشاشة.
* المكوّنات: صفوف قابلة للزيادة، سبب الهالك إلزامي إذا كانت كميته > 0، لوحة تقدير تكلفة حيّة
  (`estimateComponentCost`) مع تحذير `unvalued` حين لا قيمة للمادة في الرصيد.
* قبل الإرسال: `buildProductionBatchPayload` ونتيجته تُعرض **حرفيًا** (لا تُبلَع الرسالة).
* الإرسال: `apiPost<DashboardPayload>('/van-sales/production-batches', …)`؛ لأنّ الخادم يعيد
  حمولة اللوحة كاملةً في المسارين (العادي وتكرار المفتاح) فإنّ أحدث دفعة = `productionBatches[0]`.
* الجدول: يعرض صفوف الخادم فقط؛ `—` لأيّ رقمٍ غير موجود، والقيمة الخام لأيّ `enum` غير معروف
  (لا اختراع تسميات).
* بطاقة «سلوك الخادم كما هو»: حركة `production_in`، صفّ هالك منفصل `van_damage`، أولوية أساس
  التكلفة، **الحياد المحاسبي حين لا تكون حسابات الإنتاج مربوطة**، وأنّ الشاشة لا ترسل `unitCost`.

### 1.3 غراء الشاشة النقي + التنقّل

| الملف | المحتوى |
|---|---|
| `apps/bakery/lib/production-screen.ts` | `numberText`، `itemLabel`، `warehouseLabel`، `pickDefaultWarehouse`، `mapOfficialStock`، `batchStatusLabel`، `costBasisLabel`، `emptyComponentRows`، `todayIsoDate` |
| `apps/bakery/tests/production-screen.spec.ts` | 6 حالات |
| `apps/bakery/lib/navigation.ts` | `production` انتقلت إلى `status:'ready'`، `href:'/production'`، `phaseAr:'المرحلة 3 — مبنيّة'` + مسارَي البحث |
| `apps/bakery/tests/navigation.spec.ts` | تثبّت `readyModules()` = `['overview','production']` ومطابقة المسار بحدود المقطع |

`ready` ⇔ وجود `app/**/page.tsx` حقيقي: لا تُعلن وحدةٌ جاهزةً بلا صفحة.

### 1.4 أسلاك الحزمة الجديدة

`transpilePackages` في `apps/{staff,bakery}/next.config.mjs`، و`test.server.deps.inline` في
`vitest.config.ts` (الحزم تصدر `.ts` خامًا)، واعتمادية `@erp/web-van` في التطبيقين، وإضافة
`packages/web-van` إلى `deploy/Dockerfile.web` و`deploy/Dockerfile.api` (الملفان يعدّان كل
حزمة بالاسم قبل `pnpm install --frozen-lockfile`؛ حزمةٌ غير مُدرجة تكسر الصورة على `workspace:*`).

---

## 2) القياسات (أوامر منفَّذة فعليًا)

| الحزمة/التطبيق | typecheck | lint | tests | build |
|---|---|---|---|---|
| `packages/web-van` | 0 | 0 | 10 ✅ | — |
| `apps/staff` | 0 | 0 | **94** ✅ (كانت 102: −10 انتقلت إلى `web-van`، +2 جسر) | 0 (180 صفحة) |
| `apps/bakery` | 0 | 0 | **21** ✅ (navigation 6، production-screen 6، licence 5، licence-wall 4) | 0 (`/` 4.89 kB، `/production` 7.14 kB، ثابتة) |
| `apps/platform-admin` | 0 | 0 | **27** ✅ | — |
| `apps/api` | 0 | 0 | المجموعة الكاملة في §9 + `console-api-routes` 3 ✅ | — |
| **المستودع كله** (`pnpm -r`) | **0** (14 مشروعًا) | **0** (14 مشروعًا) | — | — |

---

## 3) دليل التشغيل الحيّ (E2E عبر وكيل تطبيق المخابز نفسه)

المنظومة: Postgres 16 مدمج (127 migrations) ← `apps/api` على `0.0.0.0:3000` ← `apps/bakery`
على `0.0.0.0:3005` مع `API_PROXY_TARGET=http://127.0.0.1:3000`. **كل النداءات أدناه مرّت عبر
`:3005/api/v1`** (أي عبر وكيل التطبيق نفسه، لا مباشرة إلى الـ API) بمستخدم `owner@demo.test`.

| # | النداء | النتيجة |
|---|---|---|
| 1 | `POST /auth/login` | 200 Bearer، `tenants:['demo']` |
| 2 | `GET /me` | 200، `enabledApps: []`، 179 صلاحية، `isOwner:true` |
| 3 | `GET /van-sales/dashboard` | **200 بلا ترخيص** — تأكيدٌ حيّ لفجوة §3.1 (أدناه) |
| 4 | `POST /marketplace/apps/bakery_distribution/install` | **403 `ADDON_REQUIRES_PLATFORM_APPROVAL`** |
| 5 | `POST /marketplace/apps/bakery_distribution/request` | 201، `status:'pending'` (بلا `data.id` — يُؤخذ من قائمة المنصة) |
| 6 | `GET /platform/marketplace/requests?status=pending` (منصّة) | 200، صفّ واحد `bakery_distribution/demo/pending` |
| 7 | `POST /platform/marketplace/requests/:id/decide {approved}` | 201، `status:'approved'` |
| 8 | `GET /me` بعد القرار | 200، **`enabledApps:['bakery_distribution']`** ← قناة الترخيص تعمل من طرفٍ إلى طرف |
| 9 | `GET /platform/marketplace/tenants/:id/apps` (المسار الجديد) | 200، `enabled:true`، `installedAt` مُعبّأ |
| 10 | نفس المسار بمستخدم المنشأة | **403 `FORBIDDEN`** (حارس المنصة) |
| 11 | `GET /marketplace/apps` | 200، `enabled:true`، `requestStatus:'approved'`، «المخابز: الإنتاج والتوزيع» |
| 12 | `GET /organization/catalog/items` (بحث الشاشة) | 200 |
| 13 | `GET /warehouses` (بحث الشاشة) | 200، «المستودع الرئيسي» |
| 14 | `POST /van-sales/production-batches` بلا `itemId` | 422 «اختر الصنف المنتج من الأصناف المسجلة…» |
| 15 | `GET /van-sales/dashboard` | 200، `productionBatches:0`، `officialStock:0`، `policy.productionCostBasis:null` |
| 16 | `GET http://127.0.0.1:3005/production` | **200** (كان 404 بحكم التصميم في المرحلة 2) والـ HTML يحمل «الإنتاج» |

### 3.1 إثبات القرار (ب) حيًّا: دفعة بلا مواد = رفض

بعد إنشاء صنفين في `demo` (`دقيق قمح`/`خبز عربي`) عبر نفس الوكيل:

| # | الحالة | الاستجابة |
|---|---|---|
| 20 | `itemId` + `producedQty` **بلا `bomId` وبلا مكوّنات** | **422 `VAN_PRODUCTION_INPUT_REQUIRED`**: «دفعة الإنتاج تحتاج مصدراً للمواد: اربطها بقائمة مواد (BOM) أو أدخل المكوّنات المصروفة… لا تُسجَّل دفعة إنتاج بلا مواد لأنها تُدخل مخزوناً من غير مصدر» |
| 21 | مكوّن **بلا رصيد مُقيَّم** | **422 `VAN_PRODUCTION_COST_REQUIRED`**: «مواد هذه الدفعة لا قيمة لها في رصيد المستودع… فلا يمكن لرقمٍ يُكتب في هذه الشاشة أن يصير تكلفةً رسمية» |
| 23 | `producedQty = 0` | 422 «أدخل كمية الإنتاج اليومية بالكيلو (أكبر من صفر)» |
| 24 | المكوّن = المنتج | 422 (رسالة التكلفة — انظر §5.3) |
| 25 | هالك بلا سبب | **422 `VAN_PRODUCTION_SCRAP_REASON_REQUIRED`** |
| 26 | اللوحة بعد كل الرفضات | `productionBatches:0`، `officialStock:0` ← **الرفض لم يكتب شيئًا** |

### 3.2 حدود هذا الدليل (بصراحة)

* **مستوى HTTP فقط**: لا متصفّح ولا تنفيذ JavaScript. هو يثبت السلسلة
  «وكيل التطبيق ← الـ API ← قاعدة البيانات الحقيقية» وصحة الرسائل والأكواد، **ولا يثبت**
  سلوك المكوّنات داخل المتصفّح (الرسم، الحالات، الأزرار). تلك مُغطّاة باختبارات الوحدات
  (21 في `bakery`) وببناء `next build` الناجح — ولا شيء منهما متصفّح.
* لم تُنشأ دفعة إنتاج **ناجحة** لأن ذلك يتطلّب رصيدًا مُقيَّمًا للمواد (فاتورة شراء/رصيد افتتاحي
  مُسعَّر)، والبذرة لا تنشئ أصنافًا. الرفض المُثبَت أعلاه هو السلوك المطلوب في القرار (ب)؛
  ومسار النجاح مُغطّى باختبارات الـ API الموجودة.
* البيانات التي كُتبت في قاعدة التطوير المحلية (وليست إنتاجًا): 6 أصناف في `demo`
  (`FLOUR-01`، `BREAD-01`، `SALT-01`، `TEST-SALE`، `TEST-PUR`، `TEST-PLAIN`)، وتفعيل
  `bakery_distribution` لمنشأة `demo` مع طلبٍ معتمد.

---

## 4) فجوة الترخيص القطاعي (§3.1 من تقرير المرحلة 2) — ما زالت مفتوحة، ومُقاسة حيًّا

السطر 3 أعلاه: `GET /van-sales/dashboard` أعاد **200 لمنشأة لم تكن تملك أيّ ترخيص**
(`enabledApps: []`). السبب كما هو في الكود: لا شيء خارج `modules/marketplace` يقرأ
`tenant_apps`؛ نقاط القطاع محميّة بـ `@RequiresPermissions` فقط، والترحيل `0126` منح الأدوار
القائمة أكواد `van_sales.*`. الترشيح الموجود حاليًا **في الواجهة فقط**
(`apps/staff/components/app-shell.tsx:330`، `lib/navigation.ts:2291`)، وإخفاء زرٍّ ليس ضبط وصول.

القرار المتّخذ (مفوّضٌ لي من المستخدم): تنفيذ **(ب) فرض الترخيص على الخادم** +
**(ج) وضع `observe` أولًا** للأكواد القائمة (تسجيلٌ في التدقيق بلا منع، يُرى في
`platform-admin/audit`) و`enforce` للأكواد الجديدة مثل `bakery_distribution`. لم يُنفَّذ بعد —
هو الشريحة التالية في المرحلة 3، لأنه يمسّ منشآتٍ قائمة ويحتاج قياسًا قبل المنع.

---

## 5) أعطالٌ حقيقية كشفها التشغيل الحيّ (وأُصلحت)

### 5.1 لوحة المنصة كانت تدير الباقات على مساراتٍ غير موجودة

الـ controller هو `@Controller('platform/marketplace')`، بينما أربعة مواضع في `apps/platform-admin`
تنادي `/marketplace/platform/…`:

| الموضع | كان | صار |
|---|---|---|
| `app/page.tsx:108` (طلبات معلّقة في الرئيسية) | `GET /marketplace/platform/requests?status=pending` | `GET /platform/marketplace/requests?status=pending` |
| `components/platform-guard.tsx:222` (جرس التنبيهات) | نفسه، **مع `.catch(() => [])`** فبدا «لا طلبات» بدل أن يبدو عطلًا | نفسه مُصحَّحًا |
| `app/tenants/[id]/page.tsx:941` (باقات العميل) | `GET /marketplace/platform/tenants/:id/apps` — **المسار غير موجود أصلًا في الـ API** | `GET /platform/marketplace/tenants/:id/apps` (أُضيف، §5.2) |
| `app/tenants/[id]/page.tsx:964` (تفعيل/إيقاف) | `POST /marketplace/platform/tenants/:id/apps {code, enabled}` — بادئة وفعل وشكل خاطئة | `PUT /platform/marketplace/tenants/:id/apps/:code {enabled}` |

إثباتٌ حيّ: `GET /marketplace/platform/requests?status=pending` → **404 `Cannot GET …`**،
بينما `GET /platform/marketplace/requests?status=pending` → **200** ومعها الطلب المعلّق.
أي أنّ **إدارة الباقات القطاعية في الكونسول لم تعمل قطّ**، ومنها تفعيل/إيقاف
`bakery_distribution` لعميل — وهو متطلّبٌ صريح في طلب المستخدم («مرتبطة بلوحة المنصة»).

### 5.2 مسار القراءة الناقص: `GET /platform/marketplace/tenants/:tenantId/apps`

الشاشة موجودة في الكونسول ولا مصدر بيانات لها، فأُضيف المسار:
`MarketplaceService.platformTenantApps()` + `MarketplacePlatformController` (بحارسَي
`PlatformAdminGuard` و`console.marketplace.manage`). يعيد
`{tenantId, tenantCode, tenantName, apps:[{code, nameAr, icon, monthlyPrice, requiresApproval, enabled, installedAt}]}`
لباقات القطاع الثمانية.

**الدرس المُكلف (RLS):** أول تنفيذ قرأ `tenant_apps` داخل `withPlatformAdminTx` فأعاد
`enabled:false` لباقةٍ مفعَّلة — لأنّ سياسة العزل على الجدول
(`0109_marketplace_white_label.sql:88`) هي
`USING (tenant_id = nullif(current_setting('app.tenant_id'),'')::uuid)` **بلا استثناءٍ للمنصة**،
ومع `FORCE ROW LEVEL SECURITY` لا تُرى أيّ صفوف من مستوى المنصة. القراءة الصحيحة داخل
`withTenantTx(db, tenantId, …)` — وهو النمط المستعمل في بقية الملف نفسه عند **كتابة**
`tenant_apps` من مستوى المنصة (الصلاحية يحسمها حارس الكونسول قبل ذلك). الأسعار تُقرأ في
مستوى المنصة (`marketplace_apps`) والصفوف في مستوى المنشأة. أثبتت الحالة الاختبارية الجديدة
أنّ ما تراه المنصة يساوي ما في الجدول (انظر §6).

### 5.3 `apps/staff`: قائمة المندوبين في قيد اليومية كانت 404 صامتة

`apps/staff/app/accounting/journal-entries/new/page.tsx:85` كان ينادي
`apiData('/employees').catch(() => [])` — و`GET /api/v1/employees` **غير موجود**:

```
GET /api/v1/employees          → 404 {"code":"NOT_FOUND","detail":"Cannot GET /api/v1/employees"}
GET /api/v1/hrm/employees      → 200 []
```

فكانت قائمة «المندوب» في شاشة قيدٍ جديد **فارغة دائمًا** بلا أيّ أثرٍ للعطل. الإصلاح: استعمال
`listEmployees()` الموجودة أصلًا في `apps/staff/lib/lookups.ts:382`
(`apiList<Employee>('/hrm/employees')`) وحذف النوع المحلي المكرّر.

صحة المصدر مؤكَّدة من المخطط: `journal_entry_lines.salesman_id` مفتاحٌ أجنبي إلى
`employees(id)` (`packages/database/src/schema/accounting.ts:168`) — أي أنّ الموظف من HRM هو
المصدر الصحيح، لا جدول `salesmen`.

التسامح المتبقّي مقصود: منشأةٌ بلا حزمة HRM أو مستخدمٌ بلا `hrm.view` يرى قائمةً فارغة،
والحقل اختياري — وهذا مُوثَّق في تعليق الموضع نفسه.

### 5.4 حارسٌ دائم ضدّ هذا الصنف كله: `apps/api/test/console-api-routes.spec.ts`

الاختبارات الوحدوية للـ API تنادي المسارات الصحيحة فلا ترى خطأ الواجهة، واختبارات الواجهات
تُحاكي `apiFetch` فلا ترى الجدول الحقيقي. الاختبار الجديد يقرأ **جدول المسارات من ملفات
الـ controllers نفسها** (1037 مسارًا) ويقارنه بكل نداءٍ حرفي في
`platform-admin` و`bakery` و`customer-portal` و`staff`، فيسقط على: بادئة خاطئة، فعل HTTP خاطئ،
مقطع زائد/ناقص.

يتعامل مع أشكال الكود الحقيقية: أكثر من `@Controller` في الملف الواحد (يُنسب كل فعلٍ لأقرب
`@Controller` سابق)، قائمة المسارات المترادفة (`@Get(['approval-workflows','approvals/workflows'])`)،
تجاوز الفعل (`apiData(path, { method: 'POST' })`)، القوالب `${id}` كمقاطع متغيّرة، وباني
سلسلة الاستعلام (`?kind=${kind}`، `${queryString}`) الذي يُقطَّع عنده المسار ويُقارن بالبادئة.

**حدوده المعلَنة:** يفحص النداءات ذات المسار الحرفي فقط، ويتجاهل المسارات المبنية باللصق
(`'/x/' + id + '/y'`) لأنه لا يستطيع حسْم شكلها من النص.

قبل الإصلاحات كان يسقط؛ الآن **3/3 أخضر**، أي أنّ كل نداءٍ حرفي في الواجهات الأربع له مسارٌ
حقيقي بنفس الفعل. (أثناء ضبطه أنتج 16 إنذارًا تبيّن أنّ 9 منها أخطاءٌ في المستخرِج نفسه —
ملفات بعدّة controllers، والمسارات المترادفة، وقصّ `?.` داخل `${}` — ولم تُلمس تلك الشاشات؛
العطلان الحقيقيان وحدهما أُصلحا.)

### 5.5 assertion هشّ في اختبارات الـ API (كان يُسقط المجموعة كاملة صدفةً)

`apps/api/test/platform-content.spec.ts:433` كان
`expect(JSON.stringify(body)).not.toContain('500')` — والبحث في نصّ الاستجابة يلتقط
`traceId` ست عشريةً عشوائية، وقد احتوت «500» صدفةً
(`"traceId":"01a13c4a-83c4-7403-b52c-0b22a9b500ed"`) فسقط الاختبار وهو سليم السلوك
(الاستجابة 422 صحيحة). المقصود «ليس عطل 500»، فقيل الآن من حقول الاستجابة نفسها:
`expect(body.status).toBe(422)` و`expect(body.code).toBe('VALIDATION_FAILED')`.
(موضعٌ آخر `platform-developer.spec.ts:591` يفحص `toContain('500')` أيضًا لكنه **سليم**:
الاختبار يضبط مستقبل webhook على `receiverStatus = 500` ويتحقّق من تسجيله، فالرقم مقصود لا عرضي.)

### 5.6 تصحيح توثيقي

`apps/bakery/lib/licence.ts` كان يذكر المسار الخاطئ
`POST /marketplace/platform/requests/:id/decide` في تعليقه → صُحّح إلى
`POST /platform/marketplace/requests/:id/decide`.

---

## 6) الاختبارات الجديدة

| الملف | الحالات |
|---|---|
| `apps/api/test/console-api-routes.spec.ts` (جديد) | 3: قراءة الجدول (ويثبت أنّ `/marketplace/platform/requests` **غير** موجود)، وجود نداءاتٍ كافية حتى لا يمرّ الاختبار وهو لا يفحص شيئًا، ومطابقة كل نداءٍ حرفي |
| `apps/api/test/marketplace-sector-licensing.spec.ts` (+3، المجموع 15) | قراءة المنصة لباقات منشأة = ما في `tenant_apps` قبل التفعيل وبعده (مع `installedAt`)؛ القراءة platform-only (مالك المنشأة 403، ودور كونسول بلا `console.marketplace.manage` 403)؛ 404 لمنشأةٍ غير موجودة ولمعرّفٍ مشوَّه (بلا تعداد معرّفات) |
| `packages/web-van/tests/production.spec.ts` | 10 (منقولة من `staff` كما هي) |
| `apps/staff/lib/van-production.spec.ts` | 2 (الجسر الانتقالي) |
| `apps/bakery/tests/production-screen.spec.ts` | 6 |

---

## 7) ملاحظاتٌ رُصدت ولم تُغيَّر (مع السبب)

1. **ترتيب التحقّق في الخادم يحجب الرسالة الأدق:** حين تكون المواد غير مُقيَّمة، تُعاد
   `VAN_PRODUCTION_COST_REQUIRED` حتى لو كان المكوّن هو المنتج نفسه
   (الحالة التي تستحق `PRODUCTION_COMPONENT_IS_OUTPUT`). الرفض صحيحٌ في الحالتين ولا خطر على
   البيانات، وعقد العميل في `web-van` يفحص المكوّنات **قبل** التكلفة فيرى مستخدم شاشة المخابز
   الرسالة الأدق. تغيير ترتيب تحقّقات الخادم يمسّ اختباراتٍ قائمة بلا مكسبٍ للمستخدم الآن.
2. **`POST …/requests/:id/decide` يعيد `{id, status, appCode, tenantId}` بلا `decidedAt`**،
   بينما `GET …/requests` يعيده. الكونسول يعيد القراءة بعد القرار فلا يظهر خطأ؛ توحيد شكل
   الاستجابة تحسينٌ صغير يُترك لوقته.
3. **شذوذٌ لم يُستنسَخ:** `POST /organization/catalog/items` أعاد **500 مرتين** (صنفان
   بأسعار) بينما الصفّان كُتبا كاملين بأسعارهما، ثمّ أعادت نفس الأجسام **201** فورًا بعدها
   (`BREAD-01.salePrice = 1.0000`، `FLOUR-01.purchasePrice = 4.0000` مُثبَّتة في القاعدة).
   لا إعادة تشغيل للخادم بينهما (معرفات الطلبات في السجل متسلسلة بلا انقطاع)، وسجلّ الخادم
   لتلك اللحظة لم يُلتقط. **لا أدّعي سببًا.** يُسجَّل كأثرٍ يستحق المتابعة، وهو حجةٌ عملية
   إضافية على حاجة الكتابات إلى مفاتيح idempotency (المخطط لها في طابور المرحلة 4 دون الاتصال):
   500 بعد التزامٍ يعني أنّ إعادة المحاولة قد تُنتج تكرارًا (هنا كان سينجو قيد `sku` الفريد بـ 409).
4. **عدم اتساق شكل الاستجابة:** `GET /organization/catalog/items` و`/categories` و`/units`
   تعيد **مصفوفةً عارية**، بينما `/warehouses` و`/van-sales/dashboard` و`/marketplace/apps`
   تعيد `{data:…}`. `apiList` في `@erp/web-core` يتعامل مع الاثنين، وشاشة الإنتاج تستخدم
   `apiList` — فلا عطل. لكنه اختلافٌ في العقد يستحق التوحيد لاحقًا.
5. **فجوة الترخيص القطاعي (§4)** — مفتوحة بقرارٍ مؤجَّل إلى الشريحة التالية.

---

## 8) التالي

1. **فرض الترخيص على الخادم** (§4): حارس `SectorLicenceGuard` بقائمة `any-of`
   (`van_sales` أو `bakery_distribution`)، ووضع `observe` مُدقَّق للأكواد القائمة قبل `enforce`.
2. بقية شاشات المرحلة 3: عهدة التحميل (`load-orders`)، مستندات التوزيع والمرتجعات، التحصيل
   والخزنة، وإغلاق العهدة — بنفس قاعدة «شاشاتٌ لا قواعد».
3. المرحلة 4: `/rep` كتطبيق PWA يعمل دون اتصال (طابور بمفاتيح idempotency، مزامنة عند العودة،
   ربط جهاز، وتسليم جلسة).

---

## 9) نتائج التشغيل الكامل — بالأرقام والإخفاقات

### 9.1 المجموعة الكاملة لـ `apps/api` (تشغيلان)

| التشغيل | النتيجة | التفصيل |
|---|---|---|
| الأول (21:19–21:27 UTC) | `Test Files 3 failed \| 197 passed (200)`، `Tests 10 failed \| 1677 passed (1687)` | الإخفاقات: (1) حالتي الجديدة في `marketplace-sector-licensing` — توقّعتُ 404 لمعرّفٍ مشوَّه بينما المدقّقة العامة تجيب **400**؛ صُحّح التوقّع. (2) `platform-content` — الـ assertion الهشّ (§5.5). (3) `platform-support` — خطأ `pg` غير مُعالَج عند التفكيك («terminating connection due to administrator command»). |
| إعادة تشغيل الملفات الأربعة وحدها | `Test Files 4 passed`، **`Tests 50 passed (50)`** | `marketplace-sector-licensing` 15، `console-api-routes` 3، `platform-content`، `platform-developer` — أي أنّ (2) و(3) هشّان/بيئيان لا أعطال سلوك. |
| الثاني بعد الإصلاحات (21:35–21:43 UTC) | `Test Files 1 failed \| 199 passed (200)`، `Tests 8 failed \| 1679 passed (1687)` + خطئا `pg` عند التفكيك | الملف الواحد هو `test/employee-movements.spec.ts` — انظر §9.2. |

الحساب: 1681 (الأساس) + 3 (عقد المسارات) + 3 (حالات القراءة الجديدة) = **1687** ✅.

### 9.2 الإخفاق المتبقّي: `employee-movements` — نافذةٌ زمنية وقرارٌ تجاري مفتوح

ثماني حالاتٍ تسقط **فقط بين ~21:00 و24:00 UTC**، والدليل من رسالة الإخفاق نفسها:

```
× كشفٌ فارغ قبل أي حركة → expected '2026-10-15' to be '2026-10-14'   (والساعة 21:40 UTC)
```

السبب: الخدمة تؤرّخ الحركات **بتقويم المنشأة** —
`tenant_settings['locale.timezone']` ← `tenants.timezone` ← `'Asia/Riyadh'` مع
`new Intl.DateTimeFormat('en-CA', { timeZone: tz })` (`apps/api/src/modules/hrm/hrm.service.ts:1050-1078`) —
بينما الاختبار يحسب «اليوم» بـ `new Date().toISOString().slice(0,10)` أي **UTC**. عند 21:40 UTC
يكون التقويم السعودي في 00:40 من اليوم التالي، فتسقط الحالات الثماني (اليوم المختلف ← المدى
فارغ ← بقية التوقّعات). هذا **قائمٌ قبل هذه الشريحة** ولا علاقة له بتغييراتي.

**ما لم أفعله ولماذا:** جرّبتُ محاذاة الاختبار مع تقويم المنشأة
(`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' })`) — فأصلح حالة التاريخ الصريحة،
لكنّه كشف أنّ **الفواتير تُؤرَّخ بخلاف الحركات** داخل النافذة نفسها (فسقطت حالةٌ كانت ناجحة:
«اليوم الأخير داخل المنطقة»). أي أنّ الخضرة هنا تحتاج قرار «تأريخ المستندات: UTC أم تقويم
المنشأة» — وهو **قرارٌ تجاري محجوز للمستخدم** (§10 من تقرير المرحلة 2 وقائمة القرارات
المفتوحة)، لا إصلاحٌ اختياري. لذلك **أُعيد الملف كما كان** (`git checkout --`) بدل ترك نصف
إصلاحٍ يُخفي الفرق، وبقي الإخفاق ظاهرًا ومُبلَّغًا.

### 9.3 بقية الفحوص

| الفحص | النتيجة |
|---|---|
| `pnpm -r run typecheck` (14 مشروعًا) | **0 أخطاء** |
| `pnpm -r run lint` (14 مشروعًا) | **0 مشكلة** |
| `apps/staff` build | 0 (180 صفحة) |
| `apps/bakery` build | 0 (`/` 4.89 kB، `/production` 7.14 kB) |
| الوكيل الحيّ `GET :3005/api/health/live` | 200 `{"status":"ok","service":"api"}` |
| الصفحة الحيّة `GET :3005/production` | 200 |

ما **لم** يُفحص: أيّ سلوكٍ داخل متصفّح (لا Playwright في هذه البيئة، ومنفذ الـ CDN محجوب)،
وتطبيق/تراجع الترحيلات على قاعدة اختبار (لا ترحيلاتٍ جديدة في هذه الشريحة — لم تُضف أيّ
migration، فلا حاجة لذلك).
