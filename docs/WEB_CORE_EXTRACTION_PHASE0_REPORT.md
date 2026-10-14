# تقرير المرحلة 0: استخراج `@erp/web-core` — القشرة المشتركة لواجهات الويب

## المستودع · الواجهات المستأجرة · بلا تغيير سلوكي مقصود

المرحلة 0 من خطة تطبيق المخابز: قبل أن يولد `apps/bakery` كان لا بدّ أن توجد قشرةٌ مشتركة
يُولد عليها، وإلا صار التطبيق الرابع نسخةً رابعة من الصدفة. هذه المرحلة **نقلٌ لا اختراع**:
الكود نفسه بحرفه في موضعٍ جديد، والقياس على ما كان يعمل قبله.

---

## 1) الحكم النهائي

### ما صار جاهزاً (بأدلّة مُنفَّذة)

| # | المطلوب | الحالة | الدليل |
|---|---------|--------|--------|
| 1 | حزمة مشتركة تحمل قشرة الويب (الجلسة، العميل، اللغة، الاستعلام، العمل بلا اتصال، جسر الدخول) | ✅ | `packages/web-core` — 1270 سطراً في `src/`، تُشحن مصدراً كـ`@erp/ui` (ADR-030) |
| 2 | `apps/staff` يستهلكها **بلا تغيير سلوكي** | ✅ | `next build` exit=0، والخادم المُنشأ يخدم المسارات نفسها (§6) |
| 3 | لا موضع استيراد واحد انكسر | ✅ | 7 جسور إعادة تصدير تُبقي 451 موضع استيراد كما هي (§4)، و`-r run typecheck` exit=0 |
| 4 | الاختبارات لا تُخفَى ولا تضيق | ✅ | 13 حكماً في سبيك العمل بلا اتصال قُسّمت 9+4 بلا حذف، وحارس رموز الصلاحيات **اتسعت** تغطيته (§5.3) |
| 5 | عطلٌ حقيقي كشفه النقل وأُصلح | ✅ | إعادة التوجيه عند فشل جسر الدخول كانت ترمي إلى `/login` — **مسار غير موجود (404 مقيس)** (§5.1) |
| 6 | **0ب**: بوابة الجلسة وسياسة الأسطح مشتركتان، و`platform-admin` تستهلكهما | ✅ | `session-gate.tsx` (84) + `surface-policy.ts` (47)، وبوابتا التطبيقين صارتا ربطاً (§8) — و20/20 في web-core منها **8 اختبارات رسمٍ** لا قراءة نصّ |

### ما ليس جاهزاً

- **القشرة البصرية لم تنتقل**: `AppShell` (778) و`LoginScreen` (391) و`EmployeeShell` (86) ما زالت
  في `apps/staff`، لأنها تحمل هوية التطبيق وكتالوج شاشاته ومكوّناته الثلاثة (المساعد، الجرس،
  لافتة الدخول المؤقّت). والأسباب مقيسة في §8.5 — والحدود (manifest) تُصمَّم مقابل مستهلكٍ ثانٍ
  حقيقي (`apps/bakery`) لا مقابل تخمين. **أما `AuthGate` فقد نُقلت بوّابته** (§8).
- **`apps/platform-admin` هُجِر بوابةً لا جلسةً**: صار يستهلك `SessionGate` من الحزمة (§8)، وبقي
  عميل الجلسة/API الخاصّ به كما هو — فالهجرة الجزئية للجلسة **تُغيّر السلوك صامتةً** (§7.2).
  و`apps/customer-portal` لم يُمسّ إطلاقاً (ولا جسر الدخول الثالث فيه — §5.1).
- **مواضع الاستيراد لم تُنقل** (451 موضعاً ما زالت تستورد عبر جسور `apps/staff/lib/*`) — خطوة
  مستقلة قابلة للمراجعة (§4).
- **لا اختبار متصفح** (Playwright محجوب عن البيئة): ما ثبت هو البناء وخدمة الخادم ونصّ المصدر
  والأحكام النقية، لا رسم الشاشة في متصفح.

---

## 2) لماذا: التكرار مقيسٌ لا مظنون

قبل النقل كانت القشرة مكرّرة في ثلاث واجهات. هذا قياس `diff` فعلي (عدد أسطر الاختلاف):

| الملف | `apps/staff` | `apps/platform-admin` | `apps/customer-portal` |
|---|---|---|---|
| `lib/use-query.ts` | 44 | **44 — متطابق حرفاً (0 أسطر اختلاف)** | `use-async.ts` (آخر) |
| `lib/session.tsx` | 110 | 110 — **30 سطر اختلاف** | لا يوجد |
| `lib/api.ts` | 458 | 354 — **204 سطر اختلاف** | 573 سطر اختلاف عن نسخة staff |
| `components/token-bridge.tsx` | 63 | لا يوجد | **نسخة ثالثة** (63+) مع سبيك خاص بها |
| `components/login-screen.tsx` | 391 | 331 | لا يوجد |
| `components/auth-gate.tsx` | 44 | 33 | لا يوجد |

أي أن إصلاحاً واحداً في جلسة العميل كان يلزم كتابته ثلاث مرات، وقد كُتب فعلاً ثلاث مرات —
والنسخة الثالثة في `customer-portal` تحمل **العطل نفسه** الذي كشفه النقل في §5.1. وتطبيق رابع
(`apps/bakery`) كان سيجعلها أربعاً.

---

## 3) ما انتقل وما بقي

### انتقل إلى `packages/web-core/src/` (بلا تعديل في المنطق)

| الوحدة | الأسطر | لماذا هي مشتركة |
|---|---|---|
| `api.ts` | 458 | تخزين الجلسة ورموزها وتجديدها بلا تكرار، و`apiData/apiList/apiPost/apiPatch/apiPut/apiDelete`، وقراءة `application/problem+json` إلى `ApiError`، و`apiErrorText`، و`login/logout/fetchMe`، واعتماد رمز الدعم (P-C8). **صفر مرجعية لصناعة أو شاشة** (قُيس: لا ذكر لـ`staff` ولا لمسار شاشة فيها) |
| `session.tsx` | 110 | `SessionProvider`/`useSession` وتوحيد رموز الصلاحيات بـ`canonicalizePermissionCode` |
| `i18n.tsx` | 128 | `LanguageProvider`/`useLang`/`translate`/`dirFor` وقاموس `STRINGS` |
| `use-query.ts` | 44 | خطّاف استعلام بلا اعتماد خارجي (حالة/خطأ/`forbidden`/إعادة تحميل) |
| `offline-db.ts` | 275 | محوّل IndexedDB: الكتالوج، طابور الفواتير، معرّف الجهاز، التسلسل |
| `sync-engine.ts` | 105 | تحديث الكتالوج، مزامنة الطابور، إعادة محاولة التعارض، حلقة عشر ثوانٍ |
| `sync.ts` | 59 | مساعدات `/compat/sync/*` |
| `token-bridge.tsx` | 69 | جسر الدخول AUD-08 (+6 أسطر: الخاصية الاختيارية والتوثيق — §5.1) |
| `index.ts` | 22 | واجهة الحزمة |

### بقي في `apps/staff` عن قصد

| الملف | الأسطر | السبب |
|---|---|---|
| `lib/navigation.ts` | 2325 | **كتالوج شاشات staff** (71 شاشة) وبياناتها — هوية التطبيق لا آلية مشتركة. ويقرأه `apps/api/src/modules/ai/*` و`apps/marketing/lib/*` و`scripts/*.mjs` بمساره هذا، فنقله كان يكسر خمسة مستهلكين خارج التطبيق |
| `lib/surface-routing.ts` | 26 | سياسة أسطح staff (`/supplier-portal`, `/esign`, `/m`) — المشتركة هي `matchesPrefix` وحدها، ونقل 26 سطراً بلا مستهلك ثانٍ تغييرٌ بلا مقابل |
| `components/app-shell.tsx` | 778 | يرسم كتالوج staff وهويته ومساعدَه — يحتاج manifest (§8) |
| `components/auth-gate.tsx` | 44 | يربط القشرتين وسياسة الأسطح — **نُقلت بوّابته في §8** فصار ربطاً (46) |
| `components/login-screen.tsx` | 391 | شاشة دخول staff (MFA، إعادة تعيين، «انضممت للتو») |
| `components/employee-shell.tsx` | 86 | قشرة موظف staff (`/m`) |

---

## 4) الجسور الانتقالية — وقولٌ صريح في أنها مساران مؤقتاً

`apps/staff/lib/{api,session,i18n,use-query,offline-db,sync-engine,sync}.ts(x)` صارت ستة أسطر:

```ts
export * from '@erp/web-core/api';
```

**لماذا:** في التطبيق **451 موضع استيراد** لهذه الوحدات (179 لـ`api`، 147 لـ`use-query`،
112 لـ`session`، 6 لـ`i18n`، و2+2+3 للبواقي). إعادة كتابتها كلها في الخطوة نفسها كانت تجعل
مراجعة النقل مستحيلة (250 ملفاً بين «انتقل» و«أُعيدت صياغة استيراده»)، والجسر يفصل الأمرين:
**هذه المرحلة نقلت التنفيذ، والمرحلة التالية تنقل مواضع الاستيراد وتحذف الجسور.**

وليس هذا نظامين موازيين: التنفيذ واحد في `packages/web-core`، والجسر لا يحمل منطقاً (ومكتوبٌ
فيه «لا تُضف منطقاً هنا»). لكنه **مساران لاستيراد الشيء نفسه مؤقتاً**، ويقال ذلك كما هو.

الاستثناء: `TokenBridge` لم يُترك له جسر — موضعه الوحيد (`apps/staff/app/layout.tsx`) استورد
من `@erp/web-core/token-bridge` مباشرة.

---

## 5) ما كشفه النقل وأُصلح معه

### 5.1 جسر الدخول كان يرمي الفشل إلى مسارٍ غير موجود (404 مقيس)

`TokenBridge` يعيد التوجيه عند فشل الاستبدال إلى `/login?handoff=failed` — و**لا مسار `/login`
في `apps/staff`**:

```
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/login
404
```

فشاشة الدخول ترسمها `AuthGate` على أي مسارٍ محميّ حين تكون الجلسة مجهولة. أي أن المستخدم الذي
انتهى رابط دخوله كان يقف أمام صفحة 404 بلا سبب — في مسارٍ (AUD-08) صُمّم أصلاً ليقول شيئاً.

**الإصلاح:** الخاصية `failedRedirect` وافتراضها `/?handoff=failed` (المسار الجذري حيث تُرسم شاشة
الدخول)، و`LoginScreen` في staff تقرأ الوسم وتقول «رابط الدخول المسلَّم منتهٍ أو مُستعمل سابقاً —
سجّل الدخول مباشرةً». وحُكمان جديدان في `packages/web-core/tests/session-handoff.spec.ts`
يثبّتان أن الجسر لا يستهدف `/login` وأن الافتراض هو الوسم المقروء.

**وأُصلحت النسخة الثالثة بعدها (2026-10-14):** `apps/customer-portal/components/token-bridge.tsx`
صار يحوّل إلى `/auth/login?handoff=failed` عبر ثابتٍ مُصدَّر (`FAILED_LOGIN`) بدل المسار الميّت،
وصفحة الدخول (`app/auth/login/page.tsx`) صارت تقول صراحةً «رابط الدخول المسلَّم منتهٍ أو مُستعمل
سابقاً — سجّل الدخول مباشرةً» بدل شاشة دخولٍ صامتة. والقياس على خادمٍ مبنيّ فعلًا
(`next build` ثمّ `next start` على المنفذ 3004): `/login?handoff=failed` ⇒ **404** (الهدف القديم)،
و`/auth/login?handoff=failed` ⇒ **200** وفيه التنبيه، و`/auth/login` ⇒ **200** بلا تنبيه.
وسبيكان جديدان في `apps/customer-portal/tests/session-handoff.spec.ts` (المجموعة **10/10** بدل
8/8): هدف التحويل وراءه صفحةٌ حقيقية — ويُقرأ من الثابت وقت التشغيل لا من نصّ المصدر — والصفحة
**تُرسم** فعلًا بحالتَيها بـ `renderToStaticMarkup`، ولهذا صار `vitest.config.ts` للبوابة
`esbuild: { jsx: 'automatic' }` (صفحة البوابة لا تستورد `React`، و`tsconfig` التطبيق على
`preserve` لـ Next).

### 5.2 حارسٌ كان سينجح وهو لا يفحص شيئاً

`apps/staff/tests/permission-codes.spec.ts` (AUD-12) يقرأ `lib/session.tsx` نصّاً ويثبت أنها تمرّ
بـ`canonicalizePermissionCode` ولا جدول aliases محلياً فيها. بعد النقل صار ذلك الملف **جسراً**،
فكان الاختبار سيفشل (كما فشل فعلاً في أول تشغيل: 90/91) — ولو كان الجسر يُصدّر الاسم لنجح
الاختبار وهو يقرأ ستة أسطر لا تفعل شيئاً.

**الإصلاح:** يقرأ `packages/web-core/src/session.tsx` حيث الكود، **ومسح الرموز اتسع** ليشمل
`packages/web-core/src/` كلها (كان محصوراً في `app/` و`lib/` و`components/` في staff) حتى لا تضيق
التغطية صامتةً. قُيس: لا رمز صلاحية حرفياً في وحدات web-core اليوم، فالمسح لا يضيف مخالفين —
ويبقى حارساً لمن يُضاف.

### 5.3 سبيك العمل بلا اتصال: قسمةٌ على موضع الكود، لا على قوة الحكم

`apps/staff/tests/offline-pos.spec.ts` كان يفحص أربعة أشياء معاً: manifest وservice worker
(ملفات staff العامة)، وشاشتَي POS (صفحات staff)، و`lib/offline-db.ts` و`lib/sync-engine.ts`
(انتقلا). قُسّم على موضع الكود:

- `apps/staff/tests/offline-pos.spec.ts` — manifest، sw.js، شاشتا POS (**9 أحكام**)
- `packages/web-core/tests/offline-store.spec.ts` — طابور IndexedDB، بادئة `OFFLINE-`، حلقة
  `10_000`، مسار `/pos/offline-sync` (**4 أحكام**)

9 + 4 = 13 = العدد قبل القسمة. **لم يُحذف حكم.**

### 5.4 أدوات ومستودعات أُخرى لزم تحديث مسارها

- `scripts/verify-offline-pos.mjs:131` كان يقرأ `apps/staff/lib/offline-db.ts` → صار
  `packages/web-core/src/offline-db.ts` (أداة تحقق يدوية، لا يشغّلها CI، لكن تركها تشير إلى جسر
  يعني تحقّقاً يفشل بصمت).
- `eslint.config.mjs`: نمط `lib` في `boundaries/elements` كان يحصر `.tsx` في
  `packages/ui/**/*.tsx` وحدها → صار `packages/**/*.tsx` (فقُدّت الاستثناءات المكتوبة باليد
  بدل أن تُضاف واحدة لكل حزمة جديدة)، وأُضيفت `packages/web-core` إلى تجاوز DOM globals.
- `apps/staff/next.config.mjs`: `transpilePackages: ['@erp/ui', '@erp/web-core']` — فالحزمة
  تُشحن مصدراً وتُصرَّف بأداة التطبيق (ADR-030).
- `apps/staff/package.json` و`pnpm-lock.yaml`: اعتماد `workspace:*` (الفرق في القفل إضافة صرفة).

---

## 6) الأدلة: الأوامر والأرقام الفعلية

```
$ corepack pnpm --filter @erp/web-core run test
  Test Files  3 passed (3) · Tests  7 passed (7)
  api-error-text (4) · session-handoff (2) · offline-store (1)

$ corepack pnpm --filter @erp/web-core run typecheck   → exit=0
$ corepack pnpm --filter @erp/web-core run lint        → exit=0

$ corepack pnpm --filter @erp/staff exec vitest run
  Test Files  14 passed (14) · Tests  91 passed (91)
  (كانت 97: انتقل 4 + 2 حكماً مع كودهما إلى web-core، وانقسم سبيكٌ واحد إلى اثنين — §5.3)

$ corepack pnpm -r run typecheck   → exit=0، صفر «error TS»
$ corepack pnpm -r run lint        → exit=0
$ corepack pnpm --filter @erp/staff run build   → exit=0 (كل المسارات بُنيت)

# وهذه المرحلة لم تلمس `apps/api` ولا `packages/database` ولا `packages/contracts`،
# ومع ذلك شُغِّلت مجموعاتها للتأكيد لا للتوقّع:
$ corepack pnpm --filter @erp/api exec vitest run
  Test Files  1 failed | 197 passed (198) · Tests  1 failed | 1668 passed (1669) · 533.43s
  الفشل الوحيد printing-and-cards.spec.ts — سابقٌ لهذه المرحلة (ملفّاه غير معدَّلَين)
$ corepack pnpm --filter @erp/contracts exec vitest run   → 239/239 ✅
$ corepack pnpm --filter @erp/database exec vitest run    → 53/53 ✅
```

### 6.1 الخادم المُنشأ يخدم القشرة فعلاً (لا بناءٌ ناجح فحسب)

`next start` على المنفذ 3001 بعد البناء، والقياس بـ`curl` (لا متصفح في البيئة):

| المسار | الرمز | ما في HTML |
|---|---|---|
| `/` | 200 | `boot-card` — أي أن `AuthGate` ← `useSession` (web-core عبر الجسر) ← `SessionProvider` (web-core) تعمل عبر حدّ الحزمة |
| `/?handoff=failed` | 200 | `boot-card` (الوسم تقرأه الشاشة في العميل) |
| `/van-sales` | 200 | `boot-card` |
| `/m` | 200 | `boot-card` — قشرة الموظف |
| `/pos/offline` | 200 | `boot-card` |
| `/supplier-portal` | 200 | **بلا `boot-card`** — أي أن `isPublicSurface` ما زالت تتجاوز البوابة كما كانت |
| `/login` | 404 | — (المسار غير الموجود الذي كان الجسر يرمي إليه — §5.1) |

ولا «Application error» في أيٍّ منها. **وما لم يُقَس:** ما يحدث بعد فحص الجلسة في المتصفح
(شاشة الدخول نفسها، ورسالة `handoff=failed` فيها) — فلا متصفح هنا، والحكم عليها من نصّ المصدر
والاختبارات النقية وحدها.

---

## 7) ما لم يُعمل، ولماذا

### 7.1 `AppShell`/`AuthGate`/`LoginScreen` (المرحلة 0ب)

نقلها كما هي يعني قشرةً واحدة بسلوكين: `AuthGate` يربط `AppShell` و`EmployeeShell` وسياسة أسطح
staff، و`AppShell` يرسم كتالوج `lib/navigation.ts` وهوية التطبيق ومساعدَه. المطلوب أولاً حدودٌ
معلنة (manifest للتطبيق: الاسم والشعار والمسار الجذري والأسطح العامة والقشرات والشاشات)، ثم
تُبنى القشرة عليه. **لم يُفعل في هذه المرحلة** لأن النقل بلا تلك الحدود كان سيُنتج إما نسخاً
باللصق داخل الحزمة (التكرار نفسه بشكلٍ آخر) أو قشرةً مشروطة بـ`if (app === 'staff')` (وهو أسوأ).

**تحديث بعد التنفيذ (§8):** نُقلت البوابة نفسها (`SessionGate`) وآلية الأسطح
(`matchesPrefix`/`createSurfacePolicy`) — فما كان مشتركاً فعلاً هو **ترتيب القرار** لا القشرة.
وبقي `AppShell`/`LoginScreen`/`EmployeeShell` في التطبيق للأسباب المقيسة في §8.5.

### 7.2 لماذا لا تُهاجَر `platform-admin` الآن — والفخّ المحدد

`lib/use-query.ts` في `platform-admin` **متطابق حرفاً** مع المنقول، فالتوفير ظاهر. لكن
`useQuery` يفحص `error instanceof ApiError` (من `./api`) ليفصل حالة `forbidden`، و`platform-admin`
لها **صنف `ApiError` خاص بها** في `lib/api.ts` (204 أسطر اختلاف عن نسخة staff). فلو استوردت
`useQuery` من web-core وبقي عميلها المحلي، لصار `instanceof` خاطئاً دائماً ول**اختفت حالة
`forbidden` من كل شاشاتها صامتةً** — تغيير سلوكي لا يظهر في اختبارٍ ولا في بناء.

لذلك القاعدة: **هجرة `platform-admin` تكون لكلّ graph الوحدة معاً** (العميل + الجلسة + الخطّاف)،
أو بتغيير تصميم web-core بحيث يقبل الخطّاف دالةَ نصّ خطأ/مُميّز خطأ بدل `instanceof`. كلاهما
قرارٌ يُعمل في خطوةٍ مفردة باختباراتها، لا على هامش نقلٍ «بلا تغيير سلوكي».

---

## 8) المرحلة 0ب — البوابة المشتركة وسياسة الأسطح

### 8.1 ما انتقل

| الوحدة | الأسطر | ماذا تحمل |
|---|---|---|
| `surface-policy.ts` | 47 | `matchesPrefix` (حدّ مقطع لا بادئة خام — AUD-13) + `createSurfacePolicy` + نوع `SurfacePolicy` |
| `session-gate.tsx` | 84 | `SessionGate` (ترتيب القرار) + `BootCard` (بطاقة الإقلاع) |
| `tests/surface-policy.spec.ts` | 59 | 5 اختبارات نقية |
| `tests/session-gate.spec.tsx` | 109 | **8 اختبارات رسمٍ** (`renderToStaticMarkup`) |

### 8.2 لماذا صار نقل البوابة ممكناً (وكان §7.1 يرفض نقل القشرة)

القياس قبل القرار: بوابة staff (44 سطراً) وبوابة `platform-admin` (33) تحملان **بطاقة إقلاع
متطابقة حرفاً** (`class="boot"` ← `boot-card` ← `<span class="logo">ERP</span>` ← «جارٍ التحقق من
الجلسة…») والترتيب نفسه (تحميل ← مجهول ← القشرة). وتختلفان في شيءٍ واحد: لـstaff سطحان عامّان
وقشرة موظف، وللبوابة لا هذا ولا ذاك (قشرتها `PlatformGuard`). أي أن **القرار مشترك والربط محلي** —
وهذا بالضبط ما يُنقل.

### 8.3 القرار التصميمي: بلا خطّاف وبلا مزوّد

`SessionGate` تأخذ `status` و`error` **خصائصٍ** ولا تنادي `useSession`. السبب هو الفخّ المقاس في
§7.2 نفسه: لـ`platform-admin` مزوّد جلسةٍ وعميل API خاصّان (30 و204 أسطر اختلاف عن نسخة staff)،
فلو نادت البوابة المشتركة `useSession` من الحزمة لطلبت مزوّداً غير موجود هناك — أي أن «توحيد
البوابة» كان سينقلب إلى «استبدال جلسة التطبيق» صامتةً. والمسار (`pathname`) خاصيةٌ كذلك، فلا
تستورد الحزمة `next/navigation` ولا تصير مكتبة Next.

وثمنٌ مستحق: بلا خطّاف ولا مزوّد صارت البوابة **دالةً نقية من خصائصها** ⇒ تُرسم في اختبار
بـ`renderToStaticMarkup` ويُقاس مخرجها (أي فرعٍ يُرسم، وبأي خصائص تُنادى شاشة الدخول) بدل
الاكتفاء بقراءة نصّ المصدر. وهو **أول اختبار رسمٍ في المستودع** (قُيس: لا `react-dom/server`
ولا `@testing-library` في أي اختبارٍ قائم — الأحكام على JSX كانت نصّية كلها).

ومن المقيس في هذه الاختبارات: بطاقة الإقلاع الافتراضية كما كانت حرفاً، وقابلية استبدالها،
وتمرير سبب فشل الدخول إلى شاشة الدخول (وبلا سببٍ لا يُخترع نصّ)، والسطح العام يمرّ **قبل**
قراءة الحالة (فلا تُطلب جلسة من بوابة المورد ولو كانت الحالة `loading`)، و`/esign-evil` لا يمرّ،
و`/m/attendance` يأخذ قشرة الموظف بينما `/marina` و`/migration` و`/manufacturing` تأخذ لوحة
الإدارة، وتطبيقٌ بلا قشرة موظف يبقى على قشرة واحدة.

### 8.4 ما بقي قراراً للتطبيق (لا في الحزمة)

- **سياسة الأسطح**: `apps/staff/lib/surface-routing.ts` (26 سطراً) تُعرّف بادئات staff
  (`/supplier-portal`, `/esign` عامة، و`/m` قشرة موظف) عبر `createSurfacePolicy`. **الآلية مشتركة
  والسياسة محلية** عن قصد: مسارٌ عامٌّ مخمَّن في الحزمة ثغرةُ وصول لا ميزة، وافتراض
  `createSurfacePolicy` هو الأضيق (لا سطح عاماً ولا قشرة موظف ⇒ كل مسار يُفحص).
- **الربط**: `auth-gate.tsx` في staff (46) يمرّر السياسة والقشرتين وشاشة الدخول مع حدّ
  `Suspense` (لأن `LoginScreen` تقرأ الاستعلام، والحدّ عند من يستعمل الاستعلام لا عند البوابة)،
  وفي `platform-admin` (30) يمرّر `PlatformGuard` وشاشة دخوله بلا سياسة.
- **مصدر الجلسة**: `useSession` بقي في كل تطبيق — في staff هو الحزمة عبر الجسر، وفي البوابة
  نسختها المحلية (§8.3).

### 8.5 لماذا لم تنتقل القشرة البصرية (بدل التخمين)

`app-shell.tsx` (778) يستورد `visibleModules` و`ModuleNode`/`ScreenGroup`/`ScreenItem` من كتالوج
staff (`lib/navigation.ts` — 2325 سطراً)، وفيه قائمتا إخفاء لمفاتيح الديسكتوب القديمة
(`CLOUD_HIDDEN_KEYS` و`CLOUD_HIDDEN_HREFS` — أكثر من عشرين مفتاحاً ومساراً)، ويستورد ثلاثة
مكوّنات من staff (`AssistantLauncher`, `ImpersonationBanner`, `NotificationBell`). فنقلها اليوم
يعني إما سحب الكتالوج والمكوّنات الثلاثة معها (أي نقل التطبيق نفسه) أو اختراع manifest بلا
مستهلكٍ ثانٍ يقيس عليه. **والمستهلك الثاني الحقيقي هو `apps/bakery`** (المرحلة 2): الصواب أن
تُصمَّم الحدود مقابل حاجته الفعلية، وتُترك القشرة حيث هي حتى ذلك الحين.

### 8.6 أدلة 0ب — الأوامر والأرقام الفعلية

```
$ corepack pnpm --filter @erp/web-core run test     → 20/20 (5 ملفات: +5 سياسة الأسطح، +8 رسم البوابة)
$ corepack pnpm --filter @erp/staff exec vitest run → 91/91 (14) — بلا تغيير في العدد
$ corepack pnpm --filter @erp/platform-admin exec vitest run → 27/27 (3)
$ corepack pnpm --filter "./packages/*" run build && corepack pnpm -r run typecheck → exit=0، صفر «error TS»
$ corepack pnpm -r run lint                                                → exit=0
$ corepack pnpm --filter @erp/staff run build         → exit=0
$ corepack pnpm --filter @erp/platform-admin run build → exit=0
$ corepack pnpm --filter @erp/api exec vitest run
  Test Files  1 failed | 197 passed (198) · Tests  1 failed | 1668 passed (1669) · 496.55s
  الفشل الوحيد printing-and-cards.spec.ts — السابق لكل هذه المراحل (ملفّاه غير معدَّلَين).
  **تحديث (بعد هذه المرحلة):** أُصلح هذا الفشل في جذره — كان رمز الفاتورة الإلكترونية
  يُختَرع في وثيقة الطباعة بدل أن يُطبع «لم تُصدر بعد». المجموعة الآن
  **198 ملفًّا / 1669 اختبارًا، كلها ناجحة (495.15s)**. التفصيل في
  `docs/EINVOICE_QR_HONESTY_REPORT.md`.
  وهذه المرحلة لم تلمس apps/api إطلاقاً (ولا packages/database ولا packages/contracts)،
  فشُغِّلت المجموعة للتأكيد لا للتوقّع.
```

ملاحظة أمانة: تشغيل `-r run typecheck` **وحده** فشل أولاً بـ«Cannot find module '@erp/config'» —
لا بسبب هذا التغيير، بل لأن `pnpm install` أُعيد بعد استعادة البيئة فمُحي `dist` للحزم؛ وأمر
الجذر `typecheck` يبني الحزم أولاً (`pnpm --filter "./packages/*" run build && …`) وهو الذي
اعتُمد قياساً عليه (exit=0). ويُذكر لأن «فشل ثم نجح» بلا سببٍ يُشبه الإخفاء.

### 8.7 الخادمان المُنشآن يخدمان القشرة المشتركة (قياس `curl`، لا متصفح)

`apps/staff` على 3001 — **المقاس بعد 0ب يطابق المقاس قبلها بايتاً بايت** (§6.1)، وهو أقوى ما
يتوفر هنا على «بلا تغيير سلوكي»:

| المسار | الرمز | البايتات | قبل 0ب | ما فيه |
|---|---|---|---|---|
| `/` | 200 | 11593 | 11593 | `boot-card` |
| `/?handoff=failed` | 200 | 11593 | 11593 | `boot-card` |
| `/van-sales` | 200 | 11782 | 11782 | `boot-card` |
| `/m` | 200 | 11456 | 11456 | `boot-card` (قشرة الموظف) |
| `/pos/offline` | 200 | 12244 | 12244 | `boot-card` |
| `/supplier-portal` | 200 | 11541 | 11541 | **بلا `boot-card`** — السطح العام يتجاوز البوابة |
| `/esign` | 404 | 11498 | 404 | (لا صفحة بهذا المسار؛ السطح عامّ مع ذلك) |
| `/login` | 404 | 11498 | 404 | المسار الذي لم يعد الجسر يرمي إليه (§5.1) |

و`apps/platform-admin` على 3003 — أول قياسٍ لها، وبطاقتها صارت من الحزمة:

| المسار | الرمز | البايتات | ما فيه |
|---|---|---|---|
| `/` | 200 | 9071 | `boot-card` + «جارٍ التحقق من الجلسة…» |
| `/audit` | 200 | 8874 | `boot-card` |
| `/health` | 200 | 9190 | `boot-card` |
| `/tenants` | 200 | 9506 | `boot-card` |

ولا «Application error» في أيٍّ منها. **وما لم يُقَس في التطبيقين**: ما بعد فحص الجلسة في
المتصفح (شاشة الدخول، والقشرة، ورسالة `handoff=failed`) — فلا متصفح في البيئة؛ والأحكام عليها من
اختبارات الرسم والنصّ (§8.3).

---

## 9) الخطوة التالية

> **تحديث ثانٍ (2026-10-14): البند 2 أُنجز — `apps/bakery` قائم ويستهلك الحزمة بلا جسر.**
> ‏(`docs/BAKERY_APP_PHASE2_REPORT.md`) التطبيق السابع يبني ويقلع على المنفذ 3005، ولا
> `lib/session.tsx` ولا `lib/api.ts` ولا `lib/use-query.ts` محلية فيه: `SessionProvider` و
> ‏`SessionGate` و`createSurfacePolicy` و`TokenBridge` وعميل الـAPI كلها من `@erp/web-core`
> مباشرةً. وبوابةُ الترخيص تقرأ `enabledApps` الذي أُضيف إلى `GET /me` في المرحلة نفسها
> (لأنّ كتالوج السوق يحتاج `tenant.view` ولا يملكه مندوب). وصارت الحزمة بأربعة مستهلكين:
> ‏staff وplatform-admin و**customer-portal** (أُضيفت إليها الاعتمادية لإصلاحٍ أدناه) وbakery.
>
> **وما كشفه المستهلك الثاني والثالث — لا المراجعة:** (أ) جسر التسليم كان يعامل وسمَ الفشل
> ‏`?handoff=failed` رمزاً فيستبدله، فيفشل، فيحوّل إلى العنوان نفسه ⇒ **حلقة إعادة تحميل**
> بنداءٍ خاسر في كلّ دورة. صار القرار دالّةً صافية واحدة في الحزمة (`handoffAction`) ينفّذها
> الجسران، ومقاسةً سلوكاً في سبيكين (22/22 في web-core و11/11 في البوابة). ودليلي السابق
> بـ`curl` لم يكن ليراها لأنّ `curl` لا يُنفّذ JavaScript. (ب) **`packages/web-core` غائب عن
> قائمتي `mkdir`/`COPY` في `deploy/Dockerfile.web` و`.api`** ⇒ `pnpm install --frozen-lockfile`
> داخل الصورة لا يحلّ `@erp/web-core: workspace:*`، أي أنّ بناء الصور معطوبٌ منذ `2acf9c2`
> ولم يظهر لأنّ أحداً لم يبنِ صورةً هنا (أُصلح **بالفحص**؛ فلا Docker في المحيط). وهذان
> بندَان يُضافان إلى حجة §8.5: استخراج القشرة يُظهر عيوبها حين يستهلكها غيرُ من كتبها.
>
> **تحديث (2026-10-14): المرحلة 1 بدأت وأُنجز منها بندآن.** (أ) رمز الفاتورة الإلكترونية
> صار يُطبع كما صدر فقط — حُذفت الحمولة المخترعة في الخادم والشاشة والمُرمِّز المزخرف،
> وأُغلق بسببه آخر اختبارٍ أحمر في مجموعة `apps/api` فصارت **1669/1669**
> (`docs/EINVOICE_QR_HONESTY_REPORT.md`، الإيداع `59560ee`). (ب) كود السوق
> **`bakery_distribution`** صار في الكتالوج المُراجَع باقةً قطاعية تتطلّب موافقة المنصة،
> وأُغلقت ثغرةٌ كانت تتيح لمدير المنشأة تثبيت باقةٍ قطاعية بلا قرار (`docs/BAKERY_LICENSING_PHASE1_REPORT.md`).
> فلم يبقَ من البند 1 أدناه إلّا القرارات المعلّقة في §10 وفي تقريري المخابز والرمز.

1. **المرحلة 1 — إصلاحات API** المعلّقة في تقرير المخابز (وهي ما يغلق الفجوات قبل البناء).
2. **المرحلة 2 — سقالة `apps/bakery`** على هذه القشرة (المنفذ 3005، `bakery.erp.example`، وبوابة
   `bakery_distribution` — الكود موجودٌ في الكتالوج فعلًا وتُقرأ رخصته من `enabledCodes` في
   `GET /marketplace/apps`): تستهلك `SessionGate` و`createSurfacePolicy` وعميل الجلسة من
   `@erp/web-core` مباشرةً بلا جسور.
3. **وعندها فقط 0ج — manifest والقشرة البصرية**: `AppShell`/`LoginScreen` تُصمَّم حدودها مقابل
   حاجة `apps/bakery` الفعلية (§8.5) لا مقابل تخمين، مع إبقاء staff على سلوكها حرفاً (والقياس:
   البناء + خدمة المسارات + مطابقة البايتات كما في §8.7). **وصار الشرط متحقّقاً**: ثلاثة
   مستهلكين حقيقيين للقشرة (staff وplatform-admin وbakery) وشاشةُ دخولٍ رابعة في البوابة،
   ومعها عدّةُ شاشةٍ مكرّرة (`Screen`/`Loading`/`ErrorBox`/`Forbidden`/`Empty` في staff **و**
   platform-admin — والتطبيق الجديد لم يُضف نسخةً ثالثة) مكانُها `@erp/ui` لا ثلاثة ملفات.
4. **نقل مواضع الاستيراد (451) وحذف الجسور السبعة** — خطوة ميكانيكية مستقلة يثبتها `typecheck`.

---

## 10) حالة المستودع

عمل §1–§7 مُودَع في `2acf9c2`. وعمل 0ب (§8) هو التغيير القائم الآن:

```
$ git status --short                        # بعد §8
 M apps/platform-admin/components/auth-gate.tsx  # ربط بـSessionGate (بلا سياسة أسطح)
 M apps/platform-admin/next.config.mjs           # transpilePackages
 M apps/platform-admin/package.json              # اعتماد @erp/web-core
 M apps/staff/components/auth-gate.tsx           # ربط بـSessionGate + سياسة staff
 M apps/staff/lib/surface-routing.ts             # السياسة وحدها، والآلية من الحزمة
 M apps/staff/tests/surface-routing.spec.ts      # الحكم على الربط والبوابة معاً (§8.4)
 M packages/web-core/{package.json,src/index.ts,vitest.config.ts}
 M pnpm-lock.yaml                                # إضافة صرفة (رابط platform-admin)
?? packages/web-core/src/session-gate.tsx        # 84
?? packages/web-core/src/surface-policy.ts       # 47
?? packages/web-core/tests/session-gate.spec.tsx # 109 — 8 اختبارات رسمٍ
?? packages/web-core/tests/surface-policy.spec.ts # 59 — 5 اختبارات
```

وما أُودع في `2acf9c2` (المرحلة 0):

```
 M apps/staff/app/layout.tsx              # TokenBridge من الحزمة
 M apps/staff/components/login-screen.tsx # رسالة handoff=failed
 M apps/staff/next.config.mjs             # transpilePackages
 M apps/staff/package.json                # اعتماد @erp/web-core
 M apps/staff/tests/offline-pos.spec.ts   # §5.3
 M apps/staff/tests/permission-codes.spec.ts # §5.2
 M eslint.config.mjs                      # §5.4
 M pnpm-lock.yaml                         # إضافة صرفة
 M scripts/verify-offline-pos.mjs         # §5.4
R  apps/staff/lib/{api,session,i18n,use-query,offline-db,sync-engine,sync} → packages/web-core/src/…
R  apps/staff/components/token-bridge.tsx → packages/web-core/src/token-bridge.tsx
R  apps/staff/lib/api-error-text.spec.ts → packages/web-core/tests/api-error-text.spec.ts
R  apps/staff/tests/session-handoff.spec.ts → packages/web-core/tests/session-handoff.spec.ts
?? apps/staff/lib/{api,session,i18n,use-query,offline-db,sync-engine,sync}.ts(x)  # الجسور (§4)
?? packages/web-core/{package.json,tsconfig.json,vitest.config.ts,README.md,src/index.ts,tests/offline-store.spec.ts}
```

- **لا حذف بيانات، لا تعديل ترحيل، لا تغيير في `apps/api` إطلاقاً** (`git status` لا يذكر منه
  ملفاً) — ولذلك أُعيد تشغيل مجموعته الكاملة للتأكيد لا للتوقع (§6 تُستكمل بأرقامها).
- **لا تغيير ضريبي، لا إنشاء حساب، لا قيد محاسبي، لا نشر على إنتاج.** ومجموعة `apps/api`
  الكاملة شُغِّلت بعد النقل فأعطت خط الأساس نفسه: **1668/1669** والفشل الوحيد السابق للمرحلة
  — وهذا الفشل أُغلق بعدها (‏`docs/EINVOICE_QR_HONESTY_REPORT.md`): المجموعة **1669/1669**،
  وstaff **102/102** (كانت 91/91 قبل قياسات الرمز الجديدة).
- عمل المراحل السابقة المُودَع (`93ef108`, `83b9785`) لم يُمسّ.
