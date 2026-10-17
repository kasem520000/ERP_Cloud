# وثيقةُ التسليم — تطبيقُ المخابز `apps/bakery` والمرحلةُ الرابعة

> **الغرضُ من هذا الملفّ**: أن يستأنف أيُّ جلسةٍ جديدة (أو أيُّ مطوّرٍ آخر) العملَ من حيث
> وقف، بلا ذاكرةٍ عن المحادثة السابقة. فهو يقول أين نحن، وما الذي تقرّر فلا يُسأل مرّةً
> أخرى، وما الذي تبقّى وبأيّ قياساتٍ معلومة، وما الفخاخُ التي كلّفت وقتًا.
>
> آخرُ تحديث: **2026-10-16** بعد الشريحة ١٧ (الترحيلُ إلى نظام التصميم) — وبعد ١٦ج (مسحُ مرشّحات التاريخ في ٣٨ مسارًا: ١٥ كانت ٥٠٠ و٤ كانت تُسقط المرشّح بصمت) — وبندُ ب١ أُقفل في ١٦أ (بندُ ب١: عجزُ الموظّف كان يُقيَّم بسعر البيع وسياسةُ المالك تقول «بالتكلفة») — **المرحلةُ
> الرابعةُ مكتملةٌ في الكود: شاشةُ `/rep` مبنيّةٌ وتعمل متصلّةً ومنقطعةً بطابور،
> و`manifest` وعاملُ خدمةٍ قابلان للتثبيت، وطبقةُ تصميمٍ للجوال بأرقامٍ مثبّتة. وما
بقي من المرحلة ليس كودًا: **جهازٌ حقيقيّ** يثبّت التطبيقَ ويفتحه منقطعًا (فلم يُفتح
متصفّحٌ ولا هاتفٌ في هذه البيئة)، وقرارٌ للمالك في الإرسال التلقائيّ عند عودة الشبكة،
وأيقوناتٌ نقطية، وأتمتةُ اسم الكاش — وتفصيلُها في §١٤ج من التقرير وفي §٤ تحت. والتفاصيلُ الطويلة لكلّ شريحةٍ في
> `docs/BAKERY_APP_PHASE3_SLICE4_REPORT.md` (‏٣٣٤٩ سطرًا — من `wc -l` لحظة الكتابة) والتصميمُ في
> `docs/BAKERY_APP_PHASE3_SLICE4_DESIGN.md`.

---

## ٠. كيف تستأنف (خطواتٌ حرفية)

المستودعُ `kasem520000/ERP_Cloud`، والفرعُ **`arena/3e37b812-erp-cloud`** (جلسةُ Arena
مثبّتةٌ عليه؛ لا تُنشئ فرعًا آخر ولا تدفع لغيره). وآخرُ التزامٍ مدفوع وقتَ كتابة هذا
الملفّ: **`89643ee`** (تحقّق بـ`git log --oneline -1`).

### إن كانت البيئةُ سليمة

```bash
cd /home/user/ERP_Cloud
export PATH=/tmp/bin:$PATH          # إن وُجد /tmp/bin/pnpm
corepack pnpm install --prefer-offline
```

### إن استُعيدت لقطةُ البيئة (حدث ذلك مرارًا — وآخرُها في منتصف الشريحة ٢٣)

علاماتُه: ‏`git log --oneline -1` يُظهر **`b3ab381`** (نقطةَ الأساس) لا آخرَ التزامٍ لك،
و`git status` يُظهر مئاتِ الملفات «المعدّلة»، و`node_modules` و`.env` و`/tmp` اختفت
(‏`ls /tmp/bin` ⇒ لا يوجد). **وشجرةُ العمل تبقى سليمة** — فلا تفزع ولا تعمل `--hard`:

```bash
cd /home/user/ERP_Cloud
git fetch origin arena/3e37b812-erp-cloud
git reset --mixed origin/arena/3e37b812-erp-cloud     # ← --mixed لا --hard أبدًا
git log --oneline -1                                   # يجب أن يكون آخرَ التزامٍ لك
git status --short                                     # يجب ألّا يبقى إلا ما كنتَ تعمل عليه
mkdir -p /tmp/bin && printf '#!/bin/sh\nexec corepack pnpm "$@"\n' > /tmp/bin/pnpm && chmod +x /tmp/bin/pnpm
export PATH=/tmp/bin:$PATH
corepack pnpm install --prefer-offline                 # ≈١٧ ثانية من المخزن
corepack pnpm --filter "./packages/*" run build        # ← **قبل أيّ db:* وإلا فشل**
corepack pnpm run env:setup                            # يُعيد توليد .env (لا يطلب إدخالًا)
corepack pnpm run db:local                             # (خلفية) عنقودٌ جديد في /tmp/erp-local-pg
corepack pnpm run db:migrate                           # applied: 131
corepack pnpm run db:seed                              # منشأةُ DEMO_TENANT_CODE
corepack pnpm --filter @erp/api run build              # dist للـAPI (فـ`run start` = node dist/main.js)
```

ملاحظاتٌ مقاسة:

- الاختباراتُ في `apps/api` **تُقلع قاعدتَها المدمجة نفسها** (`createTestApp`) ⇒ لا حاجة إلى
  `db:local` لتشغيلها. وتُحتاج `corepack pnpm run db:local` **لبوابة الهجرة فقط**
  (‏`db:migrate` / `migrate:down` / `db:seed` على `DATABASE_URL` من `.env`).
- **⚠️ اتّصالُ القياس يجب أن يكون بـ`DATABASE_MIGRATOR_URL` لا بـ`DATABASE_URL`** (قِيس في ٢٣):
  جداولُ المستأجر (`items`, `tax_groups`, `sales_invoices`, `vouchers`, `cash_locations`, …)
  عليها **RLS مع `FORCE ROW LEVEL SECURITY`** وسياسةُ
  ‏`tenant_id = current_setting('app.tenant_id')`، فاتّصالٌ خامّ بدور التطبيق `erp_api` يرى
  **صفر صفوفٍ بلا خطأ** — فيبدو أنّ البذرَ فشل وهو لم يفشل. (ولبعض الجداول بلا RLS —
  ‏`tenants`, `users`, `inventory_transactions`, `stock_balances` — تظهر صفوفُها، فيزداد
  اللبس.) فإمّا دورُ المُرحِّل (`app`) وإمّا `SET app.tenant_id = '<uuid>'` أوّلَ الاتّصال.
- **لا `psql`** في حزمة `@embedded-postgres` (فيها `initdb`/`pg_ctl`/`postgres` فقط) ⇒ للقياس
  على قاعدةٍ حيّة استعمل سائق `pg` من node:
  `node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/index.js` مع `DATABASE_MIGRATOR_URL` من
  `.env` (نمطٌ جاهزٌ استُعمل في الشريحة ١٣ج).
- `packages/*/dist` تُمسح أيضًا ⇒ الترجمةُ تحتاج بناءَ الحزم: استعمل **`corepack pnpm run
  typecheck`** (الجذر: يبني الحزم ثمّ يترجم كلّ شيء) لا `pnpm -r run typecheck` وحده بعد
  استعادةٍ (وإلا ظهرت أخطاء `Cannot find module '@erp/config'`).
- **وبناءُ الحزم لازمٌ لأوامر القاعدة أيضًا لا للترجمة فقط** (قِيس في ٢٣): ‏`pnpm db:migrate`
  يفشل بـ`ERR_MODULE_NOT_FOUND` على `packages/database/node_modules/@erp/config/dist/index.js`
  لأنّ المُرحِّل (‏tsx) يستورد `@erp/config` الذي يُحلّ إلى `dist`.
- **قاعدةُ التطوير نفسها في `/tmp/erp-local-pg`** ⇒ تذهب مع كلّ لقطة، ومعها منشآتُ العرض
  وبياناتُ `demo:line` و`backups/`. فما بعد الاستعادة: إعادةُ البذر، ثمّ
  ‏`pnpm demo:line --tenant <…>` ليومِ الخطّ، ثمّ `pnpm db:drill` إن أُريد اختبارُ الاستعادة.
- **‏`E2B_SANDBOX_ID` يتغيّر** ⇒ روابطُ المعاينة (`https://<port>-<id>.e2b.app`) تتغيّر، و
  ‏`NEXT_PUBLIC_STAFF_URL` في `.env` المحلّيّ يجب أن يُعاد إلى مضيف staff الجديد (وإلا فتح
  متصفّحُ الزائر `localhost:3001` على جهازه هو)، وكلماتُ السرّ جديدةٌ من `env:setup` — فلا
  يُنقل رقمٌ ولا رابطٌ ولا كلمةُ سرٍّ من رسالةٍ سابقة: **قِسها**.

---

## ١. أين نحن: ما اكتمل

| الطور/الشريحة | ما سلّمته | الالتزام |
|---|---|---|
| الطور ٠ | ‏`packages/web-core` (جلسة، ‏API، مفاتيحُ عدم التكرار، تخزينٌ دون اتصال، مزامنةُ نقطة البيع) | ‏(قبل هذه السلسلة) |
| الطور ١–٣، الشرائح ١–٤ | إصلاحاتُ الخادم + سقالاتُ `apps/bakery` + شاشاتُ الإنتاج/التوزيع/العهدة/المناديب (+ قراراتُ أ و ب و ج: ملفُّ الترحيل، رفضُ دفعةٍ بلا BOM، مديونيةُ الموظف) | ‏`d5fb326` وما حوله |
| ٥أ/٥ب | عدُّ المركبة كلّها (‏`vehicleCountQty`، الهجرة ٠١٢٩) | ‏`86f5554` |
| ٦–٨ | فواتيرُ الخطّ والتحصيل بمُصيِّرٍ واحد، سطحُ النشر، مفاتيحُ عدم التكرار | ‏(مسجّلةٌ في التقرير §٧–٨) |
| ٩ | ‏`GET /platform/marketplace/unlicensed-usage` + شاشةُ المنصّة؛ والحارسُ يبقى `observe` | ‏`24ca6d6` |
| ١٠–١١ | المطبوعاتُ الرسمية وشاشةُ المناديب (البطاقةُ وحسابُ الدخول) | ‏`dbff4ad` |
| ١٢أ | مجاميعُ اللوحة من الجدول كلّه + مفتاحُ `windows` | ‏`48af1e3` |
| ١٢ب | ‏`GET /van-sales/reports` يحترم `fromDate/toDate` + ‏`periodTotals` + ‏`filterNotes` + سقفُ ٢٠٠٠ | ‏`0a6350f` (مع ١٢ج) |
| ١٢ج | يومُ الأعمال في «حركات الموظف» بمنطقة المنشأة لا UTC | ‏`50be004` |
| ١٢د | شاشةُ تقارير المخابز (`app/reports` + `lib/reports-screen.ts`) | ‏`0a6350f` |
| ١٣أ | مجاميعُ المندوب (`GET /van-sales/me`) من جدوله كلّه + ‏`windows` | ‏`255435e` |
| ١٣ب | المرتجعُ يُنقص الإيرادَ والوعاءَ والذممَ والربح (تنفيذٌ واحدٌ `VAN_MONEY_SQL` في أربعة مواضع) | ‏`bb738b5` |
| ١٣ج | الهجرة ٠١٣١: القيمُ الافتراضية المفبركة (‏`unit_cost = 3.80`، اسمُ الصنف، ‏`BATCH-DEFAULT`) + كاتبُ تكلفة المرتجع + أربعةُ استعلاماتِ قراءة | ‏`f4162b7` |
| ١٣د | لا فاتورةَ ضريبيةً برقمٍ مخترع: حارسُ `VAN_ZATCA_SELLER_IDENTITY_REQUIRED` + المشفِّرُ الرسميّ + جملةٌ واحدةٌ في `policy.zatcaSeller` | ‏`74c226b` |
| ١٣هـ | جملةُ النافذة تنفيذٌ واحدٌ في `@erp/web-van/windows` + أطرافُ المرتجعات في أربعة أوجه | ‏`37a0c78` |
| ١٣و | سلسلةُ التكلفة تطلب صنفَ **المستند** + جملُ النوافذ في صفحة المحاسب + عزلُ مثبّتةِ تدقيق الويبهوك | ‏`2df9967` |
| — | سجلُّ البنود المفتوحة والقرارات المطلوبة | ‏`130913f` |
| **١٤أ** | **المرحلة ٤ تبدأ**: مستوى طابور المندوب (`vanQueue` في `web-core` + `apps/bakery/lib/rep-queue.ts`) | `89643ee` |
| — | وثيقةُ التسليم هذه | `7fd19f7`, `a2d3578` |
| **١٤ب** | **شاشةُ `/rep`**: عقدُ الحمولة في `@erp/web-van/rep-workspace`، ومنطقُ الشاشة في `apps/bakery/lib/rep-screen.ts` (٧ أحكام)، والصفحةُ `apps/bakery/app/rep/page.tsx` (~٧٠٠ سطر)، و`rep-app` صار `ready` بـ`href: '/rep'` | `76f97df` |
| **١٤ج** | **‏PWA**: ‏`apps/bakery/public/{manifest.webmanifest,sw.js,icon.svg}` + `components/service-worker-register.tsx` + إعلانُ الـmanifest وتركيبُه في `app/layout.tsx` + ٤ أحكام. والقاعدة: **القشرةُ تُخزَّن والمالُ لا يُخزَّن** (‏`/api/` خروجٌ مبكرٌ **قبل** أوّل `respondWith`) | `7a71cc9` |
| **١٥أ** | **تصميمُ `/rep` للجوال**: طبقةُ `.rep-*` في `app/globals.css` (هدفُ لمسٍ `max(--control-h,48px)`، خطُّ إدخالٍ ١٦px، مناطقُ آمنة، أرقامٌ `tabular-nums` بـ`--font-num`، صفوفٌ بطاقيةٌ **بلا `<table>`**، ‏`data-tone` للمعنى، رموزُ النظام فقط بلا لونٍ ستّ عشريّ) + ‏`viewportFit:'cover'` و`themeColor` = ‏`theme_color` الـmanifest + ١٠ أحكام. والمنطقُ لم يتغيّر بايتًا (استُبدل الـJSX وحده) | `5538260` |
| **١٥ب** | **تمريرُ الجوال على الشاشات كلّها**: سببٌ مقاسٌ في `@erp/ui` (`FIELD_BASE = h-9 text-[13.5px]` ⇒ iOS يُكبّر عند التركيز؛ ‏`SIZES.sm = h-8` = ‏٣٢px دون هدف الإبهام) و`@media (max-width:640px)` يرفعهما بـ`min-height: 44px` و`font-size: 16px` مقيّدًا بـ`.bak-main` — و٣ أحكامٍ مزدوجةِ الطرف تقرأ مصدرَ النظام فتسقط إن كفّ السبب | `ece8ded` + `d20ec97` + `a49a451` |
| **٢١** | **بياناتُ العرض الحقيقية + عيبان ماليّان**: ‏`pnpm demo:line` (‏`apps/api/scripts/demo-line.mjs`) يومُ خطٍّ كامل **عبر API** لا SQL (إنتاج ← تحميل ← استلام ← بيع ← تحصيل ⇒ سندُ قبضٍ مُرحَّل ← إقفال ← اعتماد) بتكرارٍ آمنٍ مقاس؛ وإصلاحُ **نسبة الضريبة في البذرة** (`0.1500` لمجموعةٍ اسمها «15%» ⇒ فاتورةُ ٦٠٠ بضريبة ٠٫٩٠) + ٣ أحكامٍ تثبّتها (والتخريبُ ⇒ `expected 0.15 to be 15`)؛ وإصلاحُ **ضياع قيمة المخزون في `return_to_main`** (الرجلُ الداخلة `inWithCost` بلا `unitCost` ⇒ ترجع الكيلواتُ بصفر قيمة: ٢٨٠ ريالًا ضاعت ومتوسطٌ نزل ٢٫٨٠٠٠←٢٫١٠٠٠) بقراءة تكلفة الحركة الخارجة من `inventory_transactions` + ٣ تأكيداتٍ على القيمة تسقط بلا إصلاح (‏`expected 80 to be close to 104`)؛ و`docs/ANDROID_REP_APP_BRIEF.md` (مطالبةُ تطبيق أندرويد) و`docs/BAKERY_PRODUCTION_READINESS.md` (الجاهزيةُ بما قِيس) | `9b64221` |
| **٢٢** | **لصقةُ المالك تُدين الشاشة + النسخُ الاحتياطيّ يُختبر**: فصلُ نصّ العميل (`summaryAr` لكلّ وحدة، ١٠٢–١٢٤ حرفًا) عن السجلّ الهندسيّ (`planAr` + مساراتُ API داخل `<details className="bak-tech">`)، وتلميحاتُ الشريط الجانبيّ، ووسيلةُ «مخطَّط» المشروطة (تناقضُها مع «١١ من ١١»)، وإعادةُ كتابة بطاقة الترخيص بلغة العميل، وإسقاطُ ادّعاءٍ قديم («والمتبقّي manifest/service worker» — سُلّمتا في ١٤ج) + **٧ أحكامٍ** تمنع العودة (ومنها كاشفُ تسريبٍ على نصّ الصفحة)؛ و`scripts/db-backup.mjs` بوضعين (`pg_dump` و`sql` لأنّ المضمَّن بلا `pg_dump` — قِيس) + **`pnpm db:drill` اختبارُ استعادةٍ كامل قِيس أخضر** (٢٨٩ جداول/٣٠٦٥ صفوفًا والعدُّ مطابق)؛ و`deploy/k8s/{backup,monitoring}.yaml` (نسخٌ يوميٌّ بتحقّقٍ من الأرشيف واحتفاظٍ بـ١٤، واستعادةٌ **`suspend: true`**، وفحصٌ كلّ ٥ دقائق على `/health/ready` بنبضة «رجلٍ ميت» اختيارية) + طبقةُ `overlays/monitoring/` اختياريّةً لأنّها CRD + **٦ أحكامٍ بنيوية** (وبوابةٌ ضعيفةٌ كُشفت بالتخريب: ‏`echo` أشبع `toContain('pg_restore --list')` فشُدِّدت إلى أمرٍ في بداية سطر) | `03be97e` |
| **٢٣** | **قرارا المالك يُنفَّذان**: ‏`pnpm demo:fix-vat` (‏`apps/api/scripts/fix-vat-group.mjs`) يُصحّح نسبةَ ضريبةٍ كُتبت خطأً **عبر مسارات المنتج** — طريقُ (أ) `PATCH` إن كانت غير مقفولة، وطريقُ (ب) عند ‏٤٠٩ `TAX_GROUP_RATE_LOCKED`: مجموعةٌ جديدة بالنسبة الصحيحة على **حساب الضريبة نفسه** + تسميةُ القديمة «مجموعة تاريخية» + إعادةُ ربط الأصناف، **وبلا لمسٍ لأيّ فاتورةٍ مُصدَرة** (وقِيس: الإيرادُ بقي ١٠٠١٫٥٠)؛ وحاويةُ `upload` في مهمّة النسخ ترفع الأرشيف إلى ‏S3‑متوافق بـ`mc cp` + تحقّقٍ بـ`mc stat` + احتفاظٍ بـ`mc rm --older-than`، بعلامة `.ready` تُكتب **بعد** تحقّق الأرشيف، وفشلٍ صريحٍ بلا إعداد، ومفاتيحَ سرٍّ `optional: true` — وخطأُ إدراجٍ في `kustomization.yaml` كسر تثبيتَ `erp-bakery` **فأمسكته بوابةٌ قائمة** وأُصلح باتباع عرف المستودع (صورُ الطرف الثالث في الملفّ بوسمٍ مثبّت) | **(هذا الالتزام)** |
| **١٥ج** | **بندُ ب٥ يُقفل**: `hrm.service.ts` — ‏`movementDate()` يتحقّق من الصيغة وأنّ التقويمَ يحمل التاريخ قبل `::date` (فـ`from=أمس` كان **٥٠٠**، قِيس)، ومدىً مقلوبٌ يُرفض؛ و`hrm.controller.ts` — ‏`movement_type` مجهولٌ يُرفض ٤٢٢ بدل تطبيعٍ صامتٍ إلى «الكلّ». وحكمٌ واحدٌ يقيس الطرفين (‏١٣ في `employee-movements.spec.ts`) | **(هذا الالتزام)** |
| **١٦أ** | **بندُ ب١ يُقفل**: `resolveShortageUnitPriceInTx` — تحت سياسة `unit_cost` وأمرٍ بلا صنف (أو صنفٍ بلا رصيدٍ ولا سعر شراء) كان العجزُ يُقيَّم بمتوسط **أسعار البيع** فتُحمَّل مديونيةُ الموظّف بسعر بيعٍ وقرارُ المالك يقول «بالتكلفة». أُضيف مصدرُ تكلفةٍ أخير: متوسطُ `unit_cost` لمستندات الأمر (أساسٌ `document_unit_cost` + لقبُه في `@erp/web-van/custody`، وبلا هجرة). وقِيس: عجزُ ٢ كجم ⇒ ٨.٠٠٠٠ لا ٢٠.٠٠٠٠ | **(هذا الالتزام)** |
| **١٦ب** | **مسطرةُ تواريخ الطلبات** `apps/api/src/common/date-param.ts`: ‏`isRealCalendarDay` (شكلٌ **ثمّ** تقويم) و`parseDayParam`/`parseClockParam` بـ٤٢٢ و`field` — استعملتها `accounting.service.ts` (‏`journalScope` المشتركة + `accountStatement` + `costCenterStatement` بالتواريخ والأوقات) و`reporting.service.ts` (‏`dayish` اكتسبت `.refine`؛ و`timeish` كانت صارمةً أصلًا) و`hrm.service.ts` (‏`movementDate` تفوّض إليها وتحتفظ برمزها). وقِيس قبل: ‏`journal-entries?from=أمس` ⇒ **٥٠٠ INTERNAL** و`reports/sales-invoices?from=2026-02-30` ⇒ **٥٠٠** | **(هذا الالتزام)** |
| **١٦ج** | **مسحُ مرشّحات التاريخ في الـAPI كلّه**: من `packages/contracts/openapi.json` حُصرت **٣٨ مسارًا** بمعاملِ تاريخ، وضُرب كلّها بفاسدٍ وصحيح ⇒ ١٥ كانت **٥٠٠ INTERNAL** و٤ كانت **٢٠٠ بمرشّحٍ محذوفٍ بصمت** (نمطُ `isISODate(q.from) ? gte(…) : undefined` في مارينا) و٦ محميّةٌ أصلًا و٨ محجوبةٌ بصلاحية/مورد. أُصلحت الخمسةَ عشر والثلاثةُ الصامتة بمساعد `validateDayFilters` عند باب **١٥ دالةً في ٨ ملفات** (برمزٍ لكلّ وحدة)، وبقي `/hrm/reports/salary?month` مثبَّتًا بندًا مفتوحًا (شهرٌ لا يوم). و٥ أحكامٍ على ١٨ مسارًا منها حكمٌ يمنع رفضَ التاريخ **الصحيح** | **(هذا الالتزام)** |
| **١٧** | **التصميمُ المهنيّ — الترحيلُ إلى `@erp/ui`**: جسرٌ بثلاثة محوّلات في `apps/bakery/lib/ui-kit.ts` (`tableColumns`, `listState` بترتيب ممنوع←تحميل←خطأ←جاهز، `rowKeyFrom`)، وشاشةُ التقارير على `DataTable` (٥ جداول بفرزٍ وترقيمٍ ومُختارِ أعمدةٍ محفوظٍ وأربعِ حالات) و`Kpi`، وطبقةُ `.bak-table` في `globals.css` **تطابق تشريحَ `DataTable` قياسًا** للجداول التي لا تسعها (صفُّ المندوب القابلُ للتوسعة) وطُبِّقت على ١٠ جداول في ٦ شاشات، ومثبّتتا `ui-kit` و`table-anatomy` (٨ أحكام) تقرأان ملفَّ المكوّن وتقارنان كلّ رقم | `332d126` + هذا |
| **١٨** | **السببُ الجذريّ لـ«الاستايل شبه معدوم» — ليس ذوقًا بل مرافقُ Tailwind لا تُولَّد**: ‏`@source '../../../packages/ui/src'` في `globals.css` للمخابز والطاقم ومنصّة الإدارة (التفصيلُ والقياسُ في §٥ «فخُّ التصميم» وفي التقرير §١٨) + إعادةُ بناء «نظرة اليوم» لوحةَ عملياتٍ حقيقية (‏`Kpi`×٦ من `GET /van-sales/dashboard` بأربعِ حالاتٍ صادقة، وخريطةُ الوحدات بشاراتِ `statusTone`، وحذفُ الصندوق الذي كان يقول «لا تعمل دفعةُ إنتاجٍ ولا فاتورة» وهو كذبٌ منذ الطور الثالث) + شاشةُ الدخول (علامةُ النظام، غسلةُ خلفية، تنسيقُ `:-webkit-autofill` الذي كان يصبغ الحقلين أصفر) + حارسُ `design-source-coverage.spec.ts` (١٠ أحكام) | **(هذا الالتزام)** |
| **١٩** | **تحجيمُ الخطّ + مندوبٌ تجريبيّ**: قاعدةٌ واحدة في `callerLineScopeInTx` (بطاقةُ المندوب وأذوناتُه من **القاعدة** لا من الرمزية) وثلاثةُ حراس (`assertCompanyScopeInTx`, `assertOwnsLoadInTx`, `assertOwnsDocumentInTx`) على ٨ مسارات، والقائمتان (`VAN_SALES_COMPANY_SCOPE_PERMISSIONS`, `VAN_SALES_REP_PROXY_PERMISSIONS`) وتعريفُ الدور (`VAN_SALES_REP_ROLE`) في `@erp/contracts` تنفيذًا واحدًا + بذرةُ المندوب (`seedRep` تحاكي `linkSalesmanAccount`) و`DEMO_REP_*` في `.env.example` وتوليدها في `env:setup` + تفعيلُ `bakery_distribution` في `tenant_apps` + أداةُ `pnpm db:demo-audit` (قراءةٌ فقط) + `companyScope` في كتالوج الوحدات ووضعُ المندوب في «نظرة اليوم» | `2c81071` |
| **٢٠** | **قرارا المالك (ب١٧ وب١٨) يُنفَّذان**: (أ) هويةُ المنشأة من `DEMO_COMPANY_*` مع `ON CONFLICT … DO NOTHING RETURNING tenant_id` فالتحذيرُ مقياسٌ على ما كُتب/سيُقرأ لا على ما طُلب، وملفٌّ قائمٌ **لا يُدهس** (يُقال ذلك في السطر)؛ (ب) ‏`pnpm db:demo-repair` — تخطيطٌ ثم كتابةٌ في معاملةٍ واحدة بعد نسخةٍ JSON في `.demo-repair/`، بحدٍّ مقروءٍ من `erp_migrations.applied_at` لـ`0131`، وحارسِ قيمةٍ مقاسةٍ في كلّ `UPDATE`، وأربعِ فئاتٍ وثلاثةِ «يُعدّ ولا يُصلَح»، ورفضٍ بلا `0131` (‏١٣ حكمًا على قاعدةٍ مُرحَّلة، والتخريبُ قِيس مرتين)؛ (ج) شاشةُ الخزينة **قراءةٌ** لأنّ `van-sales.service.ts:6953-7027` يُنشئ سندَ القبض **ويرحّله** أصلًا (فسندٌ ثانٍ على النقد نفسه قبضٌ مزدوج) + ‏`/accounting` بسبعةَ عشرَ مسارًا حقيقيًّا عبر `POST /auth/handoff` (رمزٌ لمرةٍ واحدة يُصنع عند النقر، ولا `token` في عنوان) ⇒ الشارةُ **١١ من ١١**؛ (د) قنبلةُ ساعةٍ في `report-invoices.spec.ts` أُصلحت بتثبيت `posted_at` وإعادتها في `finally` | **(هذا الالتزام)** |

---

## ٢. القراراتُ المعتمدة (لا تُسأل مرّةً أخرى)

قراراتُ المالك في تطبيق المخابز — **نافذةٌ ولا تُعاد مناقشتُها**:

1. النطاقُ **عموديٌّ مركّز** مع روابطَ عميقةٍ إلى `staff` — لا إعادةَ كتابة. والتطبيقُ **سطحٌ
   رقيقٌ فوق الـAPI نفسه**: شاشاتٌ لا قواعد، ‏`apps/api` نفسها، رموزُ الصلاحية من
   `@erp/contracts`، ‏`@erp/ui` نفسها، المصادقةُ والتسليمُ نفسهما، بوابةُ السوق نفسها،
   **صفرُ جداولٍ جديدةٍ لمفاهيمَ قائمة**، ولا محرّكُ محاسبةٍ أو مخزونٍ ثانٍ.
2. **إصلاحُ الخادم أولًا** ثمّ الشاشات.
3. سطحُ المندوب = ‏**PWA للجوال أولًا، دون اتصال ومع اتصال** (طابورٌ + مفاتيحُ عدم تكرارٍ +
   مزامنةٌ + دخولٌ بالتسليم + ربطُ جهاز).
4. الترخيصُ = رمزُ تطبيق السوق `bakery_distribution` (موافقةُ منصّةٍ لكلّ منشأة).
5. (أ) حساباتُ الإنتاج = فصلٌ اختياريٌّ بملفّ ترحيل (`rawMaterialsAccountId`/‏`wipAccountId`/
   `finishedGoodsAccountId`)، ومحايدٌ دفتريًّا حين لا تُربط.
6. (ب) دفعةٌ بلا BOM/مكوّنات ⇒ **رفضٌ ٤٢٢**.
7. (ج) مسؤوليةُ العجز = **مديونيةُ موظّف** بـ`unit_cost`، ولا تُثار إلا بـ`salaryDeductionApproved`
   الصريح لكلّ حالة، والرفضُ ٤٢٢ حين لا يُربط الحسابُ المقابل أو لا موظف/حساب للمندوب.
8. بذرُ بيانات العرض **مفوّضٌ إليّ** (ونُفِّذ مرّتين؛ ولا حساباتٍ تُنشأ تلقائيًّا).
9. دلالةُ العدّ = **المركبةُ كلّها** (`vehicleCountQty`، الشريحة ٥ب).
10. ترتيبُ الشرائح **مفوّضٌ إليّ** مع سببٍ قبل كلّ شريحة.
11. «واصل العمل وأصلح أيّ مشكلة — أنت مبرمجٌ خبيرٌ ومحاسبٌ قانوني».
12–15. «واصل العمل» (مرّات) ⇒ الشرائحُ ٩ و١٢ و١٣ كما سُلِّمت.
16. **`measure_first`**: حارسُ `SectorLicenceGuard` يبقى في `observe`؛ وبُنيت
    `GET /platform/marketplace/unlicensed-usage` وشاشتُها ليُقرَّر الفرضُ على أرقام.
    (الفرضُ الصارمُ و«تسويةُ الأقدم» **لم يُختارا**.)
17. **معالجةُ المرتجعات = `net_with_profit`** (‏`ask_user`): خصمٌ صافٍ من الإيراد والوعاء
    والذمم **+ أثرُ المرتجع على الربح**، مع رقمٍ منفصلٍ ظاهرٍ في كلّ وجهٍ كي لا يختفي شيء.
18. **الرقمُ الضريبيّ المفقود = `refuse_422`** (‏`ask_user`): رفضُ مستندٍ بوضع `zatca_tax`
    لمنشأةٍ بلا `company_profiles.tax_no` برسالةٍ عربيةٍ تقود إلى الإدخال.

**وقواعدُ المالك في أسلوب العمل** (تُحرف ولا تُكسر):

- الخياراتُ التجارية/المعمارية تُشرح **بسطرٍ عربيٍّ واحدٍ لكلٍّ مع توصية ثمّ تُقرّر**؛ ولا
  تُعاد الأسئلة. وأمّا **المالُ والمحاسبةُ والضريبةُ فتقف عند اختياره الصريح** (‏`ask_user`
  نجح في: أساسُ العجز، دلالةُ العدّ، معالجةُ المرتجعات، الرقمُ الضريبي).
- **لا تزييفَ في الاختبارات**: لا إخفاءَ لفشل، ولا تعديلَ اختبارٍ لينجح بلا إصلاح سلوك
  (وتحديثُ المثبّتات بعد تشديدٍ مقصودٍ **مشروعٌ ويُبلَّغ**). وتُذكر الأوامرُ وأعدادُ
  النجاح/الفشل كما هي، ولا تُسمّى اختباراتُ الـAPI اختباراتِ متصفّح.
- **الحزمُ الكاملة مطلوبة**: ‏`apps/api` كلّها و`apps/staff` كلّها، وترجمةٌ وlint، وهجرةٌ
  تطبيقًا وانعكاسًا على قواعد اختبار، واختباراتُ التزامنِ بقيودٍ وأقفالٍ حقيقية.
- **حمايةُ البيئة**: لا هجرةَ إنتاج، ولا حذفَ بيانات، ولا تحريرَ هجراتٍ تاريخية، ولا حساباتٍ
  تُنشأ تلقائيًّا، ولا فرضَ رواتب/مديونياتٍ بغير اختياره، ولا تغييراتِ ضريبة/ZATCA بغير قراره.
- **أمانةُ النتائج**: لا ادّعاءَ بفحصٍ لم يُنفَّذ، ولا مبالغةَ في وصف عيب (سجلُّ التصحيحات
  في التقرير: «الإنتاجُ لا يصل الأستاذَ أبدًا»، «مساران متوازيان»، «قيمةُ الحمولة تلوّث
  التحويلات»، «`issued_qty` منتفخ» — كلّها قِيست وخُفِّضت أو نُفيت). و**قِس السلوكَ لا
  التعليقات ولا نثري السابق**.
- تدقيقٌ لا وصف؛ ولا تُغلق عهدةٌ بفارق مخزونٍ غير مُصفّى؛ فصلُ العجز أربعةَ أطراف؛ لا قيودَ
  عجزٍ تلقائية؛ قف عند الحدّ الآمن في قرارات المال؛ لا تسليمَ تقريرٍ بلا تنفيذ؛ افحص قبل
  أن تُغيّر؛ لا أنظمةَ ولا جداولَ موازية؛ لا قواقعَ تجميليةَ ولا أخطاءَ مخفية؛ الضبطُ في
  الخادم (إخفاءُ زرٍّ ليس ضبطًا)؛ مستندٌ واحدٌ ونسختان مطبوعتان لا فاتورتان؛ سجلُّ المندوب
  مربوطٌ بموظفٍ وحسابٍ حقيقيَّين.

---

## ٣. أوامرُ البوابات ونتائجُها المقاسة الأخيرة

```bash
export PATH=/tmp/bin:$PATH
cd apps/api && corepack pnpm exec vitest run                       # الحزمةُ الكاملة
cd apps/api && corepack pnpm exec vitest run test/van-sales-*.spec.ts test/migration-0127-reversibility.spec.ts
corepack pnpm -r --filter '!@erp/api' run test                     # بقيّةُ الحزم
corepack pnpm run typecheck                                        # يبني الحزمَ ثمّ يترجم كلّ شيء
corepack pnpm -r run lint
corepack pnpm --filter @erp/bakery run build
corepack pnpm --filter @erp/staff run build
corepack pnpm run openapi:export && git status --short             # يجب ألّا يظهر فرقٌ في openapi.json
corepack pnpm run demo:line                                         # يومُ خطٍّ كامل عبر API (يلزم خادمٌ قائم)
corepack pnpm run demo:line -- --report-only                        # بلا كتابة
corepack pnpm run db:demo-repair                                    # قياسٌ فقط (افتراضيًّا)
corepack pnpm run db:demo-repair -- --apply --tenant demo           # الكتابةُ بعد نسخةٍ احتياطية
cd apps/api && corepack pnpm exec vitest run test/demo-repair.spec.ts test/report-invoices.spec.ts
corepack pnpm run db:local                                         # (خلفية) لبوابة الهجرة فقط
corepack pnpm run db:migrate
corepack pnpm --dir packages/database run migrate:down 1
```

**آخرُ نتائجَ مقاسة** (‏2026-10-16):

| البوابة | النتيجة |
|---|---|
| ‏`apps/api` كاملة (بعد ١٩، ‏٢٢:٣٢ UTC) | **٢١٤ ملفًّا / ١٧٩٠ حكمًا، ٠ فشلت** (‏٥٩٨ ثانية) **وبلا سطر `Errors` هذه المرّة** — فضجيجُ ب١٦ (‏`FATAL 57P01`) مرتبطٌ بالتزامن ولم يتكرّر، وبقي البندُ مفتوحًا لأنّ سببَه لم يُصلَح. والتشغيلُ الذي سبقه (قبل إصلاح المثبّتتين) أعطى ٢١٤/١٧٩٠ **بفشلين** هما مثبّتتان كانتا **تُثبتان التسريبَ نفسه** (مندوبٌ يقرأ لوحةَ المنشأة وتقاريرَها) وأُصلح عقدُهما لا سلوكُهما |
| مثبّتةُ التحجيم الجديدة | ‏`test/van-sales-rep-scope.spec.ts` — **١٤ حكمًا، ٠ فشلت**؛ والتخريبُ (‏`callerLineScopeInTx` يُرجع «لا أحدَ مندوب») ⇒ **٥ أحكامٍ فشلت** (١، ٢، ٧، ٨، ٩ = أحكامُ الرفض كلّها) ثمّ استُعيدت النسخةُ وتحُقّق منها بـ`md5sum` |
| مواصفاتُ التوزيع والانعكاس (١٤ ملفًّا) | **٨٩ حكمًا، ٠ فشلت** |
| بقيّةُ الحزم (بعد ١٩) | **١٣ حزمة / ١٠٤ ملفات / ٩٥٩ حكمًا + ١ تخطٍّ، ٠ فشلت** (كانت ٩٥٦ بعد ١٨؛ والزيادةُ ٤ أحكامِ تحجيمِ القائمة في المخابز ناقص تخطّي التسويق) |
| ‏`apps/bakery` | **١٩ ملفًّا / ٢٢٣ حكمًا** |
| ‏`packages/web-core` | **٨ ملفات / ٥٢ حكمًا** |
| ‏`packages/web-van` | **٥ ملفات / ٩٥ حكمًا** |
| ‏`apps/staff` | **١٥ ملفًّا / ٩٤ حكمًا** |
| الترجمةُ والـlint | ‏٠ / ٠ (والـlint يُظهر تحذيرَ `[boundaries][warning]` القائم فقط) |
| الترجمةُ والـlint (بعد ١٩) | ‏٠ / ٠ في المستودع كلّه (وخطآن من صنعي أُصلحا: ‏`BAKERY_MODULES` لم تكن مُستوردةً في القشرة، وسطرٌ فارغٌ داخل مجموعة استيراد في `demo-audit.ts`) |
| بذرةٌ حقيقية على قاعدةٍ محلية | ‏`env:setup --force` ⇒ `db:local` ⇒ `db:migrate` (‏`applied: 131`) ⇒ `db:seed` ⇒ **سلسلةُ المندوب كاملةٌ في القاعدة** (قِيس بـSQL): دور «مندوب توزيع» بأربعة أذونات، موظف `EMP-REP-1` مربوطٌ بالعضوية، بطاقةُ مندوبٍ مربوطةٌ بالموظف ومستودع `VAN-1`، نطاقُ العضوية مستودعُ السيارة وحده (لا `00000000-…`)، و`tenant_apps = [bakery_distribution]`. ودخولٌ حقيقيّ عبر HTTP: ‏`/me` ⇒ `enabledApps:[bakery_distribution]`، ‏`/van-sales/me` ⇒ `isRep:true, salesmanName:"مندوب الشركة"`، ‏`/dashboard` و`/reports` و`/salesmen` ⇒ **٤٠٣ `VAN_SALES_COMPANY_SCOPE_REQUIRED`**، والمالكُ في الثلاثة ⇒ ٢٠٠ |
| ‏`pnpm db:demo-audit` على البذرة نفسها | **٥ سجلّاتٍ غير صالحةٍ للإنتاج**: هويةُ المنشأة الوهمية (‏`tax_no=300000000000003`, `cr_no=1010000000`, `info@demo.test`, `Demo Trading Co.`) · طرفان عامّان · قيدُ افتتاحٍ `JE-000001` بأطرافٍ مجموعُها ٥٠٠٠٠٠ · اشتراكٌ يدويّ `pro-monthly` حتى ٢٠٢٧ — **وصفرُ صفوفٍ مفبركة** (‏٣٫٨٠ / `BATCH-DEFAULT` / «رقائق سمبوسة») لأنّ البذرةَ لا تُنشئ مستنداتِ خطٍّ أصلًا؛ فتلك الفئةُ تظهر فقط في قاعدةٍ كُتبت قبل ٠١٣١ |
| بناءُ المخابز / الطاقم / منصّة الإدارة / التسويق (بعد ١٨) | ‏٠ (‏١٠ مساراتٍ ساكنة، و`/` صار ٦.١٣ kB) / ‏٠ (٤٢ ثانية) / ‏٠ (٢١ ثانية) / ‏٠ (٢١ ثانية) |
| **CSS المبنية بعد `@source`** (‏`.next/static/css/*.css`، والتهريبُ مهمّ: ‏`.bg-slate-950\/45`) | المخابز **٦١٢٨٠** بايت · الطاقم **٩٠٤٩٢** · منصّةُ الإدارة **٨١٦١٥** — والمفقودُ من ١٠ أصنافٍ حرجة **٠** في الثلاثة (كان ١٠/١٠) |
| ‏`openapi:export` | ‏٠ **بلا فرق** في `packages/contracts/openapi.json` |
| بوابةُ الهجرة (١٣ج) | ‏`applied: 131, skipped: 0` ⇒ `migrate:down 1` ⇒ القيمُ المفبركة تعود والسجلُّ آخرُه `0130` ⇒ `applied: 1, skipped: 130` ⇒ القيمُ صادقة ⇒ `db:seed` خروجٌ ٠ |

**تحديثُ ٢٠٢٦-١٠-١٧ (بعد الشريحة ٢٠)** — والجدولُ الذي فوقه يبقى سجلًّا لما قِيس في ١٩:

| البوابة | النتيجة |
|---|---|
| ‏`apps/api` كاملة (‏٠٠:١٤ UTC) | **٢١٥ ملفًّا / ١٨٠٣ أحكام، ٠ فشلت** (‏٤٦٢٫٨٢ ثانية) + `Errors 1` (ب١٦) |
| العدُّ السابق في الشريحة نفسها (‏٢٣:٥٩ UTC) | ‏٢١٥/١٨٠٣ **بفشلٍ واحد** = قنبلةُ الساعة في `report-invoices.spec.ts` (بندُ ب٨ — أُصلحت بالتثبيت والإعادة، وقِيس التخريبُ بإرجاع الساعة إلى ٢٣:٥٩:٣٠ ففشل الحكمُ **حرفًا** كما فشل أول مرة) |
| ضجيجُ ب١٦ في التشغيلين | على `erp_test_platform_billing_41816_3` ثمّ على `erp_test_iso_org_45944_122` ⇒ **قاعدةٌ مختلفة في كلّ تشغيل**: تسابقُ teardown لا تسريبُ مثبّتةٍ بعينها (وقِيس أنّ `isolation-organization.spec.ts` يُنهي عملاءه في `finally`) |
| مثبّتةُ الإصلاح الجديدة | ‏`test/demo-repair.spec.ts` — **١٣ حكمًا، ٠ فشلت**؛ والتخريبُ مرّتين (حذفُ شرط الحدّ ⇒ سقوط الأحكام؛ حذفُ حارسِ القيمة **مع الوسيط** ⇒ الحكمُ ١٢ وحده) ثمّ الاستعادةُ بـ`md5sum 2a0f37b5657b2d6af179a1c98045893d` |
| مثبّتتا الشاشتين الجديدتين | ‏`treasury-screen.spec.ts` **١٥** + `staff-handoff.spec.ts` **٩** (ومنهما حكمٌ يقيس وجودَ `page.tsx` لكلّ وجهةٍ من **الطرفين**، وتخريبُ `/accounting/ledgerr` ⇒ حكمان سقطا، والاستعادةُ بـ`b64a5fa0d17fa87b28fb216a5891af07`) |
| بقيّةُ الحزم (آخر عدٍّ بعد ٢٣، **على قاعدةٍ جديدة بعد استعادة البيئة**) | **١٣ حزمة / ١٠٦ ملفات / ١٠٠١ حكم، ٠ فشلت** · و`packages/config` ‏٤ ملفات / **٣٢** حكمًا · و`eslint apps/api/scripts` ‏٠ خطأ (ومجلّدُ `scripts/` في الجذر ما زال خارج البوابة — ب٢٦) |
| ‏`apps/bakery` | **٢١ ملفًّا / ٢٥٩ حكمًا** (٢٢٧ ← ٢٥١ ← ٢٥٢ ← ٢٥٩: ‏+٧ أحكامُ نصّ العميل في ٢٢) |
| الترجمةُ والـlint | ‏`pnpm run typecheck` خروجٌ ٠ وبلا `error TS` · `pnpm -r run lint` خروجٌ ٠ وبلا خطأ (وخطأٌ واحدٌ من صنعي أُصلح: ‏`selectClass` مستوردٌ بلا استعمال في `app/treasury/page.tsx`) |
| بناءُ المخابز | ✓ — **١١ مسارًا** (‏`/` ‏٧٫٢٦ kB بعد مطويّة التفاصيل، و`/accounting` ‏٦٫٨٩ و`/treasury` ‏٩٫٥٨)، وCSS ‏٦٢١٨٤ بايت وفيها `.bak-tech` و`.bak-legend-note` وكلُّ الأصناف الجديدة فيها — **والفحصُ الأول قال إنّ `text-[12.5px]` ناقصٌ وكان الخطأ في تهريب `grep`** (فأُعيد بـ`grep -F`) |
| بذرةٌ بهويةٍ من البيئة | منشأةٌ قائمة (`demo`) ⇒ ‏`⚠ name_en, tax_no, cr_no, phones, email` + «الملفُّ موجود — عدّله في staff» وبلا كتابة؛ ومنشأةٌ جديدة (`bakeryco`) ⇒ **بلا تحذير** و`company_profiles` يقرأ `300123456789013`/`1010999888`/`["+966501234567","+966112345678"]`/`info@bakeryco.sa`، وبطاقةُ المندوب **بلوحةٍ من البيئة** (`DEMO_REP_VEHICLE_PLATE='أ ب ج ٤٣٢١'` ⇒ `vehicle_plate` مقروءٌ من القاعدة) |
| **قياسٌ حيّ عبر أصل المخابز** (‏API ٣٠٠٠ + staff ٣٠٠١ + المخابز ٣٠٠٥، والطلباتُ على `http://localhost:3005/api/v1/…` = طريقُ المتصفّح) | ‏`/treasury` و`/accounting` ⇒ ٢٠٠ · دخولُ المالك ⇒ `treasury.view` ✓ و`organization.cashlocation.view` ✓ و١١ `accounting.*` ⇒ **١١ من ١١** · ‏`GET /cash-locations` ⇒ صفّان بـ`meta.total=2` و`balances` ⇒ **`0.0000` مع `updatedAt:null`** (ومنها وُلد إصلاحُ ٢٠ح) · ‏`GET /vouchers` ⇒ مصفوفةٌ عارية ٠ صفوف · ‏`?from=bad` ⇒ ٤٢٢ `TREASURY_DATE_INVALID` · ‏`POST /auth/handoff` ⇒ ٢٠١ `{code, expiresIn:60}` · ‏`redeem` على :٣٠٠١ ⇒ **٢٠٠ بجلسةٍ كاملة** ثمّ **٤٠١** على الاستبدال الثاني (فـ«لمرةٍ واحدة» مقاسٌ حيًّا) · ‏`/accounting/ledger` و`/treasury/vouchers` و`/treasury/day-close` على :٣٠٠١ ⇒ ٢٠٠ |
| ‏`pnpm db:demo-repair` على القاعدة المحليّة | ‏`حدُّ الفبركة: … 2026-10-16 21:57:49.185589+00` ⇒ `✓ لا صفوفَ مُثبتةَ الفبركة` — صادقٌ لا فارغ: فالبذرةُ بعد ٠١٣١ لا تُنشئ مستنداتِ خطٍّ أصلًا |

**وفلسفةُ الإثبات في كلّ شريحة** (لا تُترك): ‏(١) احفظ نسخةً من الملفّ **قبل** التخريب
**ونسخةً مُصلَحة** (‏`cp file /tmp/x.fixed.ts` + ‏`md5sum`)؛ (٢) خرِّب (أو `git checkout HEAD --
file`)؛ (٣) شغِّل وسجِّل رسائلَ الفشل **حرفًا**؛ (٤) استعد وتحقّق بالبصمة. وفي ١٣أ ضاعت
النسخةُ المُصلَحة فأُعيد تطبيقُ الرقعة وتحُقّق منها بالبصمة — فلا تُكرّر.

---

## ٤. ما تبقّى من المرحلة الرابعة — بالقياسات الجاهزة

### ١٤ب — شاشةُ `/rep` — **تمّت** (وتفصيلُها وأحكامُها في §١٤ب من التقرير؛ وما تحتها مرجعُ العقود)

**الملفّات**: ‏`apps/bakery/app/rep/page.tsx` (‏`'use client'`) + منطقٌ نقيٌّ في
`apps/bakery/lib/rep-screen.ts` + ‏`apps/bakery/tests/rep-screen.spec.ts` + قلبُ `rep-app`
إلى `ready` في `apps/bakery/lib/navigation.ts` **مع تحديث** `apps/bakery/tests/navigation.spec.ts`
(فالمثبّتةُ تفرض `declaredPages(app/) === readyModules().map(href)` وقائمةَ المفاتيح
المرتّبة — والترتيبُ **codepoint** لا أبجديّ: ‏`'reports'` قبل `'reps'`).

**الحمولة**: ‏`apiData<RepWorkspace>('/van-sales/me')` — والشكلُ المقاس بعد ١٣أ/١٣ب:

```
isRep, salesmanId, salesmanName, employeeId, warehouseId, vehiclePlate, active,
custodyKg, custodyValue,                        // ‏toFixed(4) من stock_balances
balances[], pendingReceipts[],                  // كاملتان (بلا LIMIT ⇒ لا نافذة)
loadOrders[] (26 حقلًا), documents[] (21 حقلًا), collections[] (7 حقول), notifications[],
totals: { revenue, salesGross, cashSales, creditSales, collected, outstanding,
          returns, returnsVat, returnCount, returnsWithoutCostCount },
custody: { expectedKg, officialKg, pendingClosings } | null,
windows: { loadOrders{50}, documents{100}, collections{50}, notifications{20} }
          // ‏كلٌّ {returned, total, limit}
// ‏وفرعُ «لستَ مندوبًا»: ‏isRep:false + custody:null + رسالةُ الربط، وبلا totals ولا windows
```

**وكلُّ أرقام المال صافيةٌ من المرتجعات**: ‏`revenue = salesGross − returns − returnsVat`،
و`cashSales + creditSales − returns − returnsVat = revenue`، و`outstanding` بعد الإشعارات
الدائنة. (مثبَّتٌ في `apps/api/test/van-sales-rep-workspace-totals.spec.ts` و
`van-sales-returns-in-reports.spec.ts`.)

**الإجراءاتُ والمساراتُ والصلاحيات** (مقاسةٌ من `van-sales.controller.ts`):

| الإجراء | المسار | الصلاحية | مفتاحٌ في الجسم؟ | يُحفظ في الطابور؟ |
|---|---|---|---|---|
| مساحةُ العمل | ‏`GET /van-sales/me` | ‏`van_sales.view` | — | — |
| مستندُ بيع | ‏`POST /van-sales/documents` | ‏`van_sales.invoice.create` | **نعم** | **نعم** |
| مرتجع | ‏`POST /van-sales/documents/:id/returns` | ‏`van_sales.invoice.create` | **نعم** | **نعم** |
| تحصيل | ‏`POST /van-sales/collections` | ‏`van_sales.collection.create` | **نعم** | **نعم** |
| إقفالُ الوردية | ‏`POST /van-sales/load-orders/:id/submit-closing` | ‏`van_sales.closing.submit` | **لا** | **لا — إطلاقًا** |
| تأكيدُ الاستلام | ‏`POST /van-sales/load-orders/:id/confirm-receipt` | ‏`van_sales.view` | **لا** | **لا** |
| الطباعة | ‏`GET /van-sales/documents/:id/print-view` | ‏`van_sales.view` | — | — |

**وما يُستعمل ولا يُعاد اختراعه**:

- `@erp/web-core/api`: ‏`apiData` (يفكّ `data`)، ‏`apiPost`، ‏`apiList`، ‏`apiErrorText`.
- `@erp/web-core/session`: ‏`useSession().can(…)`.
- `@erp/web-core/use-submission-key`: ‏`useSubmissionKey(prefix, draft)` ⇒ ‏`{key(payload?), reset}`
  (المفتاحُ يُمرَّر في **جسم** الطلب كـ`idempotencyKey`).
- `@erp/web-core/offline-db`: ‏`getOrCreateDeviceId`, ‏`enqueueVanOperation`, ‏`listVanQueue`,
  `pendingVanQueue`, ‏`updateVanQueueRecord`, ‏`removeVanQueueRecord`, ‏`clearSyncedVanQueue`,
  `vanQueueCounts`, ‏`resetOfflineStorage({force})` ⇒ ‏`{cleared, pendingVanQueue}`.
- `@erp/web-van/windows`: ‏`windowNote`, ‏`windowIsComplete`, ‏`REP_TOTALS_CLAUSE`,
  `WINDOW_LABELS`, ‏`DashboardWindows`.
- `apps/bakery/lib/rep-queue.ts` (الشريحة ١٤أ): ‏`QUEUEABLE_OPERATIONS`,
  `NOT_QUEUEABLE_OPERATIONS`, ‏`endpointFor`, ‏`buildQueueIdempotencyKey`, ‏`classifyReplay`,
  `syncPlan`, ‏`countQueue`, ‏`queueSummaryLine`, ‏`queueVerdict`, ‏`isQueueable`,
  `REP_QUEUE_MESSAGES`, ‏`REP_PERMISSIONS`.
- `apps/bakery/lib/sales-screen.ts`: ‏`documentVerdict` (الأحكامُ المالية: الكمياتُ والأسعارُ
  وسقفُ الائتمان والبونص والتجاوز) و`SALES_MESSAGES` — **فلا تُنسخ أحكامُه في `rep-screen.ts`**.
- `@erp/web-van/custody` و`distribution` لأحكام الإقفال والاستلام (‏`CLOSING_MESSAGES`,
  `RECEIPT_MESSAGES`, ‏`custodyBasis`, ‏`fourWaySeparation`, ‏`canSubmitClosing`, …).

**وهوياتُ صفحات المخابز** (تُنسخ ولا تُخترع): ‏`{Button,Card,CardBody,CardHeader,Input}` من
`@erp/ui`؛ ‏`{apiData,apiErrorText,apiList,apiPost}` من `@erp/web-core/api`؛ ‏`type Notice` +
`NOTICE_CLASSES`؛ ‏`selectClass='w-full rounded-[8px] border border-line bg-surface px-3 py-2
text-[13px] text-ink'`؛ الجداولُ `overflow-x-auto w-full border-collapse text-[12.5px]`؛
‏`dir="ltr"` للمعرّفات والأرقام؛ شارةُ `bak-badge`؛ ومتغيّراتُ `Button`:
`primary|secondary|ghost`.

### ١٤ج — وضعُ دون اتصال + ‏PWA — **تمّت** (وتفصيلُها وأحكامُها في §١٤ج من التقرير)

ما بُني: ‏`manifest.webmanifest` (‏`start_url: '/rep'`، ‏`display: standalone`، ‏`scope: '/'` —
لا `/rep` لأنّ أصولَ `/_next/` خارجه ونطاقٌ أضيق كان يُسقط القشرةَ بلا شبكة)، و`sw.js`
بكاشٍ منفصلٍ عن كاش الطاقم (`erpcloud-bakery-shell-v1` مقابل `erpcloud-staff-shell-v2`،
فاسمٌ مشتركٌ يعني أن يمسح أحدهما قشرةَ الآخر عند التفعيل) يُخزِّن القشرةَ وأصولَ
`/_next/` ويُسقط التنقّلَ بلا شبكةٍ إلى `/rep` و**يخرج مبكّرًا عن `/api/` قبل أيّ
`respondWith`** (فالمالُ لا يُخزَّن: قراءةٌ مخزّنةٌ تعني عهدةً قديمةً بعنوان «الآن»)، وبلا
معالجِ دفعٍ (فلا خادمَ يدفع، والمثبّتةُ تحكم بغيابه؛ وإشعاراتُ المندوب من حمولة
`/van-sales/me`)، و`components/service-worker-register.tsx` (نسخةٌ من نسخة الطاقم —
فالتطبيقان حزمتا Next منفصلتان ولا حزمةَ مشتركةً لمكوّنات React، والتسجيلُ ثلاثةُ أسطر)،
وإعلانُ الـmanifest وتركيبُ المكوّن في `app/layout.tsx`، و`tests/rep-pwa.spec.ts` (٤ أحكام).

**وما بقي من المرحلة الرابعة ليس كودًا:**

1. **جهازٌ حقيقيّ**: تثبيتُ التطبيق على هاتف، وفتحُه منقطعًا من أوّل مرة، وسلوكُ
   `navigator.onLine` في شبكةٍ متذبذبة — ولم يُفتح متصفّحٌ ولا هاتفٌ في هذه البيئة، فمن
   يقول إنّ التطبيق «يُثبَّت ويعمل في الطائرة» فقد زاد على القياس.
2. **قرارٌ للمالك**: هل يُرسل الطابورُ تلقائيًّا عند عودة الشبكة (كما في نقطة البيع:
   ‏`startOfflineAutoSync` كلّ عشر ثوانٍ) أم يبقى الزرُّ يدويًّا؟ والمُنفَّذُ الآن **يدويّ**
   لأنّ إرسالَ نيّاتٍ ماليةٍ بلا فعلٍ من المندوب قرارٌ في من يملك النيّة.
3. **أيقوناتٌ نقطية** (`apple-touch-icon` بـPNG بأحجامٍ مُسمّاة، خصوصًا لـiOS) — فالموجودُ
   ‏`SVG` واحدة، وتوليدُ الصور يحتاج أداةً لم تُضف.
4. **رفعُ اسم الكاش يدويًّا** مع كلّ تغييرٍ في القشرة (‏`v1` هو المقبض) — فاستراتيجيةُ
   «كاش أولًا» مع اسمٍ ثابت تعني أنّ إصدارًا جديدًا قد لا يظهر حتى يُفعَّل العاملُ الجديد،
   ولم يُؤتمت.

### مرجعُ العقود (ما تحتَه أُبقي كما كُتب قبل البناء)

- **واجهةُ الطابور بُنيت في ١٤ب**: العدُّ والملخّصُ (`queueSummaryLine`) وجدولٌ بمسار كلّ
  نيّةٍ ومفتاحها وقولِ الخادم فيها، وإعادةُ الإرسال نيّةً نيّةً بـ`syncPlan` و`classifyReplay`
  (والتوقّفُ عند أوّل نيّةٍ لم تصل لأنّ الشبكة ما زالت مقطوعة)، وحذفُ الواصل
  بـ`clearSyncedVanQueue` (والمرفوضُ يبقى)، ومسحُ التخزين الذي **يقرأ `cleared`** ويقول
  لماذا لم يُمسح إن كان في الطابور ما لم يصل.
- ربطُ الجهاز: عرضُ `deviceId` مع `REP_QUEUE_MESSAGES.deviceLine` (يقول إنّه **وسمُ تتبّعٍ لا
  حدٌّ أمنيّ**). وتسجيلُ الأجهزة في الخادم قرارٌ معلّق (أ٥).
- ‏PWA: ‏`app/manifest.ts` (أو `public/manifest.webmanifest`) + `service worker`. **وانظر
  أولًا ما فعله `apps/staff`**: ففيه مثبّتةٌ لفحص الـmanifest والـservice worker
  (‏`apps/staff/tests/offline-pos.spec.ts` بحسب تعليق `packages/web-core/tests/offline-store.spec.ts`)
  ⇒ انسخ النمطَ نفسه ولا تخترع ثانيًا.
- الدخولُ بالتسليم (handoff login): ‏`@erp/web-core/session` و`session-gate` و`token-bridge`
  قائمةٌ — والتطبيقُ يستعملها كما تستعملها بقيّةُ شاشات المخابز (‏`useSession`) ولا يبني
  مصادقةً خاصة.

### وصفةُ ترحيل شاشةٍ إلى نظام التصميم (ميكانيكية، ومُجرَّبة على `/reports`)

المرجعان القائمَان: ‏`apps/bakery/app/reports/page.tsx` (شاشةُ قراءة: خمسةُ جداولَ على
`DataTable` وبطاقاتٌ على `Kpi`) و`apps/bakery/lib/ui-kit.ts` (المحوّلاتُ الثلاثة)، وطبقةُ
`.bak-table` في `app/globals.css` للجداول التي لا تسعها `DataTable` (صفٌّ مركّبٌ قابلٌ
للتوسعة). ولكلّ شاشة:

1. **أعلن الأعمدةَ في منطق الشاشة** (`lib/<name>-screen.ts`) على شكل
   `readonly ScreenColumn[]` = ‏`{key, labelAr, numeric?, ltr?, defaultHidden?}` — فاليوم
   أعمدةُ ستّ شاشاتٍ مكتوبةٌ `<th>` في JSX ولا إعلانَ لها (بخلاف `reports-screen.ts`).
   وأضف حكمًا في مثبّتة الشاشة أنّ **كلّ مفتاحٍ معلنٍ هو حقلٌ فعلًا في صفّ الخادم**
   (النمطُ القائم في `tests/reports-screen.spec.ts`: «كلّ عمودٍ معلنٍ خاصيةٌ في صفٍّ بشكل
   الخادم»).
2. **اقرأ الخليةَ بدالةٍ واحدة**: إن كانت نصًّا فـ`cellText(row, column)` (نمطُ
   `reports-screen`)؛ وإن كانت غنيةً (زرٌّ أو شارة) فمُصيِّرٌ محليٌّ في الصفحة يأخذ
   ‏`(row, column)` — و`tableColumns` يقبل `ReactNode` في `readCell` (وُسِّع لهذا).
3. **استبدل الجدولَ** بـ`<DataTable columns={tableColumns(COLS, reader)} rows={…}
   rowKey={rowKeyFrom(['id', …])} state={listState({loading, error, forbidden})} sortable
   sort={sort} onSortChange={setSort} storageKey="bakery-<screen>-<table>" pageSize={25}
   dense empty={<EmptyState icon={…} title={…} description={…} />} />`. ومفتاحُ الحفظ
   **فريدٌ لكلّ جدول** (وإلا تشاركت جدولا شاشةٍ إخفاءَ الأعمدة).
4. **الحالاتُ الأربع**: ‏`loading` و`error` و`forbidden` من حالة الطلب، ولا تُترك القائمةُ
   فارغةً بلا قول. والبطاقاتُ ⇒ ‏`Kpi` (‏`title`/`value`/`hint`/`tone`/`delta`)، والفراغُ
   ⇒ ‏`EmptyState` (و`icon` **مطلوب**، و`lucide-react` ليست من اعتمادات المخابز فاستعمل
   رمزًا تعبيريًّا ولا تُضف اعتمادًا).
5. **لا تُرحِّل قسرًا ما لا يسعه المكوّن**: صفٌّ قابلٌ للتوسعة (‏`/reps`) أو جدولُ قراراتٍ
   متداخلٌ (‏`/custody`) يبقى يدويًّا **على طبقة `.bak-table`** — ومثبّتةُ
   `tests/table-anatomy.spec.ts` تفرض أنّ كلّ `<table>` في المخابز إمّا على الطبقة وإمّا
   داخل المكوّن، فلا شكلَ ثالث.
6. **البوابات**: ‏`pnpm --filter @erp/bakery run typecheck` ثم `run lint` ثم
   `exec vitest run` ثم `run build` (وراقب حجمَ أوّل تحميل: ‏`DataTable` تضيف ~٤٠ kB،
   فاستعملها حيث تُفيد فعلًا — القوائمُ الطويلة — لا لكلّ جدولٍ من ثلاثة صفوف).

والبنودُ الباقية في التصميم (لم تُنفَّذ): ‏`Skeleton`/`SkeletonRows` لحالات التحميل بدل
نصّ «يُحمَّل…»؛ و`Toast` بدل فقرات التنبيه المنسوخة في تسع صفحات (`type Notice` +
`NOTICE_CLASSES` معرَّفان في كلّ صفحة)؛ و`Select`/`MoneyField`/`DateRangePicker`/`Combobox`
بدل `<select className={selectClass}>` (و`selectClass` منسوخٌ ثلاثَ مرّات)؛ و`FilterBar`
لأشرطة التصفية؛ و`Badge`/`statusTone` لنُبَذِ الحالة بدل `bak-badge` اليدوية؛ و`Modal`/
`ConfirmDialog` لحوارات التأكيد (كاعتماد الإقفال). وكلُّ بندٍ منها يُقاس قبله: ما الذي
تفعله الشاشةُ اليوم، وما الذي يضيفه المكوّن.

### ما بعد المرحلة الرابعة

- الطور ٥: تقريرُ التنفيذ الفعليّ (موجودٌ نمطُه في التقرير الحالي).
- الشاشاتُ المخطّطة المتبقّية في `lib/navigation.ts`: ‏`treasury` (سطحُ الخزينة **لم يُقرأ
  بعد** — بندُ ب٩) و`accounting`.

---

## ٥. قواعدُ البيت وفخاخُ البيئة (كلُّها مُصابةٌ فعلًا)

### الاختباراتُ والقياس

- **رمزُ خروج vitest في هذه البيئة ٠ دائمًا حتّى مع الفشل** ⇒ لا تقل «خرج ٠ إذن أخضر»؛
  اقتبس سطرَي ‏`Test Files N passed (N)` و`Tests N passed (N)`.
- ‏`vitest run مسار خاطئ` **يصمت** ويشغّل الصحيحَ وحده ⇒ تحقّق من عدد الملفات.
- شغِّل الترجمةَ **بعد** كتابة ملفات الاختبار الجديدة (`pnpm -r run typecheck` أمسك
  TS2322 في مثبّتةٍ لم ترَها تشغيلاتُ التطبيق وحده).
- **الأرقامُ في التوثيق تُستخرج من السجلّ لا من الذاكرة**: في ١٣و كتبتُ «٦٠.٠٠ قبل
  الإصلاح» فقيس التخريبُ **٥٢.٠٠** وصُحِّح.
- أثبت أنّ أحكامَك تعضّ: ‏`cp` ← تخريب ← تشغيل ← فشلٌ مطابق ← استعادة ← `md5sum`.
- **احفظ النسخةَ المُصلَحة قبل التخريب** (درسُ ١٣أ).
- مثبّتاتُ الـAPI تحتاج أحيانًا `permissions: [...ALL_TENANT_PERMISSIONS, 'accounting.period.close', …]`:
  فقائمةٌ صريحةٌ تحلّ محلّ المجموعة الافتراضية كلّها، و`ALL_TENANT_PERMISSIONS` **ينقصه**
  `accounting.period.close` (قِيس: ‏٤٠٣ عند إنشاء سنةٍ مالية).
- ‏`createActor` بـ`isOwner: true` **بلا** `permissions` لا يمنح `van_sales.view` (قِيس: ‏٤٠٣
  على `/van-sales/me`) ⇒ اذكر الصلاحيات صراحةً لمن يقرأ التوزيع.
- مثبّتةٌ تقرأ سجلّاتٍ عبر **اتصال المالك بلا مرشِّح مستأجر** تصير رهينةَ ما تكتبه الملفات
  الأخرى بالتوازي (درسُ `AUD-14` في ١٣و: ضيّق القراءةَ إلى مستأجري المثبّتة، وأثبت
  التضييقَ بسجلٍّ طُعم).
- `ECONNRESET` من supertest في التشغيل الكامل = فشلُ اتصالٍ لا حكم؛ وأوقف `db:local`
  الخلفيةَ قبل الحزمة الكاملة (سجلُّ القاعدة أظهر `checkpoint … write=358s`).

### قاعدةُ البيانات والهجرات

- **الحقيقةُ في القاعدة لا في drizzle**: قِس `information_schema.columns` (‏`column_default`,
  `is_nullable`) بمثبّتةٍ مؤقّتة تُحذف بعد القياس. وفي ١٣ج قِيس أنّ `unit_cost`
  الافتراضيُّ الحيّ **٣.٨٠** بينما `0119` أنشأ العمودَ بـ٠ و`0120/0121` أضافاه بـ٣.٨٠.
- الهجراتُ ملفاتُ ‏`.sql` مرتّبةٌ بالاسم، تُنفَّذ في `BEGIN/COMMIT` (فـ`CREATE INDEX
  CONCURRENTLY` مستحيل: ‏٢٥٠٠١)، ومحميّةٌ ببصمةٍ (تحريرُ ملفٍّ مطبَّق ⇒ خطأ)، وانعكاسُها في
  `migrations/down/<name>.down.sql`. ولا تلمس `rls.ts`.
- الإدراجُ الجماعيّ بـSQL يجب أن يذكر **كلّ عمودٍ `NOT NULL` بلا افتراضيّ** — وبعد ٠١٣١ صار
  `factory_production_batches.item_name` منها (فأُضيف إلى أربعة إدراجاتٍ في ثلاثة ملفات).
- ‏`= ANY(${jsArray})` **لا يعمل** عبر drizzle `sql` + node-postgres (و`::text[]` أيضًا) ⇒
  ‏`sql.join` في `IN (VALUES …)` أو جمعٌ في JS. وأمّا عبر `pg` الخامّ فـ`= ANY($1::uuid[])`
  يعمل.
- `sales_invoice_lines.cost_total` ‏**NOT NULL** (افتراضيُّه ٠) ⇒ مسودةُ إشعارٍ دائن تحمل
  صفرًا لا NULL.

### الكود والـlint

- قاعدةُ المال تمنع معرّفاتٍ اسمُها **بالضبط** ‏`price|amount|total|balance|cost|rate`
  (وتعبيراتُ الأعضاء سليمة) ⇒ ‏`priceText`, `unitCost`, `chargeValue`, و`AS valuation` في SQL.
- ‏`@erp/*` **خارجية** عند الـlint: لا سطرَ فارغًا داخل مجموعة الاستيراد، والسطرُ الفارغ
  يكون **قبل أوّل استيرادٍ نسبيّ** (أخطأ ملفّي الجديد في ١٤أ فأمسكه الـlint).
- ‏`node:` مدمجةٌ وتحتاج سطرًا فارغًا قبل الخارجيات.
- **لا تعليقَ بداخل قالب `sql\`** فيه شرطاتٌ مائلةٌ معكوسة: تُنهي القالبَ (‏TS1005/TS1127) —
  ضعه فوق `const x = first(await tx.execute(sql\`…\`))`.
- الأنواعُ على مستوى الوحدة تُدرج **فوق `@Injectable()`** (لا بين المزخرف والصنف ⇒ TS1206).
- في python-الرقع: ‏`assert s.count(anchor) == n` لكلّ مرساة، ولا تُعد استعمالَ نصٍّ
  مُحوَّلٍ كمرساة حذف، و`grep` كلّ معرّفٍ حُذف، وانتبه لسطرين فارغين متتاليين (خطأ lint).
- ‏`next build` أثناء `next dev` يُفسد `.next`؛ وضغطُ الذاكرة يقتل خوادم التطوير.
- ‏`grep -c` مع صفر نتائج ⇒ خروج ١ (يظهر كأنّه فشلٌ وهو ليس كذلك)؛ و`| tail -N` يُخفي
- **عددُ الأسطر (وأيُّ رقمٍ في التوثيق) يُؤخذ من مخرَج الأمر لا من التقدير**: وقع مرتين أن
  كُتب «٢٥٨٨ سطرًا» و«٢٨٩٩ سطرًا» في وثيقة التسليم بينما `wc -l` في **الأمر نفسه** قال
  ٢٦٩٦ و٢٩٤٩ — فالتوثيقُ الذي يُخالف مقياسَه في الالتزام نفسه يفقد ما يُثبته. والقاعدة:
  قِس أولًا، ثمّ اكتب الرقمَ من المخرَج.
- **الأحكامُ النصّية على المصدر تُصاب بشيئين** (وقعت ثلاثَ مرّات): التعليقُ الذي يذكر الشيءَ
  **نفيًا** (‏`maximumScale` في شرح الجذر، و`erpcloud-staff-shell` في شرح العامل، و
  `/van-sales/offline-sync` في شرح الطابور) ⇒ فالحكمُ على شكل الخاصّية أو السطر البرمجيّ
  (‏`/maximumScale\s*:/` و`const CACHE_NAME = '…'`)؛ و«آخرُ كتلةٍ في الملفّ» حين يكون فيه
  كتلتان بالاسم نفسه (`@media print` في قشرة المكتب وفي طبقة المندوب) ⇒ فالحكمُ يُؤخذ من
  **علامة الطبقة** لا من طرف الملفّ.
  أخطاءَ TS ⇒ استعمل `grep -E "error TS"`؛ والشرحاتُ المائلة المعكوسة في أنماط grep تكسر
  ‏`bash -c`؛ و`grep -rn apps/bakery` يصيب `.next`.

### البذرُ والقاعدةُ الحقيقيّة (‏١٩ — أربعةُ فخاخَ أُصيبت فعلًا)

1. **مرآةُ drizzle ليست مصدرَ الحقيقة — الهجراتُ هي.** بذرةُ المندوب سقطت بـ
   ‏`column "deleted_at" does not exist` لأنّ `salesmen` في `packages/database/src/schema/sales.ts`
   يحمل `...baseAuditColumns()` بينما **الجدولُ الحقيقيّ بلا `deleted_at`** (وكذلك `users`).
   وقِيس على `information_schema` بعد `db:migrate`: ‏`salesmen` ‏NO، `users` NO، و
   `employees`/`roles`/`memberships`/`warehouses` YES. واستعلامُ الخدمة نفسه
   (‏`resolveSalesmanForMembershipInTx`) يصفّي `deleted_at` على `employees` وحده — وكان
   هذا هو الدليل. **فأيّ SQL جديد يُكتب: قِس الأعمدةَ على قاعدةٍ مُهاجَرة لا على المرآة.**
2. **‏`@erp/database` تُقرأ من `dist` لا من `src`.** ‏`main: ./dist/index.js`، فبعد تحرير
   `src/seed-demo.ts` لا بدّ من `corepack pnpm --filter @erp/database run build` قبل
   `db:seed` — وإلّا أعاد السكربتُ الخطأَ نفسه بعد «إصلاحه» (حدث، وكلف تشغيلين).
   و`pnpm run typecheck` من الجذر يبني الحزمَ كلّها فهو يكفي.
3. **‏`rowCount` ليس عددَ الصفوف.** في أداة التدقيق، `SELECT count(*) …` يُعيد **صفًّا
   واحدًا** ⇒ `rowCount = 1` دائمًا، فقالت الأداةُ «صفٌّ واحد» عن قاعدةٍ لا مستندَ خطٍّ
   فيها أصلًا. والعددُ يُقرأ من العمود (`rows[0].n`). وصنفُ الخطأ نفسه الذي وقع في
   مسبار CSS الشريحة ١٨: **قياسٌ يقيس وسيطَه بدل الواقع.**
4. **ملفاتُ الاختبار ESM: لا `__dirname`.** مثبّتةُ `navigation.spec.ts` تستعمل
   ‏`fileURLToPath(new URL('../app', import.meta.url))` — ومن يكتب `__dirname` فيها
   يرفع `ReferenceError` لا فشلَ مقارنة. و`readFileSync` تُستورد صراحةً (الملفُّ كان
   يستورد `existsSync, readdirSync` فقط).

### الأدواتُ والمرافق (‏٢٣ — خمسةُ أمورَ أُصيبت فعلًا)

1. **ترتيبُ وسائطِ المساعد يُصيب مرتين**: ‏`req(method, path, token, body)` نُوديت
   ‏`req('POST','/auth/login',{…})` ⇒ الجسمُ صار الرمزيةَ والرمزيةُ صارت الجسم، فالخادمُ ردّ
   ‏٤٠٠ «Validation failed» برسالةٍ غريبة («Unexpected token … "eyJhbGciO…" is not valid
   JSON»). والقاعدة: **اقرأ رسالةَ ٤٠٠ كاملةً** — فإن ذكرت جزءًا من جسمِ طلبك فهي من عندك.
2. **إدراجٌ في YAML قد يكسر مدخلًا مجاورًا**: مدخلُ `images:` الجديد هبط **وسط** مدخل
   ‏`erp-bakery` فصار `newTag` مفقودًا للأول ومكرّرًا للثاني (والأخيرُ الغالب ⇒ ‏`latest`)،
   ولو نُشر لفشل سحبُ صورة المخابز (‏`ImagePullBackOff`) — وكشفته **بوابةٌ قائمة** لا العين.
   والقاعدة: بعد أيّ إدراجٍ في YAML شغّل مثبّتةَ السطح، وأضف حكمًا على المدخل المجاور.
3. **أداةُ إصلاحٍ تعالج ما أصلحتْه**: بعد تنفيذ الطريق (ب) صار اسمُ المجموعة التاريخية
   «ضريبة القيمة المضافة 15% — مجموعة تاريخية بنسبةٍ خاطئة (0.15%)…» — وأوّلُ مطابقةٍ
   للنسبة في الاسم «15%» ⇒ فرأت الأداةُ نفسها خاطئةً في التشغيل الثاني وكانت ستُعيد
   تسميتها. وأُصلحت بسمةٍ صريحة (`HISTORICAL_MARKER`) تُقرأ قبل المعالجة. والقاعدة: **شغّل
   أداتَكَ مرّتين** — فالثانيةُ امتحانُ العُدول (‏idempotency) والأولى لا تكفي.
4. **‏RLS يُخفي الصفوف صامتًا** (وهو الأخطرُ في هذه القائمة لأنّه يُشبه فشلًا وهميًّا):
   ‏`select count(*) from items` بدور `erp_api` ⇒ **٠** بينما الحقيقة ٦، وبلا رسالةِ خطأ؛
   فـ`FORCE ROW LEVEL SECURITY` + سياسةُ `current_setting('app.tenant_id')` تصفيان ما لا
   يملك الاتّصالُ سياقَه. والقاعدة: القياسُ من القاعدة بدور المُرحِّل (أو بضبط
   ‏`app.tenant_id`)، ولا يُحكَم على «بذرٍ فشل» من قراءةٍ واحدة.
5. **‏`exports` في الحزم تمنع حلَّ مساراتٍ داخلية**: ‏`require.resolve('tsx/dist/cli.mjs')`
   ⇒ ‏`ERR_PACKAGE_PATH_NOT_EXPORTED` (وقِيس)، والحلُّ بناءُ المسار من
   ‏`require.resolve('tsx/package.json')`. و`pg` لا تُحلّ من `scripts/` في الجذر (pnpm صارمّ)
   ⇒ ‏`createRequire(packages/database/noop.js)` (والمستودعُ نفسه فيه `noop.js`).

### الشاشاتُ والنسخُ والأدوات (‏٢٢ — خمسةُ أمورَ أُصيبت فعلًا)

1. **نصُّ العميل ليس نصَّ المهندس**: ‏`planAr` سجلٌّ هندسيّ (مساراتُ API وأسماءُ ملفاتٍ
   وأرقامُ شرائح ورموزُ أخطاء) وكان يُطبع كاملًا على كلّ بطاقةٍ — وهذا بعينه ما شكا منه
   صاحبُ العمل («بياناتٌ تظهر في الشاشات لا تصلح للإنتاج»). والفصلُ المعتمد: ‏`summaryAr`
   ظاهرةٌ (٤٠–١٦٠ حرفًا، وتثبّت المثبّتةُ خلوَّها من ٣٠ مصطلحًا داخليًّا)، و`planAr`
   والمساراتُ داخل `<details className="bak-tech">` مطويّةً (فلا تُحذف — وحذفُها خسارةُ
   الصدق). وكاشفُ التسريب في `tests/navigation.spec.ts` يفحص **كلّ سطرٍ عربيٍّ في
   ‏`app/page.tsx`** فيه مسارٌ أو رمزٌ وليس تعليقًا ولا داخل مطويّة.
2. **‏`toContain` على نصّ أمرٍ يُشبعه `echo`**: بوابةُ «التحقّقُ من الأرشيف» مرّت بعد حذف
   أمر `pg_restore --list` نفسه لأنّ سطرَ `echo "↻ التحقّقُ بالأرشيف (‏pg_restore --list)"`
   أشبعها (قِيس). فالتوكيدُ على **أمرٍ في بداية سطر**: ‏`/^\s*pg_restore\s+--list\s+"?\$FILE/m`.
   وهذا الوجه الثاني لفخّ «الادّعاءاتُ النصّية تصطاد التعليقات» (الأولُ `tr` داخل
   ‏`transition-colors` في ١٧).
3. **‏`pnpm run <s> -- --flag` يمرّر `--` وسيطًا حرفيًّا**: ‏`node script.mjs "--" "--report-only"`
   ⇒ فسكربتُ الجذر يجب أن يتخطّى `--` الصريحة وإلا طبع المساعدةَ (وأُصيب `demo:line`).
4. **حزمٌ لا تُحلّ من الجذر**: ‏`pg` تابعةٌ لـ`packages/database` فاستيرادُها من
   ‏`scripts/*.mjs` يرمي `ERR_MODULE_NOT_FOUND` (pnpm صارمٌّ) ⇒ ‏`createRequire(…/packages/
   database/noop.js)` ثمّ `require('pg')`. وكذلك `tsx/dist/cli.mjs` **خارج خريطة `exports`**
   (‏`ERR_PACKAGE_PATH_NOT_EXPORTED`) ⇒ يُبنى المسارُ من `require.resolve('tsx/package.json')`
   (النمطُ نفسه في `scripts/next-run.mjs` مع `next`).
5. **‏`jsonb` تُمرَّر نصَّ JSON صالحًا دائمًا**: ‏`pg` تُعيد القيمةَ محلّلةً (`'SAR'`, `false`,
   ‏`1`)، وإرجاعُها كما هي يصل بالخادم نصًّا غيرَ صالح («invalid input syntax for type
   json» — وسقط على `cash_locations` ثمّ `tenant_settings`). و`bytea` (عمودان فقط في
   المخطّط: ‏`users.mfa_secret_enc` و`esign_requests.signed_pdf`) تُحمل base64 وتُستعاد
   بـ`decode(…,'base64')::bytea`.

### البذرُ والإصلاحُ والخزينة (‏٢٠ — تسعةُ أمورَ أُصيبت فعلًا)

1. **‏`ON CONFLICT … DO NOTHING` يعني أنّ البذرةَ لا تُحدّث أبدًا.** ملفُّ منشأةٍ قائمٌ لا
   يتغيّر ولو جُعلت قيمُه من البيئة. فمن يجعل قيمةً «قابلةً للضبط» في بذرةٍ عليه أن يقيس
   ما في القاعدة (`… RETURNING` لمن كُتب، وقراءةٌ لمن لم يُكتب) ويعلن الفرق — وإلا ظنّ
   المُشغِّل أنّ رقمَه الضريبيّ كُتب وهو لم يُكتب.
2. **خمسةُ أسماءٍ مُخمَّنة لم توجد**: ‏`van_sales_return_documents` و`van_sales_load_orders`
   و`inventory_lots` و`factory_production_orders` و`salesmen.salesman_name`. والحقيقةُ:
   ‏`van_load_orders`، و`item_lots`، والمرتجعاتُ **صفوفٌ في `van_sales_documents`** بـ
   ‏`document_kind='return'` + `reference_document_id`، وإشعارُ الدائن `sales_invoices.kind`
   + `reference_invoice_id`. فـ`information_schema` أولًا، ومرآةُ drizzle ليست القاعدة.
3. **‏`NOT NULL` هو ما يقرّر معنى «الصدق»**: ‏`van_sales_documents.unit_cost` ‏NOT NULL
   default 0 ⇒ الصدقُ **صفرٌ مقاس** لا فراغ؛ و`batch_code` nullable ⇒ الفراغُ صادق؛ و
   ‏`factory_production_batches.item_name` و`batch_no` ‏NOT NULL ⇒ **لا تُفرَّغان أبدًا**
   (وتفريغُ `item_name` كذبٌ، واستبدالُه باسمٍ آخر اختراعٌ ثانٍ — فالمخرجُ `items.name_ar`
   من الربط القائم، وبلا ربطٍ يُترك ويُعدّ). و`van_sales_documents` **بلا `updated_at` ولا
   `version`** فلا يُكتبان.
4. **أرقامُ وسائط SQL المكتوبة يدًا صنفُ عيبٍ كامل**: ‏`AND t.code = $3` في ثمانية
   استعلامات عملت ما دام لكلٍّ وسيطان قبلها، فسقط `--tenant` بـ`could not determine data
   type of parameter $2` (استعلامٌ له وسيطٌ واحد). والصوابُ حسابُ الرقم لكلّ استعلام.
5. **التخريبُ يجب أن يزيل الحارسَ كلّه** (الشرطَ **والوسيط**): إزالةُ الشرط وحده تُنتج
   خطأَ ربطٍ يُسقط أحكامًا أخرى ولا يثبت شيئًا. **وفراغُ التغطية لا يُرى إلا بتخريبِ كلّ
   حارسٍ مكرّر على حدة** — فهكذا وُلد الحكمُ ١٢ (حارسُ الكتابة في فئة المرتجع كان بلا
   اختبار لأنّ الحكمَ ١١ كان يُخرّب صفَّ دفعةِ إنتاج).
6. **مَن يكتب سندَ القبض؟** ‏`POST /van-sales/collections` (`van-sales.service.ts:6953-7027`)
   **يُنشئ السند ويرحّله**: ‏`kind:'receipt'`، ‏`subtype: party?'customer':'account'`،
   ‏`method:'cash'`، ‏`referenceNo` = رقمُ مستند الخطّ، ‏`salesmanId` = ‏`employee_id`،
   ‏`idempotencyKey` = ‏`van-collection-voucher:<documentId>:<key>`، و`postVoucherInTx`
   (‏Dr الصندوق / Cr الذمم) — **ويبقى مسودةً** حين لا يُحلّ حسابٌ مقابل (ملفُّ الترحيل
   ‏`receipt_voucher.receivableAccountId`) ويقول المسارُ ذلك. فأيةُ شاشةٍ جديدة **لا تُنشئ
   سندًا ثانيًا على النقد نفسه** (قبضٌ مزدوج)، ومفتاحُ عدم التكرار هذا هو **كاشفُ سندِ
   الخطّ** الموثوق — لا `referenceNo` (فسندٌ يدويٌّ قد يحمل رقمَ مستند) ولا البيان.
   والمسودةُ تعني «قُبض ولم يدخل الخزينةَ ولا الدفتر» — وهي فجوةٌ تُقال لا تُغطّى.
7. **‏`GET /vouchers` ترجع مصفوفةً عارية بـ`.limit(500)`** بلا `meta.total` ولا مجاميع ⇒
   لا إجماليَّ يُشتقّ منها أبدًا (خطأُ ١٣أ: مجموعُ نافذةٍ مقطوعة بعنوان «الإجمالي»)؛ وعند
   ملامسة السقف **لا يُعرض مجموع** ويُقال القصّ. وأمّا `GET /cash-locations` فبغلاف
   ‏`{data, meta}`. و`cash_location_balances` **كاشٌ مُطابَق** («the truth is the ledger» في
   عقد `@erp/contracts`) ⇒ يُقال ذلك في عنوان العمود، وبلا صفٍّ «—» لا صفرٌ مُخترع.
8. **ساعةُ الحائط في المثبّتة عيبٌ لا مصادفة** (عائلةُ ب٨): مرشّحا `fromTime`/`toTime`
   يقارنان `posted_at` (‏`report-catalog.ts:340-341,373`) والفواتيرُ تُرحَّل بـ`now()` ⇒
   «من ٢٣:٥٩ ⇒ ٠ صفوف» كاذبٌ في الدقيقة الأخيرة من اليوم UTC فقط. والإصلاحُ تثبيتُ
   الساعة **وإعادتها** في `finally` (وشدُّها إلى ١٠:٠٠ من اليوم نفسه حتى لا يتغيّر اليومُ
   على الأحكام اللاحقة) + حكمٌ يميّز التثبيتَ عن الصدفة (`fromTime=10:01` ⇒ ٠ و`toTime=10:00`
   ⇒ ٣). **وإعادةُ التشغيل خارج النافذة لا تثبت شيئًا** — فالإثباتُ شدُّ التثبيت إلى
   الساعة التي أسقطت الحكمَ ورؤيةُ الفشل نفسه.
9. **صفرُ الرصيد المزروع ليس رصيدًا** (قِيس حيًّا في ٢٠ح): ‏`cash_location_balances` تُزرع
   ‏`balance=0` عند إنشاء الموضع **بلا `updated_at`** (‏`cash-locations.service.ts:198-202`
   وتعليقُه «Seeds the balance row at zero — PHASE_12 writes it, a report reconciles it»،
   والعمودُ nullable والجدولُ بلا `created_at`). فمنشأةُ `demo` كلّها ترجع `0.0000` مع
   ‏`updatedAt:null` — وعرضُ ذلك «0.0000 SAR» يقول «الصندوقُ فارغ» وهو لم يُحسب. والقاعدةُ
   في `lib/treasury-screen.ts`: ‏`isReconciled(row)` (‏`updatedAt` وحدها الدليل) ⇒ غيرُ
   المُطابَق «لم يُطابَق بعد (SAR)»، والمُطابَقُ يُعرض رقمُه ولو صفرًا، وعمودُ «آخر مطابقة»
   من `momentText(updatedAt)` وبلا مطابقةٍ «—». والتخريبُ (حذفُ سطر الحارس) ⇒ حكمان بـ
   ‏`expected '0.0000 SAR' to be 'لم يُطابَق بعد (SAR)'`.
10. **بواباتُ المستودع لا تُشغَّل وخوادمُ التطوير قائمة**: الخوادمُ الثلاثة (‏`tsc --watch`
    للـAPI + ‏`next dev` ×٢) مع `pnpm run typecheck` رفعت الحملَ إلى **٢٧٫٦٦** فتجاوزت
    السلسلةُ حدَّ الأداة (٩٠٠ ثانية) وقُتلت بعد انتهاء الترجمة (١٤ `Done`، بلا `error TS`)
    وقبل أن يبدأ الـlint. وأُعيد الـlint بعد إيقاف خادم الـAPI ⇒ الحملُ ٠٫٢٧ والوقتُ **٤٣
    ثانية**. و`next build` مع `next dev` قائمٍ يُفسد `.next` ⇒ يُوقف الخادمُ قبله ويُعاد بعده.
    وخادمُ الـAPI يُعاد بسرعةٍ من `dist` (‏`pnpm --filter @erp/api run start` = ‏`node
    dist/main.js`، ٤ ثوانٍ) إن كان `dist` مبنيًّا — فلا حاجة إلى `dev` لأجل معاينة.
### البذرةُ والمخزون والضريبة (‏٢١ — أربعةُ أمورَ أُصيبت فعلًا)

1. **البذرةُ تقرأ `dist` لا المصدر**: ‏`apps/api/scripts/seed.ts` يعمل بـ`tsx` لكنه يستورد
   ‏`@erp/database` ⇒ يُحلّ إلى `packages/database/dist`. فأُصلحت نسبةُ الضريبة في المصدر
   وبُذرت منشأةٌ **بعد الإصلاح** فخرجت بالقيمة القديمة من `dist` المبنيّ قبله. والقاعدة:
   ‏`pnpm --filter @erp/database run build` **قبل** أيّ ادّعاءٍ عن البذرة، والدليلُ
   ‏`grep rate packages/database/dist/seed-demo.js` + قراءةُ الصف من القاعدة.
2. **`tax_groups.rate` نسبةٌ مئوية لا كسر**: المحرّك `subtotal.mul(taxRate.div(100))`
   (‏`van-sales.service.ts:4627` و`:8112`) ومثبّتةُ المنتج تُنشئ ١٥٪ بـ`rate:'15'`
   (‏`report-accounting.spec.ts:175`). والبذرةُ كانت `0.1500` بتعليقٍ يقول «كسر» ⇒
   **التعليقُ كاذبٌ والرقمُ معه**، وفاتورةُ ٦٠٠ خرجت بضريبة ٠٫٩٠. والنسبةُ **تُقفل بعد أوّل
   استعمال**: ‏`PATCH …/tax-groups/:id` ⇒ ٤٠٩ `TAX_GROUP_RATE_LOCKED` متى أشارت
   ‏`sales_invoice_lines.tax_group_id` إليها (‏`catalog.service.ts:879-905`) — فمنشأةٌ بِيع
   فيها فاتورةٌ واحدة لا تُصحَّح من المنتج (بندُ ب٢٢).
3. **رجلُ المخزون الداخلة تحتاج `unitCost` صراحةً**: ‏`inventory.service.ts:293-296` تُقيّم
   الداخلة بـ`new Decimal(line.unitCost ?? '0')` — فأيّ حركةٍ بين مستودعين تُرسل رجلَها
   الداخلة بـ`costing:'inWithCost'` **بلا تكلفة** تُدخل الكميةَ بصفر قيمة (وتُخفض المتوسط).
   وأُصيب هذا في `return_to_main` (‏`van-sales.service.ts:6558+`) فأُصلح بقراءة
   ‏`inventory_transactions.unit_cost` للحركة الخارجة وتمريرها للداخلة **في المعاملة نفسها**
   — فالتماثلُ بحسب البناء لا بحسابٍ عندنا. والقاعدةُ الأعمّ: **أيُّ حكمٍ على تسويةٍ مخزنية
   يجب أن يقيس القيمةَ لا الكميةَ وحدها** (ومثبّتةُ `van-sales-stock-settlement.spec.ts` كان
   فيها `balanceValue` جاهزًا ومع ذلك كان الحكمُ يقيس `officialQty` فقط).
4. **كلُّ كتابةٍ في `van-sales` تُرجع مساحةَ العمل لا السجلّ**: ‏`POST /load-orders`
   و`/documents` و`/collections` و`confirm-receipt` تُرجع `{policy, officialStock,
   postingReadiness, windows,…}` ⇒ فمن قرأ `id` من الردّ قرأ `undefined` وأرسله في الخطوة
   التالية ⇒ ٤٢٢ «يجب اختيار أمر التحميل». والسجلّاتُ من `GET /van-sales/me` (مندوب) أو
   ‏`/dashboard` (نطاقُ منشأة). و**الجردُ `countedQty` عدٌّ لا إضافة**: فإعادةُ إرسال
   «١٠٠٠ كجم» بعد صرف ٣٥٠ تصنع فائضًا مفبركًا وقيدًا مُرحَّلًا (أُصيب فعلًا).
5. **أدواتُ القياس تكذب أيضًا**: ‏`grep -o 'text-\[12\.5px\]'` يُنتج «صنفٌ ناقص» زائفًا
   (فـ`grep -F` للقيم الاعتباطية)، و`cmd | tail` يُخفي رمزَ الخروج (فـ`cmd > /tmp/x.log
   2>&1; echo exit=$?; grep -c 'error TS' /tmp/x.log`)، و`grep -c` بلا مطابقةٍ يخرج بـ١.

### الصلاحياتُ على مستوى الصفّ (‏١٩ — القاعدةُ التي لا تُنسى)

`van_sales.view` **ليست** إذنَ قراءةِ المنشأة: فهي ما تتطلبه مساحةُ المندوب نفسه
(‏`GET /van-sales/me`)، فمنحُها لمندوبٍ كان يمنحه `dashboard` و`reports` و`salesmen`
كلَّها لأنّ `dashboard(tenantId)` لم تكن تأخذ عضويةً أصلًا. والقاعدةُ الآن:

| من | بطاقةُ `salesmen` مربوطةٌ بالعضوية | إذنُ إدارةِ الخطّ | ماذا يرى |
|---|---|---|---|
| مالك/محاسب/مشرف | لا | — | الخطَّ كلّه (كما كان) |
| مشرفٌ يوزّع بنفسه | نعم | نعم (`closing.approve`…) | الخطَّ كلّه |
| **مندوب** | نعم | لا | **خطَّه هو**؛ واللوحاتُ ٤٠٣ |
| بلا عضوية (مفتاح API/بذرة/مثبّتة) | — | — | كما كان (لا تحجيم) |

والأذوناتُ تُقرأ من **القاعدة** (`membership_roles → role_permissions`) لا من
`getTenantContext().permissions`، والقائمتان في `@erp/contracts`
(‏`VAN_SALES_COMPANY_SCOPE_PERMISSIONS` = ٥ أذونات إدارة، و
`VAN_SALES_REP_PROXY_PERMISSIONS` = `load.manage` + `closing.approve` — وهي القائمةُ
التي كانت حرفيةً **مرّتين** في `confirmReceipt` و`assertReceiptActorInTx` وصارت
واحدة، وأُضيف إليها `*` كي لا يتناقض الاستعلامُ مع الحارس الذي يقبلها).

### التصميم ونظامُ الواجهة (‏١٨ — اقرأ هذا قبل أيّ عملٍ على المظهر)

**الفخُّ الذي أكل التصميمَ كلَّه، مقاسًا:** ‏Tailwind v4 يكشف المصادرَ تلقائيًّا **ويتجاهل
`node_modules` بالاسم**، ولا `content` في `postcss.config.mjs` ولا `@source` في المستودع
كلّه (قِيس: ‏`grep -rn "@source" --include=*.css apps packages` ⇒ صفر). والحزمةُ
`@erp/ui` تصل التطبيقاتِ رابطًا في `node_modules` (‏`apps/bakery/node_modules/@erp/ui ->
../../../../packages/ui`). فالنتيجة: **كلّ صنفٍ مكتوبٍ داخل مكوّنات `@erp/ui` وحدها لا
يُولَّد مرافقُه**، ويظهر المكوّنُ بلا لونٍ ولا ظلٍّ ولا خلفية.

والأرقام (مسبارُ `postcss` + `@tailwindcss/postcss` على `app/globals.css` من جذر التطبيق،
وقبل الإصلاح):

| التطبيق | حجمُ CSS | المفقودُ من ١٠ أصنافٍ حرجة | لماذا |
|---|---|---|---|
| ‏`apps/bakery` | ٤١٤٤٥ بايت (مبنية) | ‏`.bg-brand` ٠ · `.text-brand-ink` ٠ · `.shadow-2` ٠ | ‏`bg-brand` في ٨ ملفاتٍ من `packages/ui/src` و**صفرٍ** من المخابز |
| ‏`apps/staff` | ١٠٣٦٣٤ | ١٠/١٠ | نجت `bg-brand` وحدها لأنها في ١٧ ملفًّا من الطاقم — **نجاةٌ بالصدفة** |
| ‏`apps/platform-admin` | ٩٤٨٢٥ | ١٠/١٠ | ‏ |
| ‏`apps/marketing` | ٥٣٦٤٩ | ١٠/١٠ | **لا يشغّل Tailwind أصلًا** — انظر أدناه |

والمفقودُ ليس تفصيلًا: ‏`bg-slate-950/45` + `backdrop-blur-[2px]` ⇒ خلفيةُ `Modal` في
الإنتاج **شفافةٌ بلا ضبابية**، و`z-[60]` ⇒ ‏`Toast` تحت الطبقة الخطأ، و`focus:ring-4` +
`focus:ring-brand/20` ⇒ **حلقةُ التركيز غائبة** (تنقّلُ لوحة المفاتيح أعمى)، و`bg-brand` ⇒
زرُّ «تسجيل الدخول» أبيضُ بحرفٍ داكن.

**الإصلاحُ سطرٌ واحد** بعد آخر `@import` في `app/globals.css` (وطُبِّق في المخابز والطاقم
ومنصّة الإدارة):

```css
@source '../../../packages/ui/src';
```

وبعده: المخابز ٤١٤٤٥⇒٦١٢٨٠ بايت (مبنية) · الطاقم ١٠٣٦٣٤⇒١١٤٢٩٦ (مسبار) و٩٠٤٩٢ مبنية ·
منصّةُ الإدارة ٩٤٨٢٥⇒١٠٥٧٨٥ و٨١٦١٥ مبنية — والمفقودُ **٠/١٠** في الثلاثة، والبناءُ نجح
في الأربعة. والحارسُ `apps/bakery/tests/design-source-coverage.spec.ts` (١٠ أحكام):
يقرأ `globals.css` كلّ تطبيق، ويتحقّق أنّ المسارَ يصل `packages/ui/src` وألّا يمرّ
بـ`node_modules`، وأنّ الأصنافَ الحرجةَ ما زالت مكتوبةً في المكتبة (فلا يحرس فراغًا)،
وألّا يعود خيارُ `content` فيزاحمَ `@source`. والتخريبُ قِيس: حُذف السطرُ ⇒ حكمٌ فشل
برسالته، وأُعيد ⇒ ١٩ ملفًّا / ٢٢٣ حكمًا.

**ثلاثةُ أحكامٍ عمليةٍ لا تُنسى:**

1. **التهريبُ في القياس**: ‏CSS يهرّب الحروفَ الخاصة، فـ`size-3.5` تصير `.size-3\.5` و
   `hover:text-x` تصير `.hover\:text-x` و`bg-x/45` تصير `.bg-x\/45`. وأوّلُ مسبارٍ كتبته
   أخطأ هنا فأعلن ١٠ أصنافٍ «مفقودة» وهي مولَّدة — **فلا تثق بعدِّ `grep` في صنفٍ فيه
   `.` أو `/` أو `[` أو `:` ما لم تجعل الشرطةَ المائلة اختيارية** في التعبير.
2. **‏`marketing` حالةٌ أخرى لا تُخلط بهذه**: بلا `postcss.config.mjs` أصلًا، فـ
   `@tailwindcss/postcss` لا يعمل هناك — والدليلُ في CSS المبنية: كتلةُ `@theme{--font-sans:…}`
   **خامّةٌ** (والمتصفحُ يتجاهل مجهولَ القواعد) وصفرُ مرافق (لا `.flex` ولا `--tw-` ولا
   ‏`.md:`). وصفحاتُه العامة مكتوبةٌ يدويًّا في `globals.css` (٣٩٠٣٥ بايت) وpreflight
   مطبَّقٌ أصلًا (لأنّه CSS صريحٌ يحلّه أيُّ مُجمِّع) ⇒ **الموقعُ العامّ سليم**، والمتضرّرُ
   صفحةُ `/design` (‏`DesignGalleryWithToasts`) و`ThemeToggle` وحدهما (١٦ صنفًا في مصادره
   لا يُولَّد، منها `mx-auto w-full max-w-[1400px] p-6`). وإصلاحُهما سطرٌ (إضافة
   `postcss.config.mjs`) لكنه **يُحيي المرافقَ على موقعٍ عامٍّ لم يُرَ بالعين** ⇒ تُرك
   قرارًا للمالك (بندُ ب١٤)، وحُذف `@source` من `globals.css` لأنّه هناك **خاملٌ**
   وتعليقُه سيُضلّل قارئًا. والحارسُ الأخير في المثبّتة يمسكه أماميًّا: إن ظهر إعدادُ
   postcss يومًا، صار `@source` واجبًا.
3. **‏`customer-portal`** لا يستورد `@erp/ui` ولا يستعمل Tailwind ⇒ لا شيءَ يُطلب منه.

**وما تبقّى من مظهر المخابز لم يُرَ بالعين**: لم يُفتح متصفّحٌ في هذه الشريحة، فكلُّ
قولٍ عن المظهر هنا مستندُه CSS مبنيةٌ وقواعدُ مكتوبة، لا صورة. والمطلوبُ من المالك:
`git pull` ثمّ **إعادةُ تشغيل خادم التطوير** (فـ`@source` تغييرٌ في إعداد المسح ولا
يلتقطه التشغيلُ الساخن) ثمّ تحميلٌ مع تجاوز الذاكرة — والنظرُ في `/` وشاشة الدخول
و`/reports` والوضع الداكن.

### العقد والاستجابات

- ‏`POST /auth/login` ⇒ ٢٠٠ و`data.accessToken` ويحتاج `tenantCode`؛ مساراتُ الأصناف تُعيد
  مصفوفاتٍ عارية؛ الأخطاءُ RFC-9457 بـ`detail` عربيّ و`body.code`؛ ‏POST ⇒ ٢٠١،
  PUT/PATCH ⇒ ٢٠٠؛ ‏`POST /van-sales/{load-orders,documents,collections}` تُعيد **اللوحة
  كلها**؛ والحُرّاس تعمل قبل التحقّق.
- مستنداتُ التوزيع المنشأة عبر الـAPI تحمل `doc_date = CURRENT_DATE` ⇒ تقريرٌ مصفّى بشهرٍ
  آخر لا يراها (قِيس في ١٣ب: استعمل التقريرَ بلا مدى).
- ‏`openapi:export` سكربتُ **الجذر** (لا `--filter @erp/api`) ويكتب
  `packages/contracts/openapi.json` ⇒ تحقّق من الفرق بعد تغيير المسارات.

---

## ٦. مواضعُ الملفات والمراسي

| الملفّ | لماذا يهمّ |
|---|---|
| ‏`apps/api/src/modules/van-sales/van-sales.service.ts` (~٨٢٠٠ سطر) | ‏`VAN_MONEY_SQL` و`RETURN_*_SQL` فوق `@Injectable()`؛ ‏`REPORT_ROW_CAP=2000`؛ ‏`periodTotalsInTx` (~:٧٦٥)؛ ‏`repTotalsInTx` (~:٨٧٥)؛ ‏`resolveZatcaSellerInTx` فوق `readShortagePolicy` (~:٣٠٠)؛ ‏`dashboard()` :١٢١٨ (و`policy` :١٦٠٠، و`summary` :١٤٧٦+)؛ ‏`getReports` :١٩٦٨ (و`periodTotals` :١٩٥٠+، و`filterNotes` :١٩٠٠+، وتستدعي `this.dashboard()` :١٩٨٦)؛ ‏`createProductionBatch` INSERT :٢٤٥٩؛ ‏`createCustomerPrice` :٢٨٢٦؛ ‏`createLoadOrder` INSERT :٣١٧٠؛ ‏`createDocument` :٤٢٠٠+ (حارسُ السياسة الداخلية :٤٣٦٢، حارسُ ZATCA بعده، سلسلةُ التكلفة :٤٥٦٠+، ‏INSERT :٤٦٧٠+، حمولةُ QR :٤٦٩٠)؛ ‏`resolveStockCostFallbackInTx` :٤٩٤٤ (ومعاملُ `itemIdOverride`)؛ ‏`submitClosing` :٥٠٠٠+؛ ‏`repWorkspace` :٧١٤٤+ (ومجاميعُه :٧٠٠٠+)؛ ‏`createReturnDocument` :٧٦٠٠+ (وحسابُ `returnUnitCost` :٧٧٧٣، وINSERT :٧٨٠٠+) |
| ‏`apps/api/src/modules/van-sales/van-sales.controller.ts` | ‏٢٤ مسارًا؛ أرقامُ الأسطر في جدول ١٤ب |
| ‏`apps/api/src/modules/sales/sales.service.ts` | ‏`sale_return`: مصدرُ التكلفة :١٠٧٤‑١١٣٢، وجدولُ الأرجل :١١٦٢، و`buildAutoJournal` :١١٧٧+ |
| ‏`apps/api/src/modules/einvoicing/zatca/qr.ts` | المشفِّرُ الرسميّ `buildQrPayload`/‏`decodeQrPayload` |
| ‏`packages/web-core/src/offline-db.ts` | ‏`DB_VERSION = 2`، مخزنُ `vanQueue`، ‏`enqueueVanOperation` وسائرُ الدوالّ، وحارسُ `resetOfflineStorage` |
| ‏`packages/web-core/src/idempotency.ts` | ‏`submissionIdempotencyKey`, `canonicalPayloadText`, `stableDigest`, `newSubmissionNonce`, `createSubmissionKeyTracker`, `SUBMISSION_KEY_MAX_LENGTH=120` |
| ‏`packages/web-van/src/windows.ts` | ‏`windowNote`, `windowIsComplete`, `WINDOW_LABELS`, `DEFAULT_TOTALS_CLAUSE`, `DASHBOARD_TOTALS_CLAUSE`, `REP_TOTALS_CLAUSE` |
| ‏`apps/bakery/lib/rep-queue.ts` | منطقُ الطابور النقيّ (١٤أ) |
| ‏`apps/bakery/lib/navigation.ts` | ‏`BakeryModule`؛ ‏**١١ وحدةً كلّها `ready` منذ ٢٠** (`collection, custody, distribution, overview, production, reports, reps, sales, rep-app, treasury, accounting`) — **ولا `planned` بقيت**، ومثبّتةُ `navigation.spec.ts` تقيس الاتجاهين: ‏`ready` ⇔ `page.tsx` موجودة، و`planned` ⇒ بلا `href` |
| ‏`apps/bakery/lib/{sales-screen,collection-screen,reports-screen,custody-screen,reps-screen,dashboard-windows,lookups}.ts` | منطقُ الشاشات النقيّ (والاستيراداتُ النسبيةُ بلا امتداد = هويةُ المخابز) |
| ‏`apps/staff/app/van-sales/rep/page.tsx` | شاشةُ المندوب القائمة في الطاقم (‏١٠٥٠+ سطرًا) — مرجعٌ للشكل والحقول، ومستهلكُ `/van-sales/me` |
| ‏`apps/api/test/van-sales-*.spec.ts` | ‏١٣ مثبّتةً للتوزيع (أسماءُها في §١ من التقرير لكلّ شريحة) |
| ‏`apps/bakery/lib/treasury-screen.ts` + `app/treasury/page.tsx` | منطقُ شاشة الخزينة النقيّ (اشتقاقُ الأعمدة من الصفّ، وكاشفُ سندِ الخطّ بمفتاح عدم التكرار، و`windows` للقصّ عند ٥٠٠) وصفحتُها — **بلا مسارِ كتابة على قصد** (ب٢٠) |
| ‏`apps/bakery/lib/staff-handoff.ts` + `components/staff-handoff-link.tsx` + `app/accounting/page.tsx` | سبعةَ عشرَ وجهةً في لوحة staff (`ACCOUNTING_DESTINATIONS`, `TREASURY_DESTINATIONS`, `TREASURY_NOT_LISTED`)، و`staffBaseUrl()`/‏`handoffHref()`، والرابطُ الذي يصنع الرمزَ عند النقر |
| ‏`packages/database/src/cli/demo-repair.ts` + `apps/api/test/demo-repair.spec.ts` | أداةُ الإصلاح المقياس (٢٠ب) ومثبّتتُها (١٣ حكمًا)؛ وشقيقتُها `demo-audit.ts` (قراءةٌ فقط، ١٩)؛ والأمران `pnpm db:demo-repair` و`pnpm db:demo-audit` |
| ‏`apps/api/src/modules/treasury/{treasury.controller,bank-feeds.controller,treasury.service}.ts` | المساراتُ الحقيقية: ‏`@Controller()` **فارغةٌ** (فالسنداتُ والتحويلاتُ والإغلاقاتُ ومواضعُ النقد في الجذر)، و`bank-feeds` وحدها تحت `/treasury`؛ و`vouchers()` :٢٠٣ (بـ`.limit(500)` :٢٧٢)، و`createVoucherInTx` :٣٤٠، و`postVoucherInTx` :٧٤١ |
| ‏`packages/web-core/src/token-bridge.tsx` |
| ‏`apps/api/scripts/demo-line.mjs` (أمرُ الجذر `pnpm demo:line`) | يومُ خطٍّ كامل عبر API (٢١أ): حمولاتٌ مقاسة، وتكرارٌ آمن بمفاتيحَ مشتقة من `--tag`، وحارسُ نسبة الضريبة، وقراءةُ السجلّات من `/van-sales/me` لا من ردود الكتابة، و`--report-only` و`--remaining-action` و`--no-settle-stock` و`--allow-mismatched-vat` |
| ‏`packages/database/src/seed-demo.ts:205-220` (`DEMO_TAX_GROUPS`) | نسبةُ الضريبة **مئوية** (`15.0000`) ومصدَّرةٌ ليثبّتها `seed-demo.spec.ts` (٣ أحكام) — والبذرةُ تُقرأ من `dist` فلا بدّ من بناء الحزمة |
| ‏`apps/api/src/modules/inventory/inventory.service.ts:283-300` | صيغةُ التقييم: الداخلةُ `line.unitCost ?? '0'` والخارجةُ `average` (أو `outAtOriginalCost` بـ`unitCost`) — فمن يُرسل رجلًا داخلةً بلا تكلفة يُدخل صفرَ قيمة |
| ‏`deploy/k8s/web.yaml:177-217` + `ingress.yaml:39-42` + `kustomization.yaml:55-56` + `deploy/docker-compose.yml:225-235` + `Dockerfile.web` | مرافقُ نشر المخابز كاملةٌ ساكنةً (‏Deployment/Service/Ingress/صورة/compose) — وبلا `backup` ولا مراقبة في `deploy/` و`infrastructure/` (ب٢٤) |
| ‏`apps/api/scripts/fix-vat-group.mjs` (‏`pnpm demo:fix-vat`) | تصحيحُ نسبةِ ضريبةٍ كُتبت خطأً عبر المنتج (طريقان بحسب قفل الخادم)، وسمُّ المجموعة التاريخية يمنع إعادةَ معالجتها، وقياسٌ افتراضيًّا وبلا لمسٍ للفواتير المُصدَرة |
| ‏`scripts/db-backup.mjs` (‏`pnpm db:backup`/`db:restore`/`db:verify`/**`db:drill`**) | النسخُ والاستعادة بوضعين، و`drill` اختبارٌ كامل (نسخة ← قاعدةٌ مؤقّتة ← ترحيل ← استعادة ← عدّ ← حذف) — وقِيس أخضر |
| ‏`deploy/k8s/backup.yaml` + `monitoring.yaml` + `overlays/monitoring/` | النسخُ اليوميّ بتحقّقٍ واحتفاظ، والاستعادةُ المعلّقة، والفحصُ الدوريّ بنبضة «رجلٍ ميت»، وقواعدُ Prometheus في طبقةٍ اختيارية (‏CRD) |
| ‏`packages/config/src/deployment-surface.spec.ts` (٣١ حكمًا) | سطحُ النشر **والنسخ والمراقبة** بنيويًّا: فكلُّ ملفٍّ جديد في `deploy/k8s/` يُقاس فورًا (والقراءةُ بالمجلّد لا بقائمة) |
| ‏`docs/BAKERY_PRODUCTION_READINESS.md` + `docs/ANDROID_REP_APP_BRIEF.md` | الجاهزيةُ للإنتاج بما قِيس (وما لم يُقَس مُعلَن) · مطالبةُ تطبيق أندرويد للمندوبين بعقدٍ مقاس | ‏`TokenBridge` و`handoffAction` و`HANDOFF_FAILED_MARKER='failed'` — آليّةُ التسليم التي تستعملها `/accounting` (‏AUD-08) |
| ‏`packages/database/migrations/0131_van_sales_honest_defaults.sql` (+‏`down/`) | آخرُ هجرة؛ والقادمةُ ٠١٣٢ |
| ‏`docs/BAKERY_APP_PHASE3_SLICE4_REPORT.md` | سجلُّ الشرائح (آخرُها §٢٠) + §«سجلُّ البنود المفتوحة والقرارات المطلوبة» (٦ قراراتٍ + ١٢ بندَ عمل) — **وهذا السجلُّ لم يعد آخرَ الملفّ** منذ أُضيفت §٢٠ بعده، فالمؤشّرُ الحيّ هو §٧ من هذه الوثيقة |

---

## ٧. البنودُ المفتوحة (مؤشّر)

القائمةُ الكاملةُ في آخر `docs/BAKERY_APP_PHASE3_SLICE4_REPORT.md` — قسمُ «سجلُّ البنود
المفتوحة والقرارات المطلوبة». واختصارُها:

- **قراراتٌ للمالك**: أ١ هامشُ البيع بلا تكلفةٍ معلومة؛ أ٢ كاتبُ
  `allowInternalDeliveryWithoutTax` (لا توصل إليه شاشةٌ وجملةُ رفض ZATCA تذكره مخرجًا)؛
  أ٣ صحّةُ صيغة الرقم الضريبي؛ أ٤ مصدرُ هويّة البائع في `einvoicing`؛ أ٥ تسجيلُ أجهزة
  المندوبين؛ أ٦ بنودٌ أقدم (تكلفةُ الفاقد، ضريبةُ البونص، ضريبةُ التسليم الداخلي، تأريخُ
  المستندات، طباعةُ فاتورةٍ لم تُصدر، إسنادُ الدفعات).
- **عملٌ أقوده**: ب١ ~~تكلفةُ العجز في `submitClosing` لأمرٍ بلا صنف~~ **أُقفل في ١٦أ** (مصدرُ تكلفةٍ أخير
  قبل أسعار البيع: متوسطُ `unit_cost` لمستندات الأمر، أساسٌ `document_unit_cost` بلقبٍ في
  ‏`@erp/web-van/custody` وبلا هجرة — وقِيس عجزُ ٢ كجم ⇒ ٨.٠٠٠٠ لا ٢٠.٠٠٠٠؛ وبقيت الحالةُ
  الأضيق «مستنداتٌ بلا تكلفة» وهي بندُ أ١ نفسه)؛ ب٢ مراجعةُ
  الفهارس للمجاميع الجديدة؛ ب٣ `customerPriceAuditReport` على `created_at` بـUTC؛ ب٤ تكرارُ
  `resolveBusinessTimeZoneInTx` في `payroll-compliance.service.ts:88`؛ ~~ب٥~~ **أُقفل في ١٥ج**
  (‏`movementDate` يتحقّق من الصيغة والتقويم قبل `::date`، ومدىً مقلوبٌ يُرفض، و
  ‏`movement_type` مجهولٌ يُرفض بدل تطبيعٍ صامت) وبقي منه: رموزُ الخطأ غيرُ مسجّلةٍ في
  ‏`@erp/contracts` ومسحُ مواضع `::date` الأخرى؛
  ب٦ `getReports` تستدعي `dashboard()`؛ ب٧ `truncated`
  بلا ترقيم صفحات؛ ب٨ مثبّتاتٌ بمساعد `today()` بـUTC (وأُضيف إليها في ٢٠ عضوٌ مُصلَح: ⏰ `report-invoices.spec.ts` — ساعةُ الحائط تُثبَّت وتُعاد)؛ ب٩ سطحُ الخزينة لم يُقرأ؛
  ب١٠ دقّةُ معاينة الضريبة؛ ب١١ تنظيفُ الصفوف القديمة من ٣.٨٠؛ ب١٢ `total` في صفّ المرتجع
- **ب١٧ — أُقفل في ٢٠** (قرارُ المالك: **الهويةُ من البيئة · التراثُ يُصلَح · ولا حذف**):
  (أ) ‏`DEMO_COMPANY_{NAME_AR,NAME_EN,TAX_NO,CR_NO,PHONES,EMAIL,COUNTRY_CODE}` في
  ‏`env:setup` و`.env.example` و`apps/api/scripts/seed.ts`، وافتراضيُّها قيمُ العرض القديمة
  (`DEMO_COMPANY_PLACEHOLDERS`) حتى لا يتغيّر تثبيتٌ قائم — لكنها **تُقاس وتُعلن**: الإدراجُ
  ‏`… DO NOTHING RETURNING tenant_id` فـ`companyWritten` من القاعدة، والتحذيرُ يُحسب على ما
  كُتب أو سيُقرأ، وملفٌّ قائمٌ **لا يُدهس** (يُقال: «عدّله في staff → الإعدادات»). وقِيس
  مرّتين: منشأةٌ قائمة ⇒ ‏`⚠` خمسةُ حقولٍ وبلا كتابة؛ ومنشأةٌ جديدة ⇒ بلا `⚠` والقيمُ
  مقروءةٌ من `company_profiles` (ومعها `DEMO_REP_VEHICLE_PLATE` ⇒ `vehicle_plate` في بطاقة
  المندوب، وكان فارغًا في ١٩ على قصد). (ب) ‏`pnpm db:demo-repair`
  (`packages/database/src/cli/demo-repair.ts`) — قياسٌ افتراضيًّا، و`--apply` تكتب في معاملةٍ
  واحدة بعد نسخةٍ JSON في `.demo-repair/` (في `.gitignore`)، بحدٍّ من
  ‏`erp_migrations.applied_at` لـ`0131` ورفضٍ بلا تطبيقها، وأربعِ فئات (تكلفةُ المرتجع من
  إشعاره الدائن وإلا صفرٌ صادق · ‏`batch_code` ⇒ ‏NULL · ‏`item_name` ⇒ ‏`items.name_ar` ·
  وبـ`--fix-batch-cost` وحدها دفعةٌ تناقض نفسها)، وثلاثةِ «يُعدّ ولا يُصلَح» (صفُّ بيعٍ
  بـ٣٫٨٠ قبل الحدّ · دفعاتُ إنتاجٍ بـ٣٫٨٠ · ‏`production_batch_no` تُركت عمدًا في `0131`)،
  وحارسِ قيمةٍ مقاسةٍ في كلّ `UPDATE` (فصفٌّ تغيّر بين القياس والكتابة يلفّ المعاملةَ كلّها
  ويُسمّى)، وعاديةٍ (تشغيلٌ ثانٍ يجد صفرًا). و`apps/api/test/demo-repair.spec.ts` **١٣/١٣**
  على قاعدةٍ مُرحَّلة حقيقية تُحاكي التراث بإعادة `created_at` إلى ما قبل `applied_at`
  المقروء، والتخريبُ قِيس مرتين والاستعادةُ بالبصمة. **ولا شيءَ يُحذف** — والأداةُ إصلاحٌ
  مقياسٌ لا مكنسة. وبقي مفتوحًا منه: **لم تُجرَّب على قاعدةِ عميلٍ تراثية حقيقية** (فلا
  واحدةَ هنا كُتبت قبل `0131`)، و`--fix-batch-cost` لم تُجرَّب إلا في المثبّتة وهي مقفلةٌ
  افتراضيًّا وتبقى كذلك.
- **ب١٨ — أُقفل في ٢٠** (قرارُ المالك: **الوحدتان تُبنيان**): ‏`treasury` صارت شاشةَ قراءة
  في `app/treasury/page.tsx` + `lib/treasury-screen.ts` (أربعةُ `Kpi`، مواضعُ النقد
  وأرصدتُها، سنداتُ الخطّ، كلّ سندات المدى، وبطاقةُ «ما لا تفعله هذه الشاشة») — **قراءةٌ
  لأنّ مسارَ التحصيل يكتب السندَ ويرحّله أصلًا** (انظر §٥ «مَن يكتب سندَ القبض؟»)؛ و
  ‏`accounting` صارت شاشةَ تسليمٍ في `app/accounting/page.tsx` + `lib/staff-handoff.ts` +
  ‏`components/staff-handoff-link.tsx` بسبعةَ عشرَ مسارًا حقيقيًّا (١١ في
  ‏`apps/staff/app/accounting` و٦ في `/treasury`) عبر `POST /auth/handoff`، وبلا عنوانٍ
  مُخترع (حكمٌ يقيس وجودَ `page.tsx` لكلّ وجهةٍ **من الطرفين**، وما يُترك من `/treasury`
  — الصفحاتُ المصرفيةُ الأربع — مُعلنٌ ومثبَّتٌ بقائمة). والنقاطُ المعلَنة في الكتالوج
  أُصلحت إلى المسارات الحقيقية (`@Controller()` فارغةٌ ⇒ `/vouchers` لا `/treasury/vouchers`؛
  وأمّا `bank-feeds` فهي تحت `/treasury`)، وصلاحيةُ الوحدة صارت
  ‏`anyPermissions: ['treasury.view','organization.cashlocation.view']` (فالرمزُ القديم كان
  يحجب الشاشةَ عمّن يقرأ ولا يُنشئ). والشارةُ في «نظرة اليوم» تُحسب من
  ‏`readyModules(visibleModules(...))` ⇒ **١١ من ١١** للمالك (وللمندوب أقلّ: دورُه يحمل ٠ من
  أذونات الخزينة والمحاسبة — قِيس في القاعدة). **وبقي: الشاشتان لم تُريا بالعين ولا قِيستا
  على خادمٍ قائم ببياناتٍ حقيقية ⇒ بندُ ب١٩.**
- **ب١٩ (جديدٌ بعد ٢٠ — عينُ المالك)**: ‏`/treasury` و`/accounting` مُترجَمتان ومبنيّتان
  (‏١١ مسارًا في `next build`، وساكنان) ومختبرتان منطقًا (‏٢٤ حكمًا: ١٥ + ٩) لكنّ **مظهرَهما
  لم يُرَ في متصفّح** ولم تُقَس استجابتُهما لخادمٍ قائم (‏`GET /vouchers` و`/cash-locations`
  و`/auth/handoff` بمنشأةٍ حقيقية). فالخطوةُ المطلوبة: تشغيلُ `apps/api` و`apps/bakery`
  والدخولُ بحساب المالك على `http://localhost:3005/treasury` ثمّ `/accounting` والنقرُ على
  وجهةٍ واحدة للتأكد أنّ التسليمَ يصل (ويحتاج `NEXT_PUBLIC_STAFF_URL` و`apps/staff`
  قائمةً على ٣٠٠١). **وفي ٢١ صارت البياناتُ الحقيقية جاهزةً في منشأة `wahda`** (يومُ خطٍّ كامل بـ`pnpm demo:line`: صندوقٌ بـ٤٦٠٫٠٠٠٠ **مُطابَق**، وبنكٌ **بلا مطابقة**، وسندُ خطٍّ مُرحَّل `RV-000001` بـ٤٦٠٫٠٠، وإيراد ١١٥٠، وعهدة ١٠٠ كجم، وإقفالٌ `settled` بلا عجز) — فالشاشاتُ تُرى مملوءةً لا فارغة، والدخولُ `owner@wahda.test`/`rep@wahda.test` بكلمتَي سرّ `.env`. **وقِيس حيًّا في ٢٠ح ما يُقاس بلا عين**: الصفحاتُ ٢٠٠، وأذوناتُ المالك
  تُظهر الوحدتين (١١ من ١١)، ومواضعُ النقد وأرصدتُها تصل، والسنداتُ ٠ صفوف (فالبذرةُ لا
  تُنشئ سندات)، و`POST /auth/handoff` ⇒ ٢٠١ ثمّ `redeem` على أصل staff ⇒ **٢٠٠ بجلسةٍ
  كاملة** ثمّ **٤٠١** على الاستبدال الثاني، وثلاثُ وجهاتٍ في اللوحة ٢٠٠. **فالباقِي هو
  المظهرُ وحده** (تباعدٌ، ألوانٌ، التفافُ الجدول على عرضٍ ضيّق، ووضعُ الليل) — ولا يُدّعى
  قبل أن يُرى. وفي بيئة النفق لا بدّ أن يكون `NEXT_PUBLIC_STAFF_URL` **مضيفَ staff العامّ**
  (‏`https://3001-<sandbox>.e2b.app`) لا `http://localhost:3001`، وإلا فتح متصفّحُ الزائر
  عنوانَ جهازه هو (والقيمةُ عُدِّلت في `.env` المحلّيّ وحده — وهو في `.gitignore` — ونسخةُ
  الأصل في `/tmp/env.backup`). وبندُ ب١٥ (عينُ المالك على staff ومنصّة الإدارة بعد
  ‏`@source`) ما زال قائمًا ويُضمّ إلى هذه الجولة.
- **ب٢٠ — أُقفل في ٢١ بقرار المالك**: الخزينةُ في المخابز **قراءةٌ + تسليمٌ** إلى لوحة staff،
  ولا مسارَ كتابةٍ فيها (وحكمٌ في `treasury-screen.spec.ts` يمنع إضافةَ `apiPost('/vouchers'…)`
  و`/post` و`/void` و`/cash-transfers`). وإن أُريد غدًا «توريدُ نقدية الخطّ» كعملٍ فطريقُه
  ‏`POST /cash-transfers` بين موضعَي نقد (صندوقُ السيارة ← الخزينة) باعتمادٍ من أمين الخزينة
  (‏`send`/`receive`) — **لا سندٌ ثانٍ** على النقد نفسه (فسندُ القبض يكتبه ويُرَحِّله
  ‏`collectCustomerDebt` أصلًا).
- **ب٢٢ — أُقفل في ٢٣ بقرار المالك** (مجموعةٌ جديدة وإعادةُ ربط الأصناف، **بلا تصحيحٍ
  لتاريخٍ مُصدَر**): ‏`pnpm demo:fix-vat --tenant <code>` (وقياسٌ افتراضيًّا، و`--apply`
  للتنفيذ) يقرأ النسبةَ التي يقولها الاسم ويقارنها بالرقم، فإن كانت المجموعةُ غير مقفولة
  صُحّحت بـ`PATCH` (طريق أ)، وإن ردّ الخادمُ ‏٤٠٩ `TAX_GROUP_RATE_LOCKED` أُنشئت مجموعةٌ
  بالنسبة الصحيحة على **حساب الضريبة نفسه** وسُمّيت القديمة «… — مجموعة تاريخية بنسبةٍ
  خاطئة (٠٫١٥٪) لا تُستعمل بعد الآن» وأُعيد ربطُ **الأصناف** بها — و**لا فاتورةً مُصدَرة
  تُمسّ** (فكلٌّ خزنت نسبتَها، وإعادةُ كتابتها تزويرٌ في مستندٍ ضريبيّ). وقِيس على منشأةِ
  اختبارٍ (`vattest`) أُعيدت فيها الحالةُ التاريخية حرفًا: فاتورةٌ **بإجمالي ٦٠٠٫٩٠ منها
  ضريبة ٠٫٩٠**، ثمّ التنفيذُ ⇒ مجموعةٌ ١٥٫٠٠٠٠ + صنفان رُبطا + **الإيرادُ ما زال ١٠٠١٫٥٠**
  وسندُ القبض ٤٠٠٫٦٠ (فالتاريخُ لم يتغيّر) + تشغيلٌ ثانٍ «الخطة: لا شيء». ومنشأتا العرض
  ‏`demo` و`wahda` نسبتُهما ١٥٫٠٠٠٠ من البذرة المُصلَحة فلا تحتاجان الأداة.
- **ب٢٢ (سجّلُه الأصليّ — أُقفل أعلاه)**: بذرةُ العرض
  كانت تكتب مجموعةَ «ضريبة القيمة المضافة 15%» بـ`rate:'0.1500'` والمحرّك يحسب `rate/100`
  ⇒ **٠٫١٥٪** (قِيس: فاتورةُ ٦٠٠٫٠٠ بضريبة ٠٫٩٠). أُصلحت البذرةُ (`15.0000`) وثبّتتها
  ثلاثةُ أحكام (والتخريبُ ⇒ `expected 0.15 to be 15`)، وصُحّحت `bakeryco` و`bakery` عبر
  ‏`PATCH …/tax-groups/:id` (٢٠٠)، وبُذرت `wahda` بعد البناء ⇒ ١٥٫٠٠٠٠ من البذرة نفسها
  وفاتورتُها ٦٩٠٫٠٠ منها ضريبة ٩٠٫٠٠. **وبقيت `demo` مقفولة**: ‏`PATCH` ⇒ ٤٠٩
  ‏`TAX_GROUP_RATE_LOCKED` لأنّ فاتورتَي القياس أشارتا إليها (‏`catalog.service.ts:879-905`)
  ⇒ والقرارُ للمالك: (أ) مجموعةٌ جديدة بـ١٥٪ وإعادةُ ربط الأصناف بها + تسميةُ القديمة بما
  لا يكذب («٠٫١٥٪ — تاريخية»)، أو (ب) اعتبارُ `demo` ساحةَ تطويرٍ داخلية والعرضُ من `wahda`.
  **ولا يُعدَّل تاريخُ فاتورةٍ مُصدَرة** في الخيارين.
- **ب٢٣ — أُقفل في ٢١ (عيبٌ ماليٌّ كان سيصل إلى العملاء)**: إرجاعُ متبقّي السيارة إلى
  المستودع الرئيسيّ (`remainingAction:'return_to_main'`) كان يُعيد **الكميةَ بلا قيمة**: الرجلُ
  الخارجة `outAtAvg` والداخلةُ `inWithCost` **بلا `unitCost`** والمحرّك يُقيّمها بـ`?? '0'`
  (‏`inventory.service.ts:293-296`). وقِيس طرفاه: على منشأةٍ حيّة ١٠٠ كجم بتكلفة ٢٫٨٠٠٠ ⇒
  قيمةُ الخبز ٨٤٠ لـ٤٠٠ كجم بمتوسط **٢٫١٠٠٠** بدل ١١٢٠ بمتوسط ٢٫٨٠٠٠ (‏**٢٨٠ ريالًا ضاعت**
  ولا قيدَ في الأستاذ للعودة)، وعلى مثبّتة التسوية ٦ كجم × ٤٫٠٠ ⇒ **٢٤ ريالًا** (‏`expected
  80 to be close to 104`). والأثرُ المستمرّ: متوسطُ تكلفةٍ منخفضٌ ⇒ **كلفةُ مبيعاتٍ أقلّ من
  الحقيقة ⇒ ربحٌ أكبر من الواقع**. فأُصلح بقراءة `unit_cost` الحركةِ الخارجة من
  ‏`inventory_transactions` وتمريره للداخلة في المعاملة نفسها، وأُضيفت ثلاثةُ تأكيداتٍ على
  القيمة في الحكم القائم (‏`van-sales-stock-settlement.spec.ts:584+`، وكان يقيس الكميةَ وحدها
  ومع ذلك فمساعدُ `balanceValue` موجودٌ في الملفّ وتعليقُه «a quantity can come back while
  its value does not») ⇒ **١٤/١٤**، والتخريبُ يعيد السقوطَ حرفًا، والاستعادةُ بالبصمة
  ‏`603f00d02a00db3aeb104729045f6f19`. **وبقي أثرُ البيانات**: منشأةُ `bakeryco` تحمل
  متوسطًا مُخفَّضًا (٢٫١٠٠٠) و٢٨٠ ريالًا ناقصة، وإعادةُ التقييم تحتاج قرارًا محاسبيًّا
  (بأيّ تاريخ وبأيّ قيد) فلا تُنفَّذ تلقائيًّا — وتُترك دليلًا مقاسًا.
- **ب٢٤ — نُفِّذ جزئيًّا في ٢٢ (وبقي ما لا يُنفَّذ بلا عنقودٍ ولا مزوّد)**: النسخُ
  الاحتياطيّ والفحصُ الدوريّ صارا في المستودع: ‏`scripts/db-backup.mjs` (وضعان) و
  ‏**`pnpm db:drill` اختبارُ استعادةٍ كامل قِيس أخضر** (٢٨٩ جداول/٣٠٦٥ صفوفًا، والعدُّ
  مطابقٌ في كلّ جدول، وعيّنةُ محتوى تُظهر نسبَ الضريبة لكلّ منشأة وأعمدةَ `bytea`)، و
  ‏`deploy/k8s/backup.yaml` (نسخٌ يوميّ ٠٢:١٥ UTC بـ`pg_dump -Fc` **وتحقّقٍ مُنفَّذ** بـ
  ‏`pg_restore --list` واحتفاظٍ بـ١٤، واستعادةٌ **`suspend: true`** ترفض اسمًا فارغًا)، و
  ‏`deploy/k8s/monitoring.yaml` (فحصٌ كلّ ٥ دقائق على `/health/ready` و`/health/live` بقياس
  ‏`%{http_code}` وفشلٍ ظاهر، ونبضةُ «رجلٍ ميت» عبر `HEALTHCHECKS_URL` **اختياريّة**)، و
  ‏`overlays/monitoring/` بقواعد Prometheus و`Probe` (طبقةٌ لأنّها CRD). وستّةُ أحكامٍ
  بنيوية في `deployment-surface.spec.ts`. **وبقي مفتوحًا**: (١) لم يُطبَّق شيءٌ على عنقود
  (ب٢٥)؛ (٢) لم يُجرَّب وصولُ تنبيهٍ إلى إنسان (لا مزوّد ضُبط)؛ (٣) ~~PVC وحدها ليست نسخة~~ —
  **نُفِّذ في ٢٣ بقرار المالك (‏S3‑متوافق)**: حاويةُ `upload` بجانب حاوية النسخ في المهمّة
  نفسها، تنتظر علامةَ `/backups/.ready` (تُكتب **بعد** تحقّق الأرشيف) ثمّ `mc cp` فـ`mc stat`
  (تحقّقٌ على الطرف الآخر) فـ`mc rm --older-than ${KEEP_DAYS}d` (احتفاظٌ هناك أيضًا)،
  والسرُّ `erp-backup-s3` منفصلٌ ومفاتيحُه `optional: true`، وبلا `S3_BUCKET` **تفشل
  المهمّةُ صراحةً** (`REQUIRE_OFFCLUSTER=1`) لأنّ نسخةً داخل العنقود وحده يجب أن تُرى فشلًا
  لا نجاحًا صامتًا. **وبقي**: لم يُجرَّب على مزوّدٍ حقيقيّ (لا مفاتيح)، ووسمُ `minio/mc`
  غير مُتحقَّقٍ من وجوده (لا وصولَ إلى سجلّ الصور)، **ولا تشفيرَ للأرشيف** ولا إدارةَ
  مفاتيح؛
  (٤) لا مقاييسَ تطبيقية (لا `/metrics` في الـAPI — قِيس: لا `prom-client`) فالتنبيهاتُ من
  مقاييس Kubernetes وحدها.
- **ب٢٦ (جديدٌ بعد ٢٢ — بوابةٌ ناقصة)**: مجلّدُ `scripts/` في الجذر **خارج أيّ lint**:
  ‏`pnpm -r run lint` يشغّل lint كلّ حزمة على مجلداتها ولا حزمةَ تملك `scripts/` ⇒ قِيس
  ‏**٦٨ خطأً قائمًا** (`pnpm exec eslint scripts` على `next-run.mjs` و
  `rotate-data-encryption-key.mjs` و`seed-demo-data.mjs` وغيرها: ‏`import/order` ومتغيّراتٌ
  ميتة). و`scripts/db-backup.mjs` لُفظ وحده صراحةً (٠ خطأ) — وإدخالُ المجلّد في البوابة
  يحتاج تنظيفَ الـ٦٨ في ملفاتٍ ليست من هذه الشريحة، فيُترك بندًا لا تُفتح الآن.
- **ب٢٤ (كان: لا نسخَ ولا مراقبة — نُفِّذ جزئيًّا أعلاه)**: **لا نسخَ احتياطيًّا ولا مراقبة** في
  ‏`deploy/` ولا `infrastructure/` (قِيس: ‏`grep -rliE "backup|pg_dump|prometheus|
  alertmanager|grafana"` ⇒ **لا شيء**)، وقاعدةُ البيانات Statefulset بـPVC واحدة ⇒ فقدُها
  فقدُ بيانات العملاء. والموجودُ قابلٌ للبناء عليه: ‏`/health/live` و`/health/ready`
  (‏٢٠٠ مقاس)، وسجلاتٌ JSON فيها `traceId`، وتحديدُ معدل (`x-ratelimit-limit: 10` على
  ‏`/auth/login` و٦٠٠ على سواه)، وترويساتُ أمانٍ كاملة (‏CSP/HSTS/nosniff/referrer-policy/
  ‏SAMEORIGIN)، و`authorization: [redacted]` في السجلّ.
- **ب٢٥ (جديدٌ بعد ٢١ — تحقّقُ النشر مؤجَّلٌ لأدواتٍ غير متوفّرة)**: مرافقُ نشر المخابز
  **موجودةٌ وكاملة** (‏`deploy/k8s/web.yaml:177-217` بـDeployment+Service و`runAsNonRoot`
  وreadiness/liveness وrequests/limits، و`ingress.yaml:39-42` بمضيف `bakery.erp.example`
  وشهادة TLS، و`kustomization.yaml:55-56` بصورة `ghcr.io/albaraaq/cloud-saas-erp-bakery`
  و`replicas`، و`docker-compose.yml:225-235`، و`Dockerfile.web --build-arg APP=bakery`) —
  لكنّ **التحقّق ساكنٌ** لأنّ `docker`/`kubectl`/`kustomize` غير متوفّرة في بيئة العمل
  (قِيس بـ`which`). فالمطلوبُ على آلةٍ فيها Docker: بناءُ الصورة، ‏`compose up`، ‏
  `kustomize build | kubectl apply --dry-run=server`، والتحققُ من `/api/health/live` عبر
  Ingress.
- **ب٢٠ (كان قرارًا للمالك — أُقفل أعلاه)**: شاشةُ الخزينة **بلا مسارِ كتابة على
  قصد** (وحكمٌ في المثبّتة يمنع إضافةَ `apiPost('/vouchers'…)` و`/post` و`/void`
  و`/cash-transfers`). فإن أراد المالكُ «توريدَ نقدية الخطّ إلى الخزينة» **كعمل** فطريقُه
  ‏`POST /cash-transfers` (تحويلٌ بين موضعَي نقد: صندوقُ السيارة ← الخزينة) لا سندٌ ثانٍ،
  وهو يحتاج قرارًا في مَن يعتمد التحويلَ ومتى يُعدّ النقدُ «واصلًا» (وقبل القرار يبقى
  التسليمُ إلى staff كافيًا وصادقًا). ولم يُعرض كذلك: إغلاقاتُ اليومية (`/shift-closes/
  day-closes`) وتغذيةُ البنوك (`bank-*`) — فالأولى سطحُ صندوق الكاشير لا صندوقَ السيارة،
  والثانية مسارُ عملٍ مصرفيّ، ووجهتاهما معلَّنتان في `/accounting` وفي قائمة «لا تُعرض».
- **ب٢١ (جديدٌ بعد ٢٠ — بندُ أ٤ لم يُلمس)**: الشريحةُ جعلت هويةَ المنشأة من البيئة في
  **البذرة**، وأمّا أيُّ حقولٍ تقرأها `einvoicing` فعلًا عند إصدار مستند ZATCA (وهل تقرأ
  ‏`company_profiles` أم إعدادًا آخر) فبندُ أ٤ القائم — ولم يُقَس في هذه الشريحة.
- **ب١٦ (جديدٌ بعد ١٨ — ضجيجٌ في العدّ الكامل، مقاسٌ لا مُخمَّن)**: ‏`vitest run` الكاملة
  في `apps/api` تُبلغ **`Errors 2`** مع نجاح كلّ الأحكام (‏٢١٣/١٧٧٦): ‏`FATAL 57P01`
  (‏admin_shutdown) على عميلٍ في مجمّع `erp_test_journal_reversal_15591_20`
  (‏`_ending: true, _ended: false, _connected: true, _poolUseCount: 273`)، وتنسبه vitest إلى
  `test/journal-reversal-consistency.spec.ts` **وهو ليس منه**. والقياسان اللذان يحسمان
  الطريق: (١) الملفُّ **وحده** نظيف — ‏`Test Files 1 passed · Tests 5 passed` وبلا سطر
  `Errors` ⇒ فالتسابقُ من التزامن (‏٢١٣ ملفًّا وعمّالٌ يسقطون قواعدَهم معًا) لا من
  هذا الملف؛ (٢) `close()` في `apps/api/test/test-app.ts` يعمل `await app.close()` ثمّ
  `server.dropDatabase(…)`، وإضافةُ `await handle.close()` بينهما **ترمي** ‏`Error: Called
  end on pool more than once` (‏`packages/database/src/client.ts:42`) ⇒ فـ`app.close()` يُنهي
  المجمّعَ فعلًا، والعيبُ أنّ الإسقاطَ يسبق انتهاءَ العميل الأخير. فالإصلاحُ ليس إنهاءً
  ثانيًا (جُرِّب ورُفض ورُدّ الملفّ إلى أصله بـ`git checkout`) بل انتظارُ الانتهاء أو
  امتصاصُ خطأ العميل أثناء الـteardown — ويُترك لشريحةٍ تمسّ `apps/api` فتُعيد العدَّ
  الكامل، لأنّ إعادةَ ٦٠٣ ثانية لأجل ضجيجٍ لا يُسقط حكمًا ليست أولويةَ هذه الشريحة.
  **وقيس مرّتين أخريين في ٢٠**: ‏`Errors 1` على `erp_test_platform_billing_41816_3` ثمّ على
  `erp_test_iso_org_45944_122` ⇒ **القاعدةُ تختلف في كلّ تشغيل**، فليس تسريبَ مثبّتةٍ
  بعينها (وقِيس أنّ `isolation-organization.spec.ts` يُنهي عملاءه في `finally`، وأنّ
  ‏`journal-reversal-consistency.spec.ts` وحده نظيف) بل تسابقٌ بين إسقاطِ قاعدةٍ وانتهاءِ
  آخر عميلٍ في مجمّعها. والأحكامُ كلّها تنجح في التشغيلين (‏٢١٥/١٨٠٣، ٠ فشلت)، فالبندُ
  ضجيجٌ لا عيبٌ في السلوك — ويُصلَح بانتظار الانتهاء أو بامتصاص خطأ العميل أثناء
  الـteardown، لا بإنهاءٍ ثانٍ (جُرِّب ورُفض).
- **ب١٤ (جديدٌ بعد ١٨ — قرارٌ للمالك)**: ‏`apps/marketing` بلا `postcss.config.mjs`، فـ
  Tailwind لا يعمل هناك البتّةَ: صفحةُ `/design` (‏`DesignGalleryWithToasts` من `@erp/ui`)
  و`ThemeToggle` تُعرضان بلا تنسيق، و١٦ صنفًا في مصادره لا يُولَّد. والإصلاحُ سطرٌ واحد،
  لكنه يُحيي المرافقَ و`@theme` على موقعٍ عامٍّ لم يُرَ بالعين بعد التغيير ⇒ يُطلب قرارُ
  المالك (مع ملاحظة أنّ preflight مطبَّقٌ أصلًا وأنّ `:root` اليدويّ يأتي بعد `@theme` في
  الملفّ فيبقى هو الغالب). ولا تُضف `@source` هناك قبل إضافة الإعداد: فبلا إعدادٍ هي
  سطرٌ خاملٌ يوهم بالإصلاح.
- **ب١٥ (جديدٌ بعد ١٨ — عينُ المالك)**: إصلاحُ `@source` غيّر مظهرَ `apps/staff` و
  `apps/platform-admin` (خلفيةُ `Modal` المعتمة وضبابيتُها، حلقاتُ التركيز، ظلالُ
  البطاقات، ‏`Toast`) — وهو **إعادةُ التصميم إلى ما كُتب**، لا تصميمٌ جديد، لكنه لم يُرَ
  بالعين. والمطلوبُ نظرةٌ على `Modal` و`Toast` وحقلِ إدخالٍ بلوحة المفاتيح في التطبيقين.
- **ب١٣ (محدَّثٌ بعد ١٦ج — أُقفل جزءُه الأكبر)**: بقي مسارا كتابةٍ يُمرّران تاريخًا خامًّا إلى
  SQL — **مقروءٌ في المصدر لا مقاس**: ‏`content.service.ts:1272` (‏`${input.endsAt ?? null}::timestamptz`) و
  `platform-billing.service.ts:975,1475` (‏`input.receivedAt::timestamptz`، ‏`input.periodStart/
  periodEnd::date`). ومعهما مسحٌ أوسع: كلّ مقارنةِ عمودِ تاريخٍ بمعاملٍ من الطلب عبر drizzle
  (بلا `::date` صريح) — فـ`journalScope` وُجدت بالصدفة لأنّها كانت سببَ الـ٥٠٠ المقاس.
  وتسجيلُ رموز الخطأ في `@erp/contracts` (اتّسع بعشرة رموز منذ ١٥ج). وأُضيف بعد ١٦ج:
  ‏`/hrm/reports/salary?month=13-2026` ما زال يرجع ٢٠٠ (شهرٌ مستحيلٌ يُقبل؛ والمطلوب
  ‏`parseMonthParam` بصيغة `YYYY-MM`)، ومسحُ تواريخ **أجسام** POST (لا الاستعلامات فقط).
  بلا ضريبة بينما في البيع شاملةٌ لها.

---

## ٨. ما يجب أن يبقى في كلّ تسليم

1. **قيس قبل أن تكتب**: عيبٌ مقاسٌ بأرقامٍ من سجلّ اختبارٍ أو من `information_schema` يساوي
   عشرةَ أوصافٍ من القراءة. وقل «مقروءٌ في المصدر ولم يُقَس» حين يكون كذلك.
2. **أصلح الخادمَ أولًا**، ثمّ الشاشةَ التي ترث الرقمَ الصحيح.
3. **تنفيذٌ واحد**: كلّ رقمٍ أو جملةٍ تُحسب في مكانٍ واحد (‏`VAN_MONEY_SQL`،
   `resolveZatcaSellerInTx`، ‏`@erp/web-van/windows`) وتستعمله الأوجه — فهذا الصنفُ من
   العيوب وُلد من نسخٍ متباعدة.
4. **لا رقمَ يُخترع**: صفرٌ صادقٌ أو «لا أعرف» مع عدّادٍ معلن (`returnsWithoutCostCount`)،
   ولا اسمَ صنفٍ ولا تكلفةً ولا رقمَ ضريبةٍ من بديلٍ مكتوبٍ في الكود.
5. **أطرافُ المعادلة ظاهرة**: رقمٌ صافٍ بلا أطرافه يُقرأ كأنّ ما خُصم لم يحدث.
6. **قل ما لم تفعله**: لا متصفّحَ فُتح ⇒ لا ادّعاءَ بأنّ بطاقةً «تظهر»؛ ولا اختبارَ سلوكٍ
   لطبقةٍ مُثبتةٍ نصًّا ⇒ يقال إنّها نصّية.
