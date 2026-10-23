# R33 — الإصلاح الكودي الشامل (بتفويض المستخدم) وإثباته بإعادة التنفيذ

**الفرع:** `arena/0e400dd3-erp-cloud` — من `0a9dc57` (نهاية R32) إلى **`c761688`** (آخر دفعة مدفوعة قبل هذا التقرير).
**التفويض:** «اعطيك القرار والصلاحية ببدء الإصلاح الشامل… اصلاح كل المشاكل… اعتمد عليك» — أي تعديل الكود **واتخاذ قرارات السياسة المعلّقة** مع توثيقها بحيث يمكن عكسها (§4).
**القاعدة الثابتة:** لا إصلاح ببيانات أو قيود تسوية؛ كل إصلاح في الكود وله إعادة تنفيذ موثّقة (فاحص حي على بذرة معزولة + اختبار وحدة/تكامل). ما لم يُعَد تنفيذه حياً يُكتب صراحةً «FIXED-UNIT-ONLY» لا «FIXED-VERIFIED».

## 0. خلاصة تنفيذية

| البند | العدد / النتيجة |
|---|---|
| عيوب مفتوحة قبل R33 (أحكام R32) | 20 (STILL-OPEN 7 + PARTIAL 5 + NEW-REGRESSION 5 + NEW 3) |
| منها **مُصلَحة ومُثبَتة حياً** (FIXED-VERIFIED) | **19 من 20** — ACC-032, 035, 044, 045, 064, 120, 152, 153, 156, 157, 162, 164, 165, 166, 167, 168, 169, 170, 171 (§1)؛ **ACC-141** توثيق فقط (قرار تصميمي). إضافةً: ACC-163 (كان FIXED-VERIFIED في R32 مع ملاحظة `lastError` غير مفحوصة) — `lastError` يُمسح الآن (Q04) |
| عيوب **جديدة** اكتُشفت أثناء R33 وأُصلحت | **14** — ACC-172 … ACC-185 (§2)؛ منها 4 اكتُشفت في الفرز الأخير للاختبارات المحجوبة (ACC-182 تقرير الرواتب 500، ACC-183/184/185 تداخل المسيّر مع الإذن الفردي — **ACC-185 CRITICAL**)؛ كلها FIXED-VERIFIED حياً عدا ACC-181 (خصوصية سجل التدقيق — اختبار وحدة؛ الموقع العام لا يُخدَم في بيئة الفحص) |
| فاحصات حيّة (مستأجر `AUDIT-TEST-2026-R24`) | بذرة 11: probe1 **68/68** (RUN 18)، probe2 **46/46** (RUN 19)، probe3 **48/48** (RUN 18). **بذرة 12 على البناء الختامي `b307d21`:** probe1 **68/68** (RUN 23)، probe2 **42/42** (RUN 23؛ الفارق 4 فحوص ديناميكية لموظفي بذرة 11)، probe3 **48/48** (RUN 23)، **probe4 (Block U جديد) 22/22** (RUN 21/22: ACC-178 U01–U08، ACC-180 U10–U16، ACC-177 U20–U26) — `evidence/round-33/` |
| اختبارات `apps/api` (vitest) | قبل R33 (الأساس `0a9dc57`): **46 فشلاً**؛ **بعد R33 (`02ea39f`): 534 ملفاً / 2038 اختباراً — 2012 ✓ / 1 ✗ / 25 معلّق**، والفشل الوحيد (`ai-help` لقطة التنقل) أُصلح في `b307d21` بإعادة توليد اللقطة ⇒ **0 فشل متوقَّع** (§6) | **التشغيل الختامي على `d4e48ed`+: R33_FINAL_VITEST**
| `tsc --noEmit` | نظيف على كل دفعة |
| ترحيلات جديدة | `0142_van_load_orders_customer_returned_qty.sql` و`0143_payroll_run_line_status_repair.sql` (إصلاح بيانات ACC-183 بسجل تغييرات) — كلاهما مع `down/` وأُثبتت قابلية عكسهما |

**ما لم يُصلَح (مقصود):** ACC-141 (توثيق فقط — قرار تصميمي خارج نطاق التفويض)؛ بوابة البطاقات تبقى محاكاة (لا يوجد مزوّد حقيقي في بيئة الاختبار)؛ ضريبة فاتورة التفصيل ثابتة 15 % في الكود (`TAX_RATE`) متسقةً مع افتراض النظام (ACC-109) لكنها ليست إعداداً للمستأجر (نقص وظيفي لا عيب حسابي).

## 1. العيوب الـ20 المفتوحة بعد R32 — الإصلاح والدليل

الأعمدة: **الإصلاح** = الملف/الدالة والفكرة؛ **الدليل الحي** = معرّفات فحوص الفاحص (`docs/accounting-audit/scripts/round33-probe{1,2,3}.cjs`؛ الاستجابات واللقطات في `evidence/round-33/R33-<check>-<RUN>-response.json` و`R33-DB-<RUN>-NNN-*.json`)؛ **الاختبار** = vitest.

| المعرّف | الشدة | حكم R32 | الإصلاح (الكود) | الدليل الحي | الاختبار | الحالة |
|---|---|---|---|---|---|---|
| ACC-032 | HIGH | PARTIAL | `purchases.service.ts` سداد فاتورة الشراء يُصدر **سند صرف** مرحَّلاً (طرف + موقع نقد) ثم القيد؛ `cashLocationId` صريح وإلا الافتراضي للفرع (`safe`/`bank`) وإلا 422 `CASH_LOCATION_REQUIRED`؛ إعادة الإرسال idempotent | K08–K09 | `purchase-posting.spec.ts` | FIXED-VERIFIED |
| ACC-035 | HIGH | STILL-OPEN | `bank-feeds.service.ts` المطابقة التلقائية تقتصر على **سندات مرحَّلة على مواقع الحساب البنكي نفسه**؛ التأكيد = مبلغ + اتجاه + قرينة (≥0.8) **لمرشّح فريد**؛ التعادل → `suggested` فقط؛ لا مطابقة مع فاتورة (مسددة أو لا) | P09–P09g, P20, P21 | `bank-reconciliation.spec.ts` | FIXED-VERIFIED |
| ACC-044 | HIGH | STILL-OPEN | المطابقة اليدوية ترفض اختلاف الاتجاه/الحساب/المبلغ (`BANK_MATCH_DIRECTION_MISMATCH` / `ACCOUNT_MISMATCH` / `AMOUNT_MISMATCH`) ما لم `partial:true` صريحاً (ثقة 0.9 وسبب جزئي) | P11, P12, P14, P15, P17 | — | FIXED-VERIFIED |
| ACC-045 | MEDIUM | STILL-OPEN | هدف المطابقة يجب أن يكون **مرحَّلاً** (`BANK_MATCH_TARGET_NOT_POSTED`) وغير مطابَق سابقاً (`BANK_MATCH_TARGET_ALREADY_MATCHED`) | P13, P14, P18 | — | FIXED-VERIFIED |
| ACC-064 | LOW | STILL-OPEN | فكّ مطابقة سطر غير مطابَق → 409 `LINE_NOT_MATCHED` بدل 200 صامت | P10, P19 | — | FIXED-VERIFIED |
| ACC-120 | HIGH | STILL-OPEN | `accounting.service.ts` قائمة الدخل: سطر «بضاعة آخر المدة» **معطَّل افتراضياً** (الأستاذ دائم الجرد)؛ يظهر فقط بـ`with_stock=1` ويُحجب مع ملاحظة `PERPETUAL_COGS_POSTED` إذا رُحِّلت تكلفة مبيعات في الفترة (منع احتساب COGS مرتين) | S01, S02 | `income-statement.spec.ts` | FIXED-VERIFIED |
| ACC-141 | MEDIUM | STILL-OPEN | **لم يُعدَّل كود** — `POST /journal-entries` ينشئ القيد اليدوي `posted` فوراً بلا مسودة؛ تغييره إلى مسودة+اعتماد يمسّ كل شاشات القيود والواجهة (قرار تصميم/سير عمل خارج نطاق إصلاح العيوب؛ موثَّق كتوصية في `MISSING_FEATURES.md`) | — | — | DOCUMENTED (OPEN) |
| ACC-152 | HIGH | PARTIAL | قيد تحميل العجز على المندوب: مدين حساب الموظف / **دائن حساب تسوية المخزون 3121004** (لا 1270001 — كان يخفّض المخزون مرتين)؛ المخزون يُخفَّض مرة واحدة فقط بمستند الجرد (انظر ACC-168) | L10c, L10d, L10e, L10f | `van-sales-stock-acceptance.spec.ts` (charges…) | FIXED-VERIFIED |
| ACC-153 | HIGH | PARTIAL | عمود `customer_returned_qty` (ترحيل 0142) يفصل **مرتجع العميل** (ينقص المبيعات والنقد المتوقع) عن **مرتجع المستودع** (`returned_qty`)؛ صف المرتجع `total` إجمالي بالضريبة و`subtotal` صافٍ | L04b, L04f | `van-sales-returns-in-reports.spec.ts` | FIXED-VERIFIED |
| ACC-156 | HIGH | STILL-OPEN | مرتجع فاتورة **نقدية** = ردّ نقدي شامل الضريبة: القيد يدائن موقع النقد (ودفتره الفرعي) ولا يلمس الرقابي 12310001 | L04c, L04d, L04e | `van-sales-returns-in-reports.spec.ts` | FIXED-VERIFIED |
| ACC-157 | MEDIUM | PARTIAL | لوحة المندوبين: رصيد المستودع الرئيسي **مشتق من الأستاذ** = `stock_balances`؛ المجاميع تستثني الأوامر `rejected/cancelled/canceled/draft` (وتوحيد هجاء `canceled`) | O00–O02c | — | FIXED-VERIFIED |
| ACC-162 | HIGH | PARTIAL | إيقاف حساب البوابة عبر `portal_accounts.status` (لا `memberships.status`) → login/refresh 403 `PORTAL_ACCESS_SUSPENDED`؛ إعادة التفعيل تعيد الدخول؛ الإلغاء 401 | R01–R08 | `portal.spec.ts` | FIXED-VERIFIED |
| ACC-163 | LOW | FIXED-VERIFIED (ملاحظة `lastError` مفتوحة) | `payment-links.service.ts`: `lastError` يُمسح عند نجاح الـwebhook؛ `GET /payments/links/:id` 200 | Q03, Q04, Q05 | `payment-gateways.spec.ts` | FIXED-VERIFIED |
| ACC-164 | CRITICAL | NEW-REGRESSION | `payments.service.ts::settleIfApproved` يكتب **سند قبض واحد + قيد واحد + `invoice_payments` واحد** لكل تحصيل بطاقة؛ التخصيص بالمبلغ الفعلي (جزئي 5 ثم 6.50) ولا قيد `sales_payment` ثانٍ؛ **عميل نقدي (بلا طرف):** `paid_total/payment_status` يُحدَّثان مع إسقاط صف `payment_allocations` فقط (ACC-180) | K06–K07b | `payment-gateways.spec.ts` 16/16 | FIXED-VERIFIED |
| ACC-165 | MEDIUM | NEW | **قرار سياسة (§4.1):** بيع بطاقة حقيقي (`simulation=false`) بلا فاتورة مبيعات مرحَّلة → 422 `PAYMENT_INVOICE_REQUIRED` **قبل أي اتصال بالمزوّد**؛ في المحاكاة يُسجَّل `settled:false` ولا سند/قيد/`invoice_payment` ولا أثر على 12310001 | K04, K04b | `payment-gateways.spec.ts` (`dials it for real`) | FIXED-VERIFIED |
| ACC-166 | HIGH | NEW-REGRESSION | إنشاء حساب الموظف التلقائي (ACC-085) يكتب `level`/`path` (كان 500 بخرق NOT NULL) | L11–L17c | `van-sales-stock-acceptance.spec.ts` الخطوة 7 | FIXED-VERIFIED |
| ACC-167 | CRITICAL | NEW-REGRESSION | معادلة الإقفال: `expected = loaded − sold + customer_returned − returned_to_main − damaged`؛ حارس التجاوز يعود للعمل (3 + 9 > 10 + 1 → 422)؛ لا عجز وهمي ولا مستند جرد بكمية متوقعة سالبة | L04f, L05b, L05c, L06e | `van-sales-stock-acceptance.spec.ts` | FIXED-VERIFIED |
| ACC-168 | HIGH | NEW | **إصلاح الجذر (دفعة `c459870`):** أُلغيت حركة `van_shortage_writeoff` عند الاعتماد نهائياً؛ **مستند الجرد الرسمي** الذي يفتحه الاعتماد هو **الحركة الوحيدة** للعجز ويرحّل المحرك قيده (مدين 3121004 / دائن 1270001) في المعاملة نفسها عند «استكمال تسوية المخزون». قبل ذلك كان الشطب المبكر (أ) يترك المخزون دون الأستاذ عند عدم تحميل المندوب (GL − Σstock = 6.00 في R32) و(ب) يستبق مستند الجرد فيقيس رصيداً مخفَّضاً ويُسجّل **فائضاً وهمياً** (ADJ-000002 بذرة 9) | L06a–L06d, L10a, L10b | `van-sales-stock-acceptance.spec.ts` 8/8، `van-sales-stock-settlement.spec.ts` | FIXED-VERIFIED |
| ACC-169 | MEDIUM | NEW-REGRESSION | إقفال عجز المناقلة يمرّ بـ`recordInTx` (زوج in ثم out على مستودع الوجهة) فيتطابق دفتر الحركات مع `stock_balances` | N04b, N04c, N04d, N04f | `remediation-phase6.spec.ts` | FIXED-VERIFIED |
| ACC-170 | HIGH | NEW-REGRESSION | المسيّر يستحق على **أوراق قابلة للترحيل**: مدين 3122001، دائن حساب كل موظف 2241xxxx؛ `postJournalInTx` يرفض أي سطر على `is_postable=false` (422 `ACCOUNT_NOT_POSTABLE`) — حارس عام في الأستاذ | M00, M03–M03e, M04f | `remediation-phase4/8.spec.ts`, `migration-0125-reversibility.spec.ts` | FIXED-VERIFIED |
| ACC-171 | LOW | NEW | `treasury.service.ts::createVoucherInTx`: التحقق من `date`/`method`/`amount`/`cashLocationId` → 422 `VOUCHER_INPUT_INVALID {field}` بدل 500 | K01–K03b | — | FIXED-VERIFIED |

## 2. عيوب جديدة اكتُشفت أثناء R33 (كلها مُصلَحة؛ التفصيل والأدلة في `DEFECTS.md`)

| المعرّف | الشدة | الوصف المختصر | الإصلاح | الدليل |
|---|---|---|---|---|
| ACC-172 | HIGH | مرتجع العهدة (سيارة → رئيسي) كان يُستلم بقيمة مختلفة عن قيمة الخروج (قيمة تضيع بين المستودعين) | `van-sales.service.ts` الاستلام بتكلفة حركة الخروج نفسها | L06g, L06f |
| ACC-173 | LOW | اسم مندوب مكرر → 500 | 409 `SALESMAN_NAME_TAKEN` | L13a |
| ACC-174 | MEDIUM | مسيّر **معكوس** يمنع إنشاء مسيّر جديد للشهر نفسه (`PAYROLL_RUN_EXISTS`) | `hrm.service.ts` الحارس يتجاهل `reversed` | M07 |
| ACC-175 | LOW | إقفال عجز المناقلة لا يُفرغ «بضاعة بالطريق» 1270003 بالقيمة غير المستلمة بالضبط | قيد العجز: مدين 3121004 / دائن **1270003** = (Σمرسَل − Σمستلَم) بالتكلفة | N04e, N04e2, N04e3 |
| ACC-176 | MEDIUM | ذمم لوحة المندوبين تطرح **كل** المرتجعات بما فيها المردودة نقداً | الذمم تطرح المرتجعات الآجلة فقط (`المرتجع − المردود نقداً`) | T05b, T06, T07 |
| ACC-177 | HIGH | ترحيل المستخلص (`projects.service.ts::postBill`) على رأسَي «123»/«4» (حسابان تجميعيان) | الحسابات من ملف ترحيل الفرع ثم fallback على أوراق `is_postable` | `production-and-returns.spec.ts` 3/3 (FIXED-UNIT-ONLY — لا فاحص حي للمقاولات) |
| ACC-178 | HIGH | دفعة إنتاج المخبز **بلا `batchNo` صريح**: الأمر الرسمي يستلم الناتج في لوت يرقّمه بنفسه بينما تأخذ الدفعة `PROD-<اليوم>-0001` من التسلسل ⇒ رقمان لكمية واحدة، وكل صرف لاحق بالرقم (تحميل/بيع المندوب) → 422 `LOT_NOT_FOUND` | رقم الدفعة يُحسم **قبل** الأمر الرسمي ويُمرَّر رقمَ لوت الناتج (`outputLot.lotNo = allocatedBatchNo`) | `van-sales.spec.ts` (كان يفشل منذ الأساس عند `:491`) — FIXED-UNIT-ONLY؛ الفاحصات الحية تمرّر `batchNo` صريحاً |
| ACC-179 | MEDIUM | قيد استحقاق المسيّر يحمل تاريخ يوم الترحيل مع فترة المسيّر ⇒ مسيّر نوفمبر/ديسمبر المرحَّل في أكتوبر يُرفض `FISCAL_PERIOD_DATE_MISMATCH` (أو يقع خارج فترته) | `hrm.service.ts::postRun` (`clampToPeriodInTx`): التاريخ يُحصر داخل [بداية فترة المسيّر، نهايتها] | M03a |
| ACC-181 | LOW | صوت الزائر المجهول على مقالات المساعدة العامة كان **يُدقَّق** مع عنوان IP ووسيط المتصفح خلافاً لقاعدة P-M9 (طيّ المسار في `describeRoute` أسقط الاستثناء) | `audit.interceptor.ts::isAnonymousPost()` يطابق شكلَي المسار | `public-help.spec.ts` 10/10 (`02ea39f`) |
| ACC-180 | HIGH | تحصيل بطاقة/رابط دفع على فاتورة **عميل نقدي (بلا طرف)** عاد `settled:true` بينما `paid_total=0` (حلقة التخصيص تتخطّى الفاتورة بلا طرف لأن `payment_allocations.party_id NOT NULL`) | `treasury.service.ts` يحدّث `paid_total/payment_status` ويُسقط صف `payment_allocations` فقط عند غياب الطرف؛ `payments.service.ts::receipt()` و`payment-links.service.ts` يمرّران التخصيص كلما وُجد `invoiceId` | `payment-gateways.spec.ts` `:312` (FIXED-UNIT-ONLY) |
| ACC-182 | HIGH | «تقرير الرواتب» `salary-statement` يردّ 500 على كل استدعاء منذ إصلاح UI-029 (`UNION types date and text`) | `report-catalog.ts`: توحيد نوع `pay_date` + سند كل موظف + مفاتيح المكوّنات `basic/housing/transport` + استبعاد المسيّرات المعكوسة/المسودات | probe5 V01–V10d؛ `report-treasury-hrm.spec.ts` 9/9؛ `r33-payroll-individual-payments.spec.ts` |
| ACC-183 | HIGH | إذن راتب فردي يعلّم **كل** أسطر مسيّرات الموظف `paid` (معكوسة/مسودة/أشهر أخرى) → مسيّر ملغى يظهر كرواتب مصروفة ومسيّر لاحق يتخطّى الموظف | التحديث مقيّد بمسيّر حيّ للشهر نفسه؛ **ترحيل 0143** يصلح الأسطر المقلوبة بسجل قابل للعكس | probe5 W01/W05؛ الاختبار الجديد «ACC-183» |
| ACC-184 | MEDIUM | موظف التحق بعد صرف مسيّر الشهر لا يمكن صرف راتبه (409 على مسيّر لم يكن فيه) | فحص المسيّر المدفوع يربط سطر الموظف | probe5 W03/W04/W06 |
| ACC-185 | **CRITICAL** | عكس مسيّر يُبطل ويحذف ناعماً كل الأذون الفردية للشهر ولو غير مرتبطة به — نقد خرج من الصندوق يختفي من الدفاتر | نطاق العكس = `run_id` فقط (قرار P-M10 §4.13) | probe5 W08c/W08d/W08e (RUN 26 قبل: الإذن `voided`+محذوف؛ RUN 27+ بعد: قائم) |

## 3. تغييرات الأستاذ/المخزون العامة (حُرّاس جديدة — تؤثر على كل الوحدات)

- **`ACCOUNT_NOT_POSTABLE` (422):** `postJournalInTx` يرفض أي سطر على حساب `is_postable=false`. أثره الجانبي المقصود: كل كود/اختبار كان يختار «أول حساب بالاسم» على رأس تجميعي صار يُرفض — عُولجت المواضع المكتشفة (ACC-170، ACC-177، 6 ملفات اختبار). **قد يكشف مواضع أخرى في الإنتاج** — انظر §7.
- **`MANUAL_JOURNAL_ON_TREASURY_ACCOUNT` (422):** القيد اليدوي ممنوع على حسابات رقابة الخزينة (النقد/البنك) — الحركة عبر السندات فقط.
- **`VAN_WAREHOUSE_UNDER_SETTLEMENT` (409):** أي حركة على سيارة `pending_stock_settlement` مرفوضة حتى يُرحَّل/يُلغى مستند الجرد — يضمن أن مستند الجرد يقيس الرصيد نفسه الذي أُنشئ عليه.

## 4. قرارات السياسة المتخذة بالتفويض (قابلة للعكس — كل بند مع موضع العكس)

| # | القرار | البديل المرفوض | موضع العكس |
|---|---|---|---|
| 4.1 | **ACC-165:** بيع بطاقة حقيقي بلا فاتورة مرحَّلة يُرفض 422 قبل الاتصال؛ المحاكاة بلا فاتورة تُسجَّل `settled:false` بلا أي أثر مالي | «تحصيل تحت التسوية» على حساب وسيط | `payments.service.ts` حارس `PAYMENT_INVOICE_REQUIRED` (~س269) |
| 4.2 | **ACC-168:** مستند الجرد هو الحركة الوحيدة لعجز العهدة؛ **لا شطب عند الاعتماد**؛ المخزون يبقى حتى «استكمال تسوية المخزون» (مع تجميد السيارة) | شطب فوري عند الاعتماد مع قيد ملازم (كان في `039a789` وأُلغي في `c459870` لأنه يزدوج مع مستند الجرد) | `van-sales.service.ts::approveClosing` (تعليق ACC-168 ~س5914) |
| 4.3 | **ACC-085/166:** عند تحميل العجز على موظف **بلا حساب في الدليل** يُنشأ حسابه القياسي تحت «2241» تلقائياً (نفس ما يفعله HRM) ويُرحَّل القيد عليه؛ مندوب بلا بطاقة موظف يُرفض | 422 `VAN_SHORTAGE_EMPLOYEE_ACCOUNT_REQUIRED` (تصميم فرع الإصلاح واختباره القديم) | `van-sales.service.ts` كتلة «ACC-085» (~س5990)؛ اختبار `van-sales-stock-acceptance.spec.ts` الخطوة 7 |
| 4.4 | **ACC-152:** ملف فرع `van_shortage_charge` بلا حساب دائن ⇒ الدائن يسقط على `inventoryAdjustmentAccountId` من ملف `stock_voucher` (الحساب نفسه الذي يُحمَّل عليه فقد مستند الجرد) | 422 `VAN_SHORTAGE_ACCOUNTS_INCOMPLETE` كلما غاب المفتاح المخصص | `van-sales.service.ts` تعبير `chargeCreditAccountId` |
| 4.5 | **ACC-084:** تقييم عجز العهدة **بالتكلفة** افتراضياً (أمر التحميل يحمل تكلفة دفعته)، وبسعر البيع فقط إذا قالت سياسة المستأجر `selling_price`؛ تحميل العجز على المندوب يتطلب سياسة مهيأة (422 `VAN_SHORTAGE_POLICY_UNCONFIGURED`) | 5 × 6.50 (سعر البيع) كما في الاختبار القديم | `resolveShortageUnitPriceInTx` |
| 4.6 | **ACC-156/154:** مرتجع فاتورة نقدية = ردّ نقدي شامل الضريبة من موقع النقد | إشعار دائن على الرقابي | `van-sales.service.ts` مسار المرتجع |
| 4.7 | **ACC-120:** بضاعة آخر المدة خارج قائمة الدخل افتراضياً في أستاذ دائم الجرد | عرضها دائماً | `accounting.service.ts` معامل `with_stock` |
| 4.8 | **ACC-032:** سداد فاتورة الشراء = سند صرف مرحَّل؛ بلا موقع نقد صريح يُستعمل افتراضي الفرع (`safe` ثم `bank`) وإلا 422 | قيد مباشر بلا سند | `purchases.service.ts` |
| 4.9 | **ACC-035/044/045:** قواعد المطابقة البنكية (§1) | مطابقة بالمبلغ وحده | `bank-feeds.service.ts` |
| 4.10 | **ACC-175:** إقفال العجز يُفرغ 1270003 بالضبط بـ(Σمرسَل − Σمستلَم) | ترك الباقي على «بالطريق» | `inventory.service.ts` إقفال المناقلة |
| 4.11 | **ACC-176:** ذمم لوحة المندوبين = المبيعات الآجلة − المرتجعات الآجلة | طرح كل المرتجعات | `van-sales.service.ts` لوحة القيادة |
| 4.12 | **ACC-157:** اللوحة تستثني `rejected/cancelled/canceled/draft` | عدّ كل الأوامر | `van-sales.service.ts` لوحة القيادة |
| 4.13 | **ACC-185 (P-M10):** عكس مسيّر الرواتب يُبطل سنداته والأذون المرتبطة به بـ`run_id` فقط؛ الإذن الفردي المستقل مستند نقدي قائم يُلغى عمداً عبر مساره | إبطال كل أذون الشهر (سلوك إصلاح ACC-047 المدمج) | `hrm.service.ts reverseRun` شرط `linkedSalaryPayments` |

## 5. اختبارات عُدِّلت توقعاتها (لا كودها فقط) — ولماذا

كل تعديل أدناه **يُطابق سياسة مدمجة بقرار المستخدم (`83b9c4b`) أو قرار §4**؛ لم يُخفَّض أي توقع مالي لإخفاء فرق.

| الملف | التغيير | السبب |
|---|---|---|
| `van-sales-stock-acceptance.spec.ts` | الخطوة 7: 201 + حساب 2241nnnn تلقائي بدل 422؛ الخطوتان 8–9: الدائن يسقط على 3121004 بدل 422 | §4.3، §4.4 |
| `van-sales-stock-settlement.spec.ts` | مسودة الجرد تحمل `expected_qty=1`/`variance=-0.5` منذ إنشائها (المحرك المدمج يحسبها عند الإنشاء) و`countDocumentVarianceValue=2.00` | سلوك `createAdjustment` المدمج |
| `van-sales.spec.ts` | قيمة العجز 19 (5 × 3.80 بالتكلفة) بدل 32.5؛ ضبط `PUT /van-sales/policy {shortageValuationBasis:'unit_cost'}` قبل التحميل | §4.5 |
| `payment-gateways.spec.ts` | «dials it for real» يؤكد 422 بلا فاتورة ثم يبيع على فاتورة مرحَّلة | §4.1 |
| `income-statement.spec.ts` | `with_stock=1` صريح + لا سطر افتراضياً | §4.7 |
| `remediation-phase3/4/6/8`, `migration-0125`, `purchase-posting`, `production-and-returns` | اختيار حسابات `isPostable` فقط؛ رسائل فشل مفصّلة | حارس `ACCOUNT_NOT_POSTABLE` (§3) |
| `van-sales-returns-in-reports.spec.ts` | صف المرتجع `total` إجمالي بالضريبة | ACC-153/154 |
| `payroll-calculator.spec.ts`, `bank-reconciliation.spec.ts` | تقريب لمنزلتين (J8)؛ حالات القرينة/التعادل الجديدة | J8، ACC-035 |

## 6. التشغيل الكامل لاختبارات `apps/api`

- الأساس `0a9dc57`: 46 فشلاً. R33 عند `0794a72`: 68 (22 انحداراً/سياسة — كلها عولجت في `34acfe7`…`c459870`). عند `c761688`: 39 (38 قديماً + ارتعاش ACC-025).
- **فرز الـ38 فشلاً القديم (17 ملفاً) اكتمل** — الجدول الكامل في `CONTINUITY_R33.md` §6: 16 ملفاً كانت اختبارات قديمة تخالف سياسات/حُرّاساً مدمجة وموثقة (ACC-024/058/100/121/127/132/139/149/150/153/170، UI-044) فحُدِّثت توقعاتها مع تعليق يذكر المعرّف ولم يُخفَّف أي حارس؛ ملف واحد كشف **عيباً حقيقياً** (ACC-181) أُصلح كوده.
- **التشغيل الختامي على `02ea39f`:** 534 ملفاً / 2038 اختباراً — **2012 ✓ / 1 ✗ / 25 معلّق** (`evidence/round-33/R33-vitest-full-02ea39f.json`). الفشل الوحيد `src/modules/ai/ai-help.spec.ts` (لقطة التنقل تحمل `?kind=issue` بينما `navigation.ts` صار `?kind=stock_out`) أُصلح في `b307d21` بإعادة توليد اللقطة بسكربت المستودع `scripts/build-ai-navigation-snapshot.mjs` → `src/modules/ai` 11/11.
- **تصحيح:** المعلّقة 25 لم تكن `it.skip` — كانت 3 ملفات محجوبة بفشل `beforeAll` (`treasury-movements` 6، `report-treasury-hrm` 9، `report-inventory` 10): سياسات مدمجة (ACC-023/ACC-132/UI-012/UI-044) + **عيب حقيقي ACC-182**. عُدِّلت الـfixtures وأُصلح الكود (`d4e48ed`) فصارت الثلاثة خضراء (25/25)، وانبثق منها اكتشاف ACC-183/184/185. التشغيل الختامي بعدها: R33_FINAL_VITEST.
- **مسح التقارير (بعد ACC-182):** استدعاء **103 تقارير** الكتالوج كلها حياً بمعاملات الكتالوج (نافذة 2026) وبدون معاملات — **0 × 5xx، 0 × 4xx** (`scripts/round33-report-sweep.cjs`، `evidence/round-33/R33-report-sweep-33.json`؛ عدد الصفوف لكل تقرير مسجَّل). لا تقرير آخر من فئة ACC-182.

## 7. المتبقّي والتقدير الصريح

1. **ما ثبت مفتوحاً ولم يُصلَح:** لا شيء من الـ20 سوى ACC-141 (توثيق — MF-46).
2. **ما لم يُعَد تنفيذه حياً:** ACC-181 فقط (الموقع العام `apps/site` لا يُخدَم في بيئة الفحص؛ الدليل اختبار تكامل على الخادم نفسه). ACC-177/178/180 صارت FIXED-VERIFIED بفاحص Block U (RUN 21/22).
3. **الـ160 معرّفاً غير المُتحقَّق منها في R32 (NOT-RETESTED) — صار منها 7 FIXED-VERIFIED-R33 باختبارات R33 (ACC-058/121/127/132/139/149/150؛ `ROUND_32_VERDICTS.md`) والباقي 153:** لم تُعَد كلها في R33؛ ما مرّت عليه الفاحصات الأربعة (التحصيل، السندات، المشتريات، المناقلات، الرواتب، المخبز، البنوك، البوابة، المقاولات، بوابة البطاقات) + ما غطّته اختبارات vitest المُحدَّثة (الخياطة ACC-149/150، المستخلصات ACC-058، الأرقام التسلسلية ACC-132، الترقيم ACC-100، ميزان المراجعة ACC-139، المناقلات النقدية ACC-127) يُعدّ مُثبَتاً بالاختبار لا بالتنفيذ اليدوي. التقدير لجولة تحقق كاملة: ~3 أيام عمل.
4. **حارس `ACCOUNT_NOT_POSTABLE`:** مسارات الخياطة والمقاولات والأصول مرّت الآن (اختبارات + Block U)؛ لم يظهر رفض جديد في التشغيل الكامل.
5. **واجهات staff/bakery:** لم تُعَد لقطات UI في R33 (الإصلاحات في API؛ الواجهة تقرأ الحقول نفسها). المطلوب جولة UI (R19–R28 كانت NOT-RETESTED منذ R32).
6. **نقص وظيفي مكتشف:** MF-45 (إلغاء مسودة مسيّر)، MF-46 (مسودة القيد اليدوي — ACC-141)، وضريبة التفصيل كإعداد للمستأجر (مرشَّح MF جديد — لم يُضَف تلقائياً احتراماً لقاعدة «اكتشاف ثم اقتراح»).

## 8. إعادة التنفيذ (لمن يراجع)

```bash
# بيئة: DB محلية + ترحيلات 142 + بذرة؛ ثم مستأجر العرض يُعاد تسميته AUDIT-TEST-2026-R24 (وصفة CONTINUITY_R24.md §51)
cd apps/api && pnpm build && node dist/main.js &      # API من dist (لا أثر لتعديل src بلا build)
R33_RUN=NN R32_OUT=$PWD/docs/accounting-audit/evidence/round-33 node docs/accounting-audit/scripts/round33-bootstrap.cjs
R33_RUN=NN ... node docs/accounting-audit/scripts/round33-probe1.cjs   # السطر الختامي: «R33 probe 1: 68/68 PASS»
R33_RUN=NN ... node docs/accounting-audit/scripts/round33-probe2.cjs   # 46/46 (يختار أول شهر حر 2026-11/12)
R33_RUN=NN ... node docs/accounting-audit/scripts/round33-probe3.cjs   # 48/48
R33_RUN=NN ... node docs/accounting-audit/scripts/round33-probe4.cjs   # Block U 22/22 (ACC-178/180/177) — R33_SKIP_U1/U3 لتشغيل جزء
R33_RUN=NN ... node docs/accounting-audit/scripts/round33-probe5.cjs   # Block V/W 47/47 (ACC-182/183/184/185) — يحتاج 2026-12 حراً (يعيده حراً في نهايته)
R33_RUN=NN ... node docs/accounting-audit/scripts/round33-report-sweep.cjs  # كل تقارير الكتالوج (103) بمعاملاتها وبدونها: 0 × 5xx (RUN 33 — `R33-report-sweep-33.json`)
cd apps/api && npx vitest run                                           # 0 فشل و0 معلّق متوقَّع (2042 ✓) — ~25 دقيقة
cd apps/api && npx vitest run test/van-sales-stock-acceptance.spec.ts test/van-sales-stock-settlement.spec.ts test/van-sales.spec.ts test/van-sales-returns-in-reports.spec.ts test/payment-gateways.spec.ts
```
