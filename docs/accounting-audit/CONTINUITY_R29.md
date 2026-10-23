# استمرارية الجولة 29 — تطبيق المخابز `apps/bakery` فوق `van-sales` (تنفيذ فعلي)

> **سبب الجولة:** ملاحظة المستخدم بعد R28: «هل فحصت تطبيق المخابز `apps/bakery`؟» — **الجواب: لا**. شاشات المخابز
> الإحدى عشرة مسجَّلة في `SCREEN_REGISTER.md` «غير مفحوص فيR10» ولم تُلمس في R11–R28. هذه الجولة تنفيذية لها، والتقرير
> الموحَّد الختامي يؤجَّل إلى R30.

## 1. ما هو التطبيق (مقاس من الكود لا من الأسماء)

- `apps/bakery` (Next 15، منفذ 3005، `scripts/next-run.mjs bakery dev`) سطح رقيق فوق `apps/api` نفسها: يمرّر `/api/v1/*` إلى
  `API_PROXY_TARGET` (الافتراضي `127.0.0.1:3000`). مفاتيح الجلسة نفسها (`erp.admin.access` …) فآليات R28 للمتصفح تعمل عليه.
- بوابة الترخيص: `enabledApps` من `GET /me` يجب أن تحوي `bakery_distribution` — **مفعَّلة على مستأجرنا من البذرة**
  (`tenant_apps` صف `bakery_distribution is_enabled=true installed_at 2026-10-22 19:08:48` = لحظة `db:seed`؛ `marketplace/apps` يعيد
  `enabled:true requestStatus:approved`). لا حاجة لطلب/قرار منصة؛ يُوثَّق كشرط مسبق موروث من البذرة.
- الحارس الخلفي `@RequiresSectorApp({apps:['van_sales','bakery_distribution'],mode:'observe'})` — يراقب ولا يمنع.
- الشاشات: `/` لوحة، `/production` دفعات الإنتاج، `/distribution` أوامر التحميل + قرار الاستلام، `/rep` مساحة المندوب (استلام/بيع/مرتجع/
  تحصيل/إغلاق وردية، PWA مع طابور)، `/reps` بطاقات المناديب + حساب الدخول، `/sales` مستندات البيع (المحاسب)، `/collection` تحصيل الذمم،
  `/custody` سياسة العجز + اعتماد الإقفال + فرق العبور، `/treasury` و`/accounting` و`/reports` قراءات + روابط تسليم إلى staff.
- API: `apps/api/src/modules/van-sales/van-sales.service.ts` (8513 سطراً). الخلاصات المقاسة من الكود (ستُقاس سلوكياً هنا):
  - **دفعة إنتاج** = `production_orders.create/complete` (مكوّنات تُصرف بمتوسطها، الناتج يدخل بـ`componentCost/outputQty`) + صف
    `factory_production_batches` + حركة `van_stock_movements production_in`. **الفاقد (scrap) حركة مذكّرة فقط** (`van_damage`) بلا أثر
    مخزون/أستاذ، وتكلفته لا تُحمَّل على الناتج (سياسة معلنة في الكود). قيد الأستاذ فقط إذا رُبطت حسابات RM/WIP/FG (غير مربوطة عندنا ⇒ محايد).
  - **أمر تحميل** = مناقلة رسمية `createTransfer + sendTransfer` من المستودع الرئيسي إلى مستودع السيارة (بضاعة تحت التحويل 1270003) ⇒
    `pending_receipt`. **تأكيد الاستلام** يستلم المناقلة؛ **الرفض** يقفلها `return`؛ **فرق العبور** (`close-transit-difference`) يقفل
    الفرق `return|shortage` عبر `inventory.closeTransfer`.
  - **مستند بيع** = فاتورة مبيعات رسمية (`sales.createInTx + postInTx`) من مستودع السيارة، بونص بسطر سعره صفر، نقدي يتطلّب صندوقاً بحساب،
    `zatca_tax` يتطلّب رقماً ضريبياً للمنشأة (موجود `300000000000003`)، `internal_delivery` يتطلّب سياسة `allowInternalDeliveryWithoutTax`
    (غير قابلة للكتابة من `PUT /policy` — `writableKeys` لا تحويها). الخصم مسقوف بـ`max_discount_pct` من سعر العميل (0 إن لا سعر)
    إلا بـ`allowPriceDiscountOverride`. حدّ الائتمان يُحسب من **مستندات التوزيع وحدها** (لا من ذمم الأستاذ).
  - **مرتجع** = فاتورة `sale_return` مرحَّلة **دائماً `credit`** (حتى لو كان الأصل نقدياً) + `returned_qty += x` على أمر التحميل.
  - **تحصيل** = سند قبض `receipt` مرحَّل إذا أُرسل `cashLocationId` **فقط**، + `invoice_payments` + تحديث `paid_total`؛ بلا صندوق يرتفع
    `paid_amount` بلا سند (يُقاس).
  - **إغلاق وردية** `submit-closing`: `expectedRemaining = loaded − (sold + bonus + returnedQty(الجسم) + damaged)`، ويكتب
    `returned_qty = body.returnedQty` (**يستبدل** ما راكمته مرتجعات العملاء)؛ عدّ المركبة كلها `vehicleCountQty` يُقارن برصيد
    السيارة الرسمي: `otherCustody = vanBalance − expectedRemaining` ⇒ مرتجع العميل الراجع إلى السيارة يُعامَل «عهدة أخرى» (يُقاس).
  - **اعتماد الإقفال** `approve-closing`: تالف ⇒ حركة صرف من السيارة + قيد (Dr `inventoryAdjustmentAccountId` / Cr `inventoryAccountId`)؛
    عجز ⇒ ذمّة موظف **فقط** بـ`salaryDeductionApproved:true` ومع بطاقة موظف لها `employee_account_id` وملف ترحيل
    `van_shortage_charge` (يرث `*` ⇒ `inventoryAdjustmentAccountId`)؛ المتبقي يحتاج `remainingAction return_to_main|carry_over`؛
    `settleStockAdjustment:true` يرحّل مستند الجرد الرسمي للسيارة.
- صلاحيات: المندوب المبذور `rep@demo.test` (دور «مندوب توزيع»: `van_sales.{view,invoice.create,collection.create,closing.submit}`،
  نطاق مستودع VAN-1 فقط)؛ المالك يملك كل `van_sales.*` بما فيها `closing.approve` و`override.approve`.

## 2. البيانات المعزولة (تُنشأ في الكتلة A)

| عنصر | قيمة |
|---|---|
| مادة خام | `FL-R29` «دقيق R29» KG، شراء 2.00، ضريبة 15 % |
| منتج | `BR-R29` «خبز R29» KG، بيع 5.00، **تتبّع لوت**، ضريبة 15 % |
| مورد | `SUPP-GEN` مورد عام (موجود) |
| عميل آجل | `CUST-R29` «بقالة R29 (آجل)» حدّ ائتمان 100 |
| عميل نقدي | `CUST-GEN` عميل عام (موجود) |
| مندوب | «مندوب الشركة» `01a16504-1458-7735-9863-86d92c9f8c45` موظف `EMP-REP-1` (بلا حساب أستاذ) مستودع `VAN-1` `01a16504-144a-729a-86bc-9e43bf582a10` دخول `rep@demo.test` |
| صندوق | `01a16504-1391-7135-a3e5-69ca78a2e716` (1211001) |
| دفعة | `BATCH-R29-01` |

## 3. التوقعات المحسوبة مسبقاً (قبل التنفيذ)

خط الأساس = `R28-DB-028` (1211001 50,550.1960؛ 1270001 160.9560؛ 1270003 −0.0002؛ آخر قيد JE-000050).

| # | الخطوة | الأثر المتوقع |
|---|---|---|
| A3 | شراء دقيق 100 كجم × 2 + 15 % (آجل، SUPP-GEN) | PI جديد؛ JE: Dr 1270001 200 / Dr ضريبة مدخلات 30 / Cr ذمم موردين 230؛ FL-R29 MAIN 100 @2 |
| B3 | دفعة 50 كجم خبز من 30 كجم دقيق + فاقد 1 كجم (سبب) | FL −30 (60)؛ BR +50 @1.2000 (60)؛ لوت `BATCH-R29-01`؛ **لا قيد** (محايد: 1270001 يبقى 360.956)؛ `factory_production_batches.unit_cost 1.2`؛ حركتا `production_in` 50 و`van_damage` 1 (مذكّرة؛ لا أثر مخزون) |
| B4 | إعادة الإرسال بنفس `idempotencyKey` | لا دفعة ثانية |
| C2 | VLO-0001: 40 كجم إلى VAN-1 | مناقلة مرسلة: JE Dr 1270003 48 / Cr 1270001 48؛ MAIN BR 10؛ الحالة `pending_receipt` |
| C3/C4 | VLO-0002: 6 كجم؛ VLO-0003: 3 كجم | قيدان 7.2 و3.6؛ MAIN BR 1 |
| C5 | المندوب يؤكد استلام VLO-0001 (40) | JE Dr 1270001 48 / Cr 1270003 48؛ VAN-1 BR 40 @1.2؛ `loaded` |
| C6 | استلام VLO-0002 بـ5 من 6 | فرق عبور 1 كجم (`discrepancy_qty 1`)؛ VAN-1 45؛ 1270003 يحتفظ بـ1.2 |
| C7 | رفض VLO-0003 | الحالة `rejected`؛ المناقلة تُقفل `return` ⇒ MAIN BR 4؛ JE عكسي 3.6؛ 1270003 لهذه المناقلة 0 |
| C8 | قرار فرق العبور VLO-0002 = `shortage` | `inventory.closeTransfer(shortage)` ⇒ JE Dr حساب تسوية المخزون 1.2 / Cr 1270003 1.2 (يُقاس) |
| D1 | بيع نقدي D1: عميل عام 10 كجم × 5 ضريبي نقدي e716 | VTX-00001 + SI مرحَّلة: Dr 1211001 57.50 / Cr 4100001 50 / Cr 2222001 7.50؛ COGS Dr 3200004 12 / Cr 1270001 12؛ VAN-1 30؛ `expected_cash 57.5` |
| D2 | بيع آجل D2: CUST-R29 15 كجم × 5 + بونص 1 (سبب) | VTX-00002 + SI آجلة: Dr ذمم العميل 86.25 / Cr 4100001 75 / Cr 2222001 11.25؛ COGS 16 × 1.2 = 19.2؛ VAN-1 14؛ سطر بونص سعره 0 |
| D3 | بيع آجل 5 كجم آخر لـCUST-R29 (86.25 + 28.75 = 115 > 100) | **422** حدّ الائتمان (حارس متوقع) |
| D4a | من `/sales` (المالك): عميل عام 10 كجم، خصم 5 بلا تجاوز | **422** الخصم فوق السقف (0 %) |
| D4b | نفسه مع «اعتماد تجاوز» | VTX-00003: subtotal 45 + 6.75 = 51.75 نقدي؛ VAN-1 4؛ COGS 12 |
| D5a | سعر عميل مثبّت لـCUST-R29: 4.80، خصم ≤10 %، بونص ≤1 كجم، حدّ 150 | صف `van_sales_customer_prices` + تاريخ |
| D5b | المندوب يبيع CUST-R29 2 كجم آجل بلا سعر | السعر 4.80 ⇒ 9.60 + 1.44 = 11.04؛ VAN-1 2 |
| D6 | بيع نقدي D6 من VLO-0002: عميل عام 2 كجم × 5 | 11.50 نقدي؛ VAN-1 (VLO-0002) 3 |
| D7a | المندوب يحصّل 50 من D2 (صندوق e716) | سند قبض مرحَّل Dr 1211001 50 / Cr ذمم 50؛ `invoice_payments` 50؛ `paid_total 50 partial` |
| D7b | المحاسب يحصّل الباقي 36.25 من `/collection` | مثله؛ الفاتورة `paid` |
| D7c | تحصيل 1.00 إضافي | **409** `INVOICE_ALREADY_PAID` |
| D7d | إعادة D7a بنفس المفتاح | لا سند ثانٍ ولا زيادة |
| D7e | تحصيل 5 من D5b **بلا صندوق** (API) | يُقاس: إن ارتفع `paid_amount` بلا سند ⇒ عيب (نقد خارج الأستاذ) |
| D8 | مرتجع 1 كجم من D6 (نقدي) | VRT-00001 + فاتورة `sale_return` **آجلة**: Dr مردودات 5 / Dr 2222001 0.75 / Cr ذمم العميل العام 5.75 ⇒ ذمّة دائنة لعميل نقدي بلا ردّ نقد (يُقاس كعيب/سياسة)؛ تكلفة المرتجع المتوقعة 1.2 لا 5 (يُقاس) ؛ VAN-1 +1؛ `returned_qty(VLO-0002)=1` |
| E1 | إغلاق VLO-0001 (مندوب): تالف 1 (سبب)، عدّ المركبة = رصيد السيارة − 1 | `expectedRemaining = 40 − (37+1+0+1) = 1`؛ عجز 1 كجم × 1.2 (أساس `unit_cost`) = 1.20؛ `pending_closing` |
| E2 | اعتماد مع تحميل العجز على المندوب | **422** `VAN_SHORTAGE_EMPLOYEE_ACCOUNT_REQUIRED` (لا حساب للموظف) |
| E3 | سلفة HRM 20 نقداً للموظف EMP-REP-1 من e716 | ينشئ حساب الموظف تحت 2241 (`22410002`)؛ JE Dr 22410002 20 / Cr 1211001 20 |
| E4 | الاعتماد مجدداً + `settleStockAdjustment` | قيد تالف Dr تسوية 1.2 / Cr 1270001 1.2؛ مستند جرد السيارة (فارق 1 كجم) مرحَّل Dr تسوية 1.2 / Cr 1270001 1.2؛ قيد تحميل العجز Dr 22410002 1.2 / Cr تسوية 1.2؛ الحالة `settled`/`approved`؛ `shortage_policy_status charged_to_employee` |
| F1 | إغلاق VLO-0002 بعدّ المركبة بعد مرتجع العميل (مرتجع سليم 2، عدّ 2) | **متوقع عيباً:** 422 `VAN_VEHICLE_COUNT_BELOW_OTHER_CUSTODY` لأن مرتجع العميل يُحسب «عهدة أخرى» |
| F2 | الإغلاق بـ`actualRemainingQty 2` بدل عدّ المركبة | `expectedRemaining = 5 − (2+0+2+0) = 1` ⇒ فائض 1 (هو مرتجع العميل) وعجز 0 |
| F3 | الاعتماد بلا إقرار فائض | 422 `VAN_CLOSING_SURPLUS_ACK_REQUIRED`؛ ثم مع الإقرار + `return_to_main` + تسوية ⇒ المرتجع 2 والمتبقي 2 إلى MAIN **بتكلفة 1.2** (يُقاس: كمية بلا قيمة = عيب) |
| G | التقارير | لوحة/تقارير المخابز = مجاميع المستندات؛ TB متوازن؛ P&L يحوي مبيعات 50+75+45+9.6+10 − مردودات 5؛ تكلفة 12+19.2+12+2.4+2.4 − 1.2؛ تقييم المخزون = Σ stock_balances |

## 4. آلية التشغيل

- `docs/accounting-audit/scripts/round29-main.cjs` (نفس آلية R28: `STAGE n` → `READY id` → ملف `.scratch/r29/<id>.approve` → نقر → `DONE`)،
  `round29-snapshot.cjs` (R28 + `factory_production_batches`, `production_orders`, `production_order_components`, `van_sales_customer_prices`,
  `van_sales_customer_price_history`, `notifications`, `tenant_apps`, `marketplace_addon_requests`, `audit_log` الخاص بـ`sector_licence`).
- الإطلاق: `/tmp/r29start.sh` (`PHASE`, `FROM`, `UNTIL`)؛ اللوج `/tmp/r29.log`. المتصفح يلج إلى staff (:3001) أو bakery (:3005) حسب بادئة المسار
  `bakery:`؛ تبديل المستخدم (مالك/مندوب) بتسجيل خروج ودخول في bakery.
- commit + push بعد كل كتلة (A..G). الأدلة في `evidence/round-29/`.

## 5. الحالة

- 2026-10-23: الاستكشاف انتهى؛ bakery يعمل على 3005؛ الترخيص موجود من البذرة؛ الكتل مصمَّمة أعلاه. التنفيذ يبدأ بالكتلة A.
