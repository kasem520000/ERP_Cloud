# وثيقةُ التسليم — تطبيقُ المخابز `apps/bakery` والمرحلةُ الرابعة

> **الغرضُ من هذا الملفّ**: أن يستأنف أيُّ جلسةٍ جديدة (أو أيُّ مطوّرٍ آخر) العملَ من حيث
> وقف، بلا ذاكرةٍ عن المحادثة السابقة. فهو يقول أين نحن، وما الذي تقرّر فلا يُسأل مرّةً
> أخرى، وما الذي تبقّى وبأيّ قياساتٍ معلومة، وما الفخاخُ التي كلّفت وقتًا.
>
> آخرُ تحديث: **2026-10-16** بعد الشريحة ١٤ج — **المرحلةُ الرابعة مكتملةٌ في الكود**: شاشةُ
`/rep` مبنيّةٌ وتعمل متصلّةً ومنقطعةً بطابور، و`manifest` وعاملُ خدمةٍ قابلان للتثبيت. وما
بقي من المرحلة ليس كودًا: **جهازٌ حقيقيّ** يثبّت التطبيقَ ويفتحه منقطعًا (فلم يُفتح
متصفّحٌ ولا هاتفٌ في هذه البيئة)، وقرارٌ للمالك في الإرسال التلقائيّ عند عودة الشبكة،
وأيقوناتٌ نقطية، وأتمتةُ اسم الكاش — وتفصيلُها في §١٤ج من التقرير وفي §٤ تحت. والتفاصيلُ الطويلة لكلّ شريحةٍ في
> `docs/BAKERY_APP_PHASE3_SLICE4_REPORT.md` (‏٢٦٩٦ سطرًا) والتصميمُ في
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

### إن استُعيدت لقطةُ البيئة (حدث ذلك مرّتين في هذه العمل)

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
corepack pnpm install --prefer-offline                 # ≈١٨ ثانية
corepack pnpm run env:setup                            # يُعيد توليد .env (لا يطلب إدخالًا)
```

ملاحظاتٌ مقاسة:

- الاختباراتُ في `apps/api` **تُقلع قاعدتَها المدمجة نفسها** (`createTestApp`) ⇒ لا حاجة إلى
  `db:local` لتشغيلها. وتُحتاج `corepack pnpm run db:local` **لبوابة الهجرة فقط**
  (‏`db:migrate` / `migrate:down` / `db:seed` على `DATABASE_URL` من `.env`).
- **لا `psql`** في حزمة `@embedded-postgres` (فيها `initdb`/`pg_ctl`/`postgres` فقط) ⇒ للقياس
  على قاعدةٍ حيّة استعمل سائق `pg` من node:
  `node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/index.js` مع `DATABASE_MIGRATOR_URL` من
  `.env` (نمطٌ جاهزٌ استُعمل في الشريحة ١٣ج).
- `packages/*/dist` تُمسح أيضًا ⇒ الترجمةُ تحتاج بناءَ الحزم: استعمل **`corepack pnpm run
  typecheck`** (الجذر: يبني الحزم ثمّ يترجم كلّ شيء) لا `pnpm -r run typecheck` وحده بعد
  استعادةٍ (وإلا ظهرت أخطاء `Cannot find module '@erp/config'`).

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
corepack pnpm run db:local                                         # (خلفية) لبوابة الهجرة فقط
corepack pnpm run db:migrate
corepack pnpm --dir packages/database run migrate:down 1
```

**آخرُ نتائجَ مقاسة** (‏2026-10-16):

| البوابة | النتيجة |
|---|---|
| ‏`apps/api` كاملة (‏٠٤:٢٦ UTC) | **٢١١ ملفًّا / ١٧٦٦ حكمًا، ٠ فشلت** (‏٥٤٩ ثانية) |
| مواصفاتُ التوزيع والانعكاس (١٤ ملفًّا) | **٨٩ حكمًا، ٠ فشلت** |
| بقيّةُ الحزم (بعد ١٤ج) | **١٣ حزمة / ٩٩ ملفًّا / ٩٢٥ حكمًا، ١ تخطّي، ٠ فشلت** |
| ‏`apps/bakery` | **١٤ ملفًّا / ١٩٣ حكمًا** |
| ‏`packages/web-core` | **٨ ملفات / ٥٢ حكمًا** |
| ‏`packages/web-van` | **٥ ملفات / ٩٥ حكمًا** |
| ‏`apps/staff` | **١٥ ملفًّا / ٩٤ حكمًا** |
| الترجمةُ والـlint | ‏٠ / ٠ (والـlint يُظهر تحذيرَ `[boundaries][warning]` القائم فقط) |
| بناءُ المخابز / بناءُ الطاقم | ‏٠ (**١٠ مساراتٍ ساكنة** و`/rep` ‏١٥.١ kB / ‏١٩٢ kB) / ‏٠ (‏١٩٩ مسارًا) |
| ‏`openapi:export` | ‏٠ **بلا فرق** في `packages/contracts/openapi.json` |
| بوابةُ الهجرة (١٣ج) | ‏`applied: 131, skipped: 0` ⇒ `migrate:down 1` ⇒ القيمُ المفبركة تعود والسجلُّ آخرُه `0130` ⇒ `applied: 1, skipped: 130` ⇒ القيمُ صادقة ⇒ `db:seed` خروجٌ ٠ |

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
  أخطاءَ TS ⇒ استعمل `grep -E "error TS"`؛ والشرحاتُ المائلة المعكوسة في أنماط grep تكسر
  ‏`bash -c`؛ و`grep -rn apps/bakery` يصيب `.next`.

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
| ‏`apps/bakery/lib/navigation.ts` | ‏`BakeryModule`؛ ‏ready: ‏`collection, custody, distribution, overview, production, reports, reps, sales`؛ ‏planned: ‏`treasury, accounting, rep-app` |
| ‏`apps/bakery/lib/{sales-screen,collection-screen,reports-screen,custody-screen,reps-screen,dashboard-windows,lookups}.ts` | منطقُ الشاشات النقيّ (والاستيراداتُ النسبيةُ بلا امتداد = هويةُ المخابز) |
| ‏`apps/staff/app/van-sales/rep/page.tsx` | شاشةُ المندوب القائمة في الطاقم (‏١٠٥٠+ سطرًا) — مرجعٌ للشكل والحقول، ومستهلكُ `/van-sales/me` |
| ‏`apps/api/test/van-sales-*.spec.ts` | ‏١٣ مثبّتةً للتوزيع (أسماءُها في §١ من التقرير لكلّ شريحة) |
| ‏`packages/database/migrations/0131_van_sales_honest_defaults.sql` (+‏`down/`) | آخرُ هجرة؛ والقادمةُ ٠١٣٢ |
| ‏`docs/BAKERY_APP_PHASE3_SLICE4_REPORT.md` | سجلُّ الشرائح + §«سجلُّ البنود المفتوحة والقرارات المطلوبة» (٦ قراراتٍ + ١٢ بندَ عمل) |

---

## ٧. البنودُ المفتوحة (مؤشّر)

القائمةُ الكاملةُ في آخر `docs/BAKERY_APP_PHASE3_SLICE4_REPORT.md` — قسمُ «سجلُّ البنود
المفتوحة والقرارات المطلوبة». واختصارُها:

- **قراراتٌ للمالك**: أ١ هامشُ البيع بلا تكلفةٍ معلومة؛ أ٢ كاتبُ
  `allowInternalDeliveryWithoutTax` (لا توصل إليه شاشةٌ وجملةُ رفض ZATCA تذكره مخرجًا)؛
  أ٣ صحّةُ صيغة الرقم الضريبي؛ أ٤ مصدرُ هويّة البائع في `einvoicing`؛ أ٥ تسجيلُ أجهزة
  المندوبين؛ أ٦ بنودٌ أقدم (تكلفةُ الفاقد، ضريبةُ البونص، ضريبةُ التسليم الداخلي، تأريخُ
  المستندات، طباعةُ فاتورةٍ لم تُصدر، إسنادُ الدفعات).
- **عملٌ أقوده**: ب١ تكلفةُ العجز في `submitClosing` لأمرٍ بلا صنف (بندُ قياس)؛ ب٢ مراجعةُ
  الفهارس للمجاميع الجديدة؛ ب٣ `customerPriceAuditReport` على `created_at` بـUTC؛ ب٤ تكرارُ
  `resolveBusinessTimeZoneInTx` في `payroll-compliance.service.ts:88`؛ ب٥ `employeeMovements`
  ‏`from`/`to` بلا تحقّق (‏٥٠٠ لا ٤٢٢)؛ ب٦ `getReports` تستدعي `dashboard()`؛ ب٧ `truncated`
  بلا ترقيم صفحات؛ ب٨ سبعُ مثبّتاتٍ بمساعد `today()` بـUTC؛ ب٩ سطحُ الخزينة لم يُقرأ؛
  ب١٠ دقّةُ معاينة الضريبة؛ ب١١ تنظيفُ الصفوف القديمة من ٣.٨٠؛ ب١٢ `total` في صفّ المرتجع
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
