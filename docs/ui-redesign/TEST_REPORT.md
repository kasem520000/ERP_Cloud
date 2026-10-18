# سجل التحقق — دفعة 2026-10-18

## تحقق آلي ناجح

- `node scripts/ui-screen-registry.mjs --check`: 298 route entrypoints مطابقة للملفات. `node scripts/check-ui-design.mjs`: 5 استيرادات للرموز، وربط البوابة/منع hex في طبقتها، وتزامن السجل. `git diff --check`: ناجح.
- `@erp/ui` typecheck/lint وVitest 25/25 (منها اختبارات عرض PageFrame/FormField/TableViewport). `@erp/web-core` typecheck وVitest 56/56؛ `@erp/contracts` build ناجح (مطلوب أولاً لإنشاء تعريفاته).
- customer-portal: typecheck/lint/Vitest 21/21 (10 مسارات تفحص ربط البنية، وليست فحصاً بصرياً) و`next build` ناجحة. بناء login بعد استخدام subpath: First Load JS نحو 105kB (بدلاً من 277kB عند الاستيراد من barrel). CSS المنشور يحتوي أصناف مكتبة `@erp/ui` (لم تُسقطها Tailwind).
- marketing typecheck/lint/Vitest 99 ناجحة وواحد متروك (100/100 في تشغيل سابق) والبناء ناجح بعد إضافة PostCSS/@source (CSS المبنية ~73KB وتتضمن `.bg-brand`؛ لقطات Chromium موثّقة أدناه)؛ staff typecheck/lint/Vitest 96 ناجحة؛ platform-admin typecheck/lint/Vitest 27 ناجحة؛ bakery typecheck/lint/Vitest 259 ناجحة و`next build` ناجحة بعد تعديل `/accounting`. تحذيرات Next ESLint plugin و`boundaries` غير مانعة. **لم يُشغَّل بناء staff/platform-admin**؛ لا ادعاء بنجاحه.

## فحص Chromium الأول — قبل إعداد قاعدة البيانات، 2026-10-18

شُغّل Chromium 153 عبر playwright-core بمكتبات محلية في `.cache/browser/linux/lib` (تجهيز مؤقت غير داخل Git). الصور الملتقطة محفوظة في `docs/ui-redesign/evidence/`. في هذه الجولة الأولى اقتصر الفحص على السطح العام؛ **توجد جولة دخول محمي لاحقة أدناه**.

| المسار والسطح | فحص المتصفح | التفاعل | النتيجة/الحد |
| --- | --- | --- | --- |
| marketing `/` عربي 1280 و390 | HTTP 200، RTL، دون فيض أفقي أو أخطاء page JS؛ `marketing-home-1280.png` و`marketing-mobile-after-390.png` | زر «لا أوافق» أخفى لافتة الموافقة؛ لم يُرسل حدث تحليلي تجريبي | اختصار اسم الهوية على الهاتف أصلح ارتفاع الرأس؛ بقية الصفحة لم تُعد هيكلة محتواها الفردي بعد. بيانات CMS عامة احتياطية فقط؛ API غير متاح. |
| customer-portal `/auth/login` 1280 و390 | HTTP 200، RTL، دون فيض؛ `portal-login-1280.png` و`portal-login-after-390.png` | اعتراض طلب الدخول بــ401 وهمية ببيانات مصطنعة فقط، عرض «بيانات الدخول غير صحيحة»؛ `portal-login-error-390.png` | أزيل شرح `localStorage/cookie` وزر الدخول المكرر؛ لا دخول حقيقي أو اختبار جلسة/ملف مستخدم. |
| customer-portal `/auth/forgot` 1280 و390 (خطأ) | HTTP 200، RTL، دون فيض؛ `portal-forgot-1280.png` و`portal-forgot-error-390.png` | اعتراض استجابة 422 وهمية بنص خطأ إنجليزي، وعُرض السبب بالعربية؛ لم يُرسل بريد | لم تُفحص حالات نجاح أو فشل الخادم الفعلي. |
| staff بوابة الدخول `/` 1280 و390 | HTTP 200، RTL، `staff-login-desktop-final-1280.png` و`staff-login-mobile-after-390.png` | لا محاولة دخول | عُرّب وصف العزل وأُزيل مصطلح RLS من صفحة الدخول، وضُغط الرأس على الهاتف. **لوحة التحكم المحمية لم تُفتح**. |
| platform-admin بوابة الدخول `/` 390 | HTTP 200، RTL، `platform-login-mobile-after-390.png` | لا محاولة دخول | ضُغط الرأس على الهاتف؛ **لوحة المنصة المحمية لم تُفتح**. |
| bakery `/accounting` دون جلسة 390 | HTTP 200 لبوابة الدخول فقط؛ `bakery-accounting-unauth-final-390.png`، بعد إزالة الرمز الداخلي وإصلاح تباين زر الدخول (النص الآن أبيض على الأزرق في CSS المحسوبة) | لا تسجيل دخول | لا فحص للمحاسبة التفصيلية أو رابط التسليم بلا ترخيص وجلسة؛ بيانات النموذج لم تُرسل. |
| marketing `/ar` | HTTP 404؛ `marketing-ar-1280.png` | لا شيء | هذا الموقع يضع العربية على `/` لا على `/ar`؛ ليست صفحة رئيسية عربية ناجحة. |

ظهرت في أول تشغيل للصفحة التسويقية رسالة hydration mismatch عابرة تخص `caret-color`، ولم تتكرر مع الفحص اللاحق. اللقطة الأولى fullPage فشلت بتجاوز المهلة، ثم نجحت لقطات viewport عند السماح بالانتقالات. لا تستنتج سلامة جميع حالات الصفحة من غياب أخطاء console في الفحص المختصر. رمز Next في الصور يخص خادم التطوير وليس جزءاً من HTML الإنتاجي؛ بوابة العملاء فُحصت أيضاً ببناء إنتاجي (`next start`).

**حصيلة الجولة الأولى (قبل إعداد قاعدة البيانات):** ثلاث صفحات عامة مستقلة (`marketing /`, `portal /auth/login`, `portal /auth/forgot`) + بوابتا دخول لسطحين محميين؛ لم تُفحص أي صفحة محتوى staff/platform-admin أو بوابة العميل بعد المصادقة. صفر DONE من 298؛ لا تُساوِ لقطة صفحة دخول بفحص لوحة التحكم نفسها. التفاعلات التي فُحصت: رفض الموافقة الاختيارية في التسويق، وفشل دخول مصطنع واستعادة مصطنعة في البوابة. صفحات bakery `/accounting` وسائر الشاشات المالية لم تُفتح ببيانات/صلاحيات تجريبية، ولا يُشغّل عليها إجراء مالي.

## تحقق آلي إضافي في هذه الدفعة

- typecheck/lint للتطبيقات الخمسة و`@erp/web-core` نجح بعد التعديلات. `@erp/web-core` 56/56؛ staff 96/96؛ platform-admin 27/27؛ customer-portal 21/21؛ bakery 259/259؛ marketing 99 نجاح + 1 skipped. `@erp/contracts` من البناء السابق.
- اختبار جديد يطابق رموز صلاحيات المنشأة القانونية مع أسماء عربية مولّدة أو يدوية، بدل ظهور وصف API الإنجليزي. أضيفت أسماء رموز console الناقصة؛ الرمز التقني لا يزال يظهر كمعرّف ثانوي لمراجعة الإذن، لا بصفته الاسم. تغيير العرض لا يغيّر قيمة الرمز ولا قرار التفويض.
- أُزيلت تفاصيل تطويرية كانت تُرسل داخل `<details>` في لوحة المخابز، وكذلك رموز المسارات ومفاتيح عدم التكرار من عرض طابور المندوب. أُصلح ترتيب CSS الأساسي المركزي حتى لا يطغى `button { color: inherit }` على `.text-brand-ink` (فحص Chromium للون الزر أعاد `rgb(255,255,255)` مقابل خلفية `rgb(37,99,235)`).
- طبقة عرض أخطاء API في web-core/لوحة المنصة/البوابة (بما فيها أخطاء الشبكة في الاستعلامات واستعادة كلمة مرور البوابة) تُبقي التفاصيل العربية ذات المعنى لأخطاء العميل وتستبدل التفاصيل الإنجليزية/HTML/أخطاء 5xx برسائل عربية آمنة؛ ليس هذا تدقيقاً لكل نص ثابت أو لكل `catch` في المستودع. اختبار الوحدة غطى 422 و404 و409 و500 وانقطاع الشبكة، ولم يُجر اختبار خطأ حقيقي عبر API.
- customer-portal `next build` ناجح بعد إصلاحات الدخول؛ staff/platform-admin builds الإنتاجية **غير منفذة** بعد. `scripts/check-ui-design.mjs` والسجل و`git diff --check` نجحت. تحذير Next ESLint plugin / boundaries غير مانع.

## تشغيل محلي وفحص Chromium المحمي — 2026-10-18

- نُفّذ `pnpm install --frozen-lockfile` ثم `pnpm env:setup` ثم بناء `@erp/config` و`@erp/contracts` و`@erp/database`. فشل `pnpm db:up` لأن Docker غير مثبت، فاستُخدم `pnpm db:local` لتشغيل PostgreSQL محلياً؛ نجحت `pnpm db:migrate` (131 هجرة)، و`pnpm db:seed` (demo + مشغّل المنصة) و`pnpm db:roles`. نجح دخول demo owner إلى API مباشرةً (HTTP 200) ثم سُجّل الدخول في Chromium بحسابات `.env` دون إدراج بيانات الاعتماد أو الرموز في التقرير. تنبيه seed: بيانات هوية الشركة التجريبية توضيحية وقد تظهر في الفواتير/ZATCA، فلا تُستخدم إنتاجياً.
- بدأ `pnpm dev` بجميع التطبيقات لكنه تجاوز ذاكرة الحاوية (~3.8 GiB) وتعطّل API؛ استُخدمت واجهة واحدة في كل مرة مع API وPostgreSQL، على المنافذ 3001/3003/3005/3004. HTTP 200 وحده لا يثبت اكتمال التصيير؛ انتظر الفحص خروج بوابة الجلسة وظهور المحتوى قبل التصوير. جميع الصور التالية من Chromium 153 بعد جلسة حقيقية، وهي لقطات نافذة العرض لا الصفحة بأكملها.

| السطح/المسار | ما ظهر فعلاً بعد الدخول | دليل/حدود |
| --- | --- | --- |
| staff `/` | لوحة المالك ومحتوى المؤشرات بالعربية، RTL؛ HTTP 200، بلا pageerror | `evidence/staff-home-authenticated-1280.png`؛ لم تُجرّب أزرار المؤشرات. |
| staff `/settings/roles` | الأدوار وصلاحياتها بالعربية (الدور المحدد 63 من 179) والرمز التقني ثانوي؛ RTL و390px دون فيض جسم الصفحة | `evidence/staff-settings-roles-authenticated-1280.png` و`-390.png`؛ لم تُعدّل صلاحية أو تُحفظ. |
| staff `/settings/users` و`/accounting/ledger` | بطاقتا المستخدمين وكشف الحساب؛ RTL، HTTP 200 بلا pageerror | `evidence/staff-settings-users-authenticated-1280.png` و`staff-accounting-ledger-authenticated-1280.png`؛ لا دعوة أو قيد مالي. |
| platform-admin `/` و`/roles` | مؤشرات المنصة وقائمة أدوار المنصة مترجمة بعد دخول المشغّل؛ RTL، و`/roles` عند 390px دون فيض | `evidence/platform-home-authenticated-1280.png` و`platform-roles-authenticated-{1280,390}.png`؛ أُعيد الفحص بعد الإصلاح أدناه بلا pageerror؛ لا تغيير أدوار. |
| bakery `/` و`/accounting` | لوحة المخابز والوجهات المحاسبية برخصة demo؛ RTL، `/accounting` عند 390px بلا فيض | `evidence/bakery-home-authenticated-1280.png` و`bakery-accounting-authenticated-{1280,390}.png`؛ تسليم جلسة staff لم يُختبر. |
| bakery `/rep` | حالة «حسابك غير مرتبط ببطاقة مندوب» للمالك؛ ليست دورة مندوب مرتبط | `evidence/bakery-rep-authenticated-1280.png`؛ لا حركة مخزون أو تحصيل. |
| customer-portal `/portal` و`/portal/invoices` و`/portal/profile` | نجح تسجيل دخول demo owner، ثم ظهر حاجز «هذا الحساب غير مرتبط ببوابة العملاء» في المسارات الثلاثة | `evidence/portal-portal-authenticated-1280.png` و`portal-portal-invoices-authenticated-1280.png` و`portal-portal-profile-authenticated-1280.png`؛ **لم تُفتح محتويات تلك الصفحات** لغياب حساب عميل بوابة مرتبط، لذا بقي فحصها البصري `NOT_STARTED`. |

**عطلان ظهرَا في الفحص وعولجا:** استدعت `SessionGate` شاشة الدخول والقشرة كدوال أثناء الانتقال بين مجهول ومصادَق؛ hooks القشرة انضمت إلى hooks البوابة، فأظهر Chromium في المنصة `TypeError: Cannot read properties of undefined (reading 'length')` عند `useQuery` (رغم أن المحتوى بدا ظاهراً). أصبحت الفروع عناصر React مستقلة؛ أعيد فحص المنصة `/` و`/roles` دون `pageerror`، ولم يتغير قرار الجلسة أو API. كذلك جرى إرسال نموذج دخول بوابة العملاء مبكراً قبل hydration في الجولة الأولى بأسلوب GET الافتراضي، ما يضع الحقول في URL وسجل خادم التطوير؛ حُذف ذلك السطر من السجل المحلي المتجاهَل، وأضيف `method="post"` إلى نماذج الدخول/تغيير كلمة المرور/الاستعادة كحماية لمرحلة ما قبل hydration. فحص Chromium مع JavaScript معطّل أكد انتقال `POST /auth/login` دون query string؛ ثم نجح الدخول عند انتظار hydration. لا توجد بيانات اعتماد في الأدلة أو Git.

**الحصيلة:** تسع شاشات محمية فتحت فعلاً (4 staff + 2 platform + 3 bakery)، و3 مسارات بوابة اقتصر ما ظهر فيها على حاجز الوصول. فحص العرض الأولي لا يعني `DONE`: لم تُختبر قبل/بعد كل شاشة، الجداول/التفاعلات/النوافذ/الحالات كلها أو كل أحجام العرض؛ يظل **0 من 298 DONE**. رمز `1 Issue` الظاهر أسفل بعض الصور طبقة أدوات Next التطويرية، وليس نص HTML من تصميم الإنتاج؛ بعد إصلاح hook لم يتكرر خطأ JavaScript في إعادة فحص المنصة.

## شروط الاستكمال

أصبحت API/DB التجريبية وحسابات staff/المنصة ورخصة bakery متاحة محلياً؛ ما يزال يلزم حساب عميل بوابة مرتبط وسجلات فواتير تجريبية وحالات مندوب مرتبط ومحتوى تسويقي عربي وإنجليزي؛ افتح كل route وحالاته بما فيها loading/error/empty/forbidden/dialog/mobile/print. لا تجرّب الدفع الفعلي، الحذف أو ترحيل قيود. سجل لقطات قبل/بعد لكل شاشة وملاحظات console والشبكة في السجل. الاختبارات أعلاه تثبت الترجمة/العقود الأساسية ولا تحل محل التحقق البصري. لم تنته إعادة هيكلة مكونات معظم الشاشات بعد.
