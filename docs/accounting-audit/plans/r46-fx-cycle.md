# خطة RED — r46 / D12 / MF-28: دورة العملات الكاملة (سعر نافذ · فروق محققة · إعادة تقييم · شاشة)

> تاريخ: 2026-10-25 · الحالة: **منفَّذ — GREEN 7/7** (RED صادق 5/7 في `../logs/r46-red.txt` · رجوع شامل **265/265 · 2129/2129** · probe-d13 **13/13** · توثيق §5.12) · الاستناد: بطاقة MF-28 · ACC-072/073/089 · قرارات §6.1 (SA + YE ⇐ متعدّد العملات مُفعَّل) و§4 صف16.

## P1 — النطاق

**داخل D12 (IN):**
1. **AC1 فرق محقق** — فاتورة USD 100 بسعر 3.75 ⇐ تحصيل بسعر 3.76 ⇐ ربح **1.00** في حساب الفروق وAR يصفى بالدولار والريال معاً.
2. **AC2 إعادة تقييم** — تشغيل يُنتج **قيداً + عكسه الآلي** (بيانات غير محققة على أرصدة عملاتية مفتوحة).
3. **AC3 لا سعر حر** — عملة أجنبية بلا سعر جدول نافذ ⇒ **422** (يُغلق ثغرة P-M16 الموثّقة) · ضمن الهامش **±5%** (الهامش القائم) وإلا 422 · عملة غير مفعَّلة ⇒ 422 `CURRENCY_NOT_ACTIVE` (قائم — لا انحدار).
4. **ACC-073/089** — أسطر قيد السند تحمل العملة/المبلغ الأجنبي/السعر · رصيد الموقع النقدي الأجنبي يتحرك **بوحدات عملته** لا بالأساس.
5. **شاشة** `/organization/currencies` (عملات + جدول أسعار + تسجيل سعر) + nav + لقطة 282→283.
6. حساب **4200004 «إيراد فرق العملة»** يُضَف إلى `DESKTOP_DEFAULT_COA` + تأمين وقت التشغيل (نمط `ensureSettlementAccount` D11).

**خارج النطاق (مُصرَّح — «البقيّة المعلَنة»):**
- `parties.currency_code` (عمود تفضيلي — لم يُنشأ؛ الكشف الأجنبي بعمودين يبقى MF-12).
- جانب المشتريات (فرق محقق/AP) — دورة المبيعات وحدها؛ القيد اليدوي متاح.
- تخصيصات سند القبض بفرق صرف (مسار `treasury allocations`) — التحصيل المُقيَّم يمرّ بـ`POST /sales/invoices/:id/payments`.
- دورة تغيير عملة الأساس (base) — `currencies.is_base` كما هي.

## P2 — الترحيل `0152_fx_cycle.sql` (+down)
- `sales_invoices.fx_rate numeric(20,10)` NULL (يُملأ عند الإنشاء/الترحيل للعملة الأجنبية).
- جدول `fx_revaluation_runs`:
  - `id uuid pk` · `tenant_id` · `run_date date` · `journal_entry_id uuid NULL → journal_entries` · `reversal_entry_id uuid NULL → journal_entries` · `status text default 'posted' check in ('posted','reversed')` · `gain_loss numeric(20,4)` · `detail jsonb` (لقطة الأرصدة والأسعار) · `created_by/created_at` · **UNIQUE (tenant_id, run_date)** (تكرار التشغيل لنفس اليوم → 409).
- حصيلة `DESKTOP_DEFAULT_COA`: `4200004 «إيراد فرق العملة»` (parent `42`) type `revenue` normalBalance `credit`.
- **بلا** إدراج حسابات في الترحيل (تأمين وقت التشغيل في الخدمة — نمط D11).

## P3 — الفاتورة (`sales.service`)
- `SalesInvoiceInput.fxRate?` — اختياري.
- عند الإنشاء: `currency ≠ SAR` ⇐ **يُحلَّ من `fx_rates` بتاريخ الفاتورة** (أو المُدخل داخل ±5% وإلا 422 · **بلا سعر ⇒ 422 `FX_RATE_MISSING`**) → يُخزَّن في `sales_invoices.fx_rate` · `SAR` ⇐ `fx_rate = null` والسلوك كما هو حرفياً (لا انحدار).
- قيد الفاتورة (`salesJournalLines` `leg()`): **الأساس = مبلغ المستند × السعر** على الأرجل المالِية (AR · إيراد · ضريبة · صرف نقدي/بنك) · أرجل التكلفة/المخزون **تبقى أساسية** (تكلفتنا بالريال) بلا تقييم · `currencyAmount` = مبلغ المستند · `fxRate` = سعر الفاتورة · `currencyCode` = عملتها.
- القيد الفوري (`posting.journalLines` يدوي) — كما هو (منطق المُلِّئ).
- عند الترحيل يُقرأ `fx_rate` من السجل (الإنشاء يحدّده — لا إعادة حلّ).

## P4 — التحصيل: فرق محقَّق (`addPayment`)
- `PaymentInput.fxRate?` — سعر التحصيل (اختياري): بلاه ⇐ **يُحلَّ من `fx_rates` بتاريخ اليوم** لعملة الفاتورة ⇐ ±5% ⇐ وإلا 422 · **فاتورة بلا سعر جدول ⇐ 422 `FX_RATE_MISSING`** (لا سعر حر — AC3).
- **دلالات `amount` = مبلغ بعملة الفاتورة** (ساردة اليوم: `remaining = netTotal − paidTotal` بعملة المستند ✓ بلا تغيير للمبيعات SAR).
- الحساب (فاتورة أجنبية بسعر `invoiceRate`):
  - `arBase = amount × invoiceRate` (إقفال ذمة بالأساس المحاسبي للفاتورة)
  - `cashBase = amount × collRate` (مدين الصندوق/البنك بالأساس المحاسبي لليوم)
  - `gain = cashBase − arBase` — موجب ⇐ ربح (**Cr 4200004**) · سالب ⇐ خسارة (**Dr 3121003**) عند `|gain| ≥ 0.005` · وإلا بلا سطر.
- أسطر القيد: صرف = `Dr cashBase` (+ `currencyCode=عملة الموقع` · `currencyAmount=amount` إن كانت عملة الموقع = عملة الفاتورة وإلا `null` وحدها بعملة الأساس) · ذمة = `Cr arBase` مع `currencyAmount=amount` و`fxRate=invoiceRate` و`partyId`.
- **SAR (السلوك القائم):** `invoiceRate = collRate = 1` ⇐ الأرقام حرفية كما اليوم (يغطي البوس/الشيكات/البطاقات بلا انحدار).
- رصيد الموقع: `bump(location, locCurrency, delta)` بـ **`delta = amount` إن كانت عملة الموقع = عملة الفاتورة، و`cashBase ÷ سعر الموقع` (حلّ `fx_rates`) غير ذلك** (يُصحّح ACC-073 في مسار المبيعات).
- `paidTotal` يتراكم بعملة الفاتورة (كما هو) ⇐ «AR يُصفَّر بالدولار» = `paidTotal = total = 100 USD` ورصيد GL = 0.

## P5 — السند (treasury — ACC-072/073/089)
- **AC3:** استبدال «الجدول اختياري» — عملة ≠ SAR **تلزَم** سعر جدول نافذ ≤ تاريخ السند ⇐ بلاه **422 `FX_RATE_MISSING`** (يُغلق ثغرة P-M16 «no table rate accepted») · الهامش ±5% بائد كما هو (`FX_RATE_OUT_OF_RANGE`) · `CURRENCY_NOT_ACTIVE` كما هو.
- **ACC-089:** `defaultJournalLines` + `postVoucherInTx` يمرّران إلى `postJournalInTx`: `currencyCode = voucher.currency` (إن ≠ الأساس) · `currencyAmount = foreignAmount` · `fxRate = voucher.fxRate` (والأساسي `amount` يبقى كما هو — `amount` = أساس و`foreignAmount` = وحدات الاجنبي كما في `fxRate = amount ÷ foreign`).
- **ACC-073:** `bumpBalance` في مسار السند: **`delta = foreignAmount` إن كانت عملة الموقع = عملة السند، وإلا الأساس ÷ سعر الموقع** — رصيد الموقع بعملته.

## P6 — إعادة التقييم (`fx-revaluation`)
- مساران محاسبيان: `POST /accounting/fx-revaluation-runs` + `GET /accounting/fx-revaluation-runs` (+ `GET :id` · `POST :id/reverse`).
- **الأذونات:** POST = `accounting.journal.post` · GET = `organization.currency.view` · reverse = `accounting.journal.reverse` (clerk ⇒ 403).
- **الوعاء:** فواتير المبيعات **المفتوحة** (`kind='sale'` + `fx_rate IS NOT NULL` + `paidTotal < total`) مجمَّعة بعملة: `Σ (المتبقي بالعملة × (سعر_اليوم − fx_rate))` عبر `resolveFx` بتاريخ التشغيل · عملة بلا سعر ⇐ تُستبعد مع ملاحظة في `detail`.
- **الحسابات (سياسة موثّقة — فروق محققة وغير محققة تتشاركان الحسابين، والوصف يميّز):**
  - **`1290001` «فرق إعادة تقييم العملات (غير محقّق)»** type `asset`/`debit` parent `12` — يُضاف لـ`DESKTOP_DEFAULT_COA` + تأمين وقت التشغيل.
  - ربح ⇐ **`Dr 1290001 / Cr 4200004`** · خسارة ⇐ **`Dr 3121003 / Cr 1290001`** (وصف السطر: «إعادة تقييم غير محققة — <currency>»).
  - صافي واحد لكل عملة (أو صافي كل العملات في قيد واحد — القرار: **قيد واحد يجمع العملات** بأرجل لكل عملة) · `|صافي| < 0.005` للكل ⇐ **200 بلا قيد** (run `posted` وjournal null — نمط صفر D11).
- **العكس الآلي:** `reverseJournalInTx` في نفس الـtx: تاريخ العكس = **تاريخ التشغيل + 1 يوم** (عبر `openPeriodForDateInTx` — إن كان آخر يوم ⇐ أول يوم للفترة التالية) · سبب «عكس آلي لإعادة تقييم …» · يُحفظ `reversal_entry_id`.
- تكرار نفس اليوم ⇐ **409 `FX_REVALUATION_EXISTS`** (UNIQUE) · عكس يدوي لاحق ⇐ `status='reversed'` عبر `POST :id/reverse` (perm `accounting.journal.reverse`).
- إن كان الصافي 0.00 ⇐ **200 بلا قيد** (run row بحالة `posted` وjournal null — نمط صفر D11).

## P7 — الشاشة والقائمة واللقطة
- `apps/staff/app/organization/currencies/page.tsx`: لوحان — «العملات» (code · أصلية؟ · مفعّلة · إضافة/تفعيل عبر POST/PATCH `/currencies`) + «آخر الأسعار» (من/إلى · السعر · من تاريخ — GET `/fx-rates`) + نموذج «تسجيل سعر» (من · إلى · تاريخ · سعر — POST `/fx-rates`) — أذونات `organization.currency.view` للقراءة و`.manage` للنموذج (زر مقسَّم بـ`can`).
- nav: داخل مجموعة **«الشركة والمستخدمون/التنظيم»** — يُحدَّد موضعه عند التنفيذ بجوار `cash-locations`/`catalog` (perm `organization.currency.view` · endpoint `/currencies`).
- لقطة AI: `build-ai-navigation-snapshot.mjs` ⇒ **283**.

## P8 — الأذونات (لا جديدة)
`organization.currency.view|manage` (قائمة/سعر) · `accounting.journal.post` (تشغيل) · `accounting.journal.reverse` (عكس يدوي) · `sales.invoice.pay` (تحصيل كما هو) · `sales.invoice.create` (فاتورة كما هي).

## P9 — المواضيع (r46-tax-fx.spec.ts — RED صادق أولاً)
1. **AC1**: تفعيل USD + سعران (3.75 بتاريخ الفاتورة · 3.76 بتاريخ التحصيل) + موقع نقد USD + فاتورة USD 100 تُرحَّل ⇐ AR base 375 / foreign 100 / fx_rate 3.75 · تحصيل 100 ⇐ قيد: cash 376 / AR 375 / **ربح 1.00 (4200004)** · `paidTotal=100` (يصفو بالدولار) · GL AR = 0 · TB متوازن.
2. **AC2**: فاتورة مفتوحة ثانية بسعر 3.70 · سعر اليوم 3.80 · تشغيل ⇐ قيد مرحَّل + **عكسه مرحَّل مرتبط** · تكرار نفس اليوم → 409 · صفر بلا قيد.
3. **AC3**: سند USD بلا سعر جدول → **422 FX_RATE_MISSING** · سعر 6% خارج → 422 `FX_RATE_OUT_OF_RANGE` · عملة معطّلة → `CURRENCY_NOT_ACTIVE`.
4. **ACC-089/073**: أسطر قيد السند تحمل `currency_code/currency_amount/fx_rate` · رصيد موقع USD = وحدات USD.
5. **أذونات**: clerk على تشغيل/قائمة إعادة التقييم → 403 · المالك → 200.
6. **انحدار**: فاتورة/دفع SAR بلا سعر (كما اليوم) بلا تغيير في الأرقام.

## P10 — probe-d13 (حيّ على verify2026 بعد reset)
`docs/accounting-audit/scripts/probe-d13-fx-cycle.mjs` — نمط probe-d12 (check/call/sql + PASS/FAIL + evidence → `evidence/verify-seed/probe-d13-fx-cycle.txt`):
L01 دخول · F01 تفعيل USD + سعران عبر API · F02 موقع/حسابات (SQL بيدرجون التأمين) · F03 فاتورة USD مرحَّلة (base/foreign/fx) · F04 تحصيل ⇐ ربح1.00 + صفار دولار + GL · F05 إعادة تقييم ⇐ قيد+عكس+تكرار409 · F06 حراسة السعر (بلا سعر 422 · خارج الهامش 422) · F07 أسطر قيد السند/رصيد الموقع · F08 clerk 403 · S01 شاشة 200 + manifest · N01 `nav:organization:currencies` · T01 TB · **تعويض: `pnpm verify-seed -- --reset` + إعادة إدراج §26–§29**.
