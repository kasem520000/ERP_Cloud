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

### ما ليس جاهزاً

- **القشرة البصرية لم تنتقل**: `AppShell` (778) و`AuthGate` (44) و`LoginScreen` (391) و`EmployeeShell`
  (86) ما زالت في `apps/staff`، لأنها تحمل هوية التطبيق وكتالوج شاشاته. نقلها يحتاج حدوداً معلنة
  (manifest: الاسم، الشعار، الأسطح، الشاشات المفعّلة) — وهي **المرحلة 0ب** (§8).
- **`apps/platform-admin` و`apps/customer-portal` لم يُهاجَرا** إلى الحزمة، ولو أن فيهما نسخاً من
  الكود نفسه (§3). السبب التقني المحدد في §7.2 — والهجرة الجزئية **تُغيّر السلوك صامتةً**.
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
| `components/auth-gate.tsx` | 44 | يربط القشرتين وسياسة الأسطح — نفسه |
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

**ولم يُصلح في النسخة الثالثة:** `apps/customer-portal/components/token-bridge.tsx:35,42` ما زال
يرمي إلى `/login?handoff=failed`، ومسارات البوابة `app/auth/*` لا `app/login` — أي أن العطل نفسه
قائم هناك. **لم يُمسّ** لأنه تطبيقٌ آخر خارج حدود هذه المرحلة، ويُذكر هنا حتى لا يُنسى.

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

## 8) الخطوة التالية

1. **0ب — حدود التطبيق (manifest) ونقل القشرة البصرية**: `AppShell`/`AuthGate`/`LoginScreen`
   تأخذ manifest (الاسم، الشعار، المسار الجذري، الأسطح العامة، القشرات، الشاشات) فتصير صالحة
   لتطبيقين، مع إبقاء staff على سلوكها حرفاً (والقياس: البناء + خدمة المسارات + أحكام المصدر).
2. **نقل مواضع الاستيراد (451) وحذف الجسور السبعة** — خطوة ميكانيكية مستقلة يثبتها `typecheck`.
3. **المرحلة 1 — إصلاحات API** المعلّة في تقرير المخابز، ثم **المرحلة 2 — سقالة `apps/bakery`**
   على هذه القشرة (المنفذ 3005، `bakery.erp.example`، بوابة `bakery_distribution`).

---

## 9) حالة المستودع

```
$ git status --short
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
  الكاملة شُغِّلت بعد النقل فأعطت خط الأساس نفسه: **1668/1669** والفشل الوحيد السابق للمرحلة.
- عمل المراحل السابقة المُودَع (`93ef108`, `83b9785`) لم يُمسّ.
