# خطة RED — r45 / D11 / MF-18: دورة الإقرار الضريبي (`vat_filings`)

> الفرع `arena/0e400dd3-erp-cloud` · الأساس HEAD `08417ee` (D1–D10 مرفوعة) · البيئة أُعيد بناؤها بعد re-clone
> (mig 150/150 · seed 0 · API :3000 · staff :3001 · PG `/tmp/erp-local-pg` cluster `postgresql-ee1be9c0`).
> لا ملفات تخطيط سابقة (plans/ كانت untracked وضاعت) — هذه أول خطة في السلسلة المتبقية: **D11 ثم D12 فقط**.

## 0 — نطاق MF-18 وبطاقته

- البطاقة MISSING_FEATURES L312–327: الإقرار الضريبي **جزئي** — تقريران حيّان (`vat-return`، `vat-return-period`)
  بلا جدول `vat_filings`؛ لا «تقديم» يجمّد الأرقام ويقيّد صافي الضريبة؛ لا قفل للفترة الضريبية.
- **ACs (المعايير الملزمة):**
  1. إقرار مقدَّم لا يتغيّر بمستند لاحق بتاريخ داخله.
  2. وعاء المبيعات = Σ الفواتير المرحَّلة − الإشعارات الدائنة **بالتصنيف الصحيح**.
  3. تطابق مع 2222001 (رصيد الضريبة) لحظة التقديم.
- التغييرات المقرَّرة في البطاقة: DB `vat_filings` (فترة، أرقام مجمَّدة، تاريخ، مرجع، قيد) ·
  API `POST /tax/filings` يجمّد ويقيّد ويقفل الفترة · نسبة الضريبة من الخادم فقط · UI شاشة إقرارات.
- قرار المالك: نعم — أنواع الضريبة لكل سوق (SA 15%، EG، YE بلا VAT عام) · §6.1 حُسم SA+YE
  («يُفكّ تجميد MF-18 — دورة vat_filings»).
- **العيوب المرجَّعة في البطاقة كلها FIXED-VERIFIED-R33** (ACC-108 · ACC-109 · ACC-114 · ACC-119 ·
  ACC-027·ACC-150 · UI-017؛ ACC-149 مُصلَح جزئياً 15% ثابتة → MF-47 خارج السلسلة) ⇒ لا جديد في DEFECTS؛
  D11 يعيد تحققها حيّاً ضمن الحزمة لا يفتحها.
- **خارج النطاق (يُسجَّل ويُسلَّم):** `tax_codes` بمستوى الصنف/الطرف/السطر (تصنيف حدَثي دقيق) —
  التصنيف المطلوب في AC2 يغطّيه التصنيف الحالي المُتحقَّق R33 (خاضع/صفرية/معفى بمبلغ الضريبة)؛
  لا رجوع/تعديل إقرار (تصحيحات الفترة التالية توثيقاً)؛ MF-47 (نسبة تفصيل) وMF-19/20 خارج D11.

## 1 — الآليات المُستكشفة (R1–R7) والقرارات الملزمة

| # | المعلومة/القرار | الدليل |
|---|---|---|
| 1 | مصدر الأرقام = **`ReportingService.run(tenant,'vat-return-period',{from,to})` نفسه** — لا باني ثانٍ (AC2 بمصدر واحد) | `reporting.service.ts` L176 · catalog L5015 (13 بنداً + grandTotal `s_net_vat` = صافي المخرجات − المدخلات) |
| 2 | **الصافي** = grandTotal `s_net_vat` من الـrun (يعادل سطر 13 من النموذج) | catalog L5085–5111 |
| 3 | **القيد**: `postJournalInTx` (نفس مسار D10) · isVat=**false** افتراضياً — حركة تسوية **ليست** حدث ضريبي (لا تُحتسب في إقرارات لاحقة) · idempotency `vat-filing:<tenant>:<from>:<to>` | `accounting.service` L2292 · hrm L1915 نمط الاستخدام |
| 4 | إشارة التسوية: صافي > 0 (مستحق) → **Dr 2222001 / Cr «ضريبة مستحقة الدفع»** · صافي < 0 (مسترد) → **Cr 2222001 / Dr «ضريبة مستردة»** · صافي = 0 → تجميد وإقفال بلا قيد (`journalEntryId=null`) | البطاقة: «نقل من 2222001 إلى ضريبة مستحقة الدفع» |
| 5 | **الحسابات تُنشأ عند أول تسوية** (create-or-find بكود ثابت: مدين `2222003` تحت `222` ذمم دائنة أخرى — يُحدَّد حسب رمز الأب من COA عند التنفيذ؛ المسترد: أصل تدفقات حالية `11x` — يُقرأ من `desktop-coa.ts` ويُثبَّت في الكود) · **لا تعديل على desktop-coa/seed** (يؤثر على عدّادات بذور) · قبول `payableAccountId`/`refundAccountId` صريحاً في الجسم كبديل | نمط `tx.insert(accounts)` L634 · r44 حارس الحسابات الصريحة |
| 6 | **قفل الفترة = آلة الإغلاق الموجودة نفسها** (dual guards): مسودات `FISCAL_PERIOD_HAS_DRAFT_JOURNALS` 409 · ورديات `PERIOD_CLOSE_BLOCKED` 409 · تُنفَّذ **داخل معاملة التسجيل نفسها** بعد القيد (precheck قبلها) | `accounting.service.closePeriod` L963–993 |
| 7 | حارس AC1 المُطبِّق: مستند لاحق بتاريخ داخل فترة مُقفلة → `FISCAL_PERIOD_CLOSED` 409 (resolvePostingContext) + إغلاق المدة يمنع أي تعديل/إضافة — لا نظام أقفال جديد | L2168 · L1213/L1400 |
| 8 | **حارس إعادة الفتح**: `reopenPeriod` + `reopenYear` يرفضان إذا كان أي `vat_filing` يتداخل مع النطاق → 409 **`VAT_FILING_EXISTS`** (xAC1 عبر reopen) | L995 · L3224 (reopenYear لا يعيد فتح الفترات إلا endPeriod مؤقتاً — يبقى الحراس مطلوبين) |
| 9 | **منع التداخل**: تحقق تداخل تواريخ مع أي إقرار قائم → 409 `VAT_FILING_ALREADY_FILED` + unique(tenant,from,to) في القاعدة (الشهر ضمن ربع مُقفل = مزدوج محظور) | قرار تصميم |
| 10 | الصلاحيات (بلا صلاحيات جديدة): POST `/tax/filings` = `accounting.period.close` · GET list/detail = `accounting.period.view` · المعاينة = `reporting.view` عبر `/reports/vat-return-period` | أنماط `accounting.controller` L85–146 |
| 11 | شاشة: `/accounting/tax-filings` (قائمة + معاينة + زر تقديم) + nav بعد `periods` في المجموعة المحاسبية (permission `accounting.period.view`) + **`node scripts/build-ai-navigation-snapshot.mjs`** لإعادة توليد snapshot (لا عدّاد يدوي) | navigation.ts L129–132 · build script |
| 12 | المدة الضريبية = **تواريخ `from/to`** في API (شهر/ربع تحددهما الشاشة بمعاير `TAX_QUARTER`/`TAX_MONTH` المتوفرة في البارامترات) · لا period_type منفصل | جدول خيارات المعاينة: من/إلى فقط = أبسط وأشمل |
| 13 | الاختبارات = قالب r44: `createTestApp` + `withOwnerClient` (SQL مباشر للأستاذ) + `api()` + `createActor` | `r44-payroll-eosb.spec.ts` L1–75 |
| 14 | ترحيل = SQL خام `0151_vat_filings.sql` (+ down) + schema في `packages/database/src/schema/accounting.ts` (بجوار fiscalPeriods) + export كما 0150/hrm | D10 نمط 0150 |

## 2 — جدول `vat_filings`

`id uuid pk · tenant_id uuid not null · period_from date · period_to date ·
snapshot jsonb (rows/columns/grandTotal/params/report_key) · net_vat numeric(18,4) ·
output_vat numeric(18,4) · input_vat numeric(18,4) · journal_entry_id uuid null → journal_entries ·
settlement_account_id uuid null → accounts · filed_at timestamptz · filed_by uuid null ·
created_at/updated_at` + `UNIQUE (tenant_id, period_from, period_to)` + index (tenant_id).
(المستقبل: unique على التداخل غير ممكن في index عام — التداخل يُمنع app-level رقم 9.)

## 3 — خوارزمية `POST /tax/filings`

1. تحقق `from<=to` وإلا 422 · تداخل مع إقرار قائم → 409 `VAT_FILING_ALREADY_FILED`.
2. **قبل** المعاملة: `run('vat-return-period',{from,to})` → rows + grandTotal (لحظة التقديم) + صافي = Number(grandTotal.s_net_vat) + output/input من مجاميع الأسطر الموجبة/السالبة (تُخزَّن في snapshot).
3. فترات تغطي [from,to]: `SELECT periods WHERE start<=to AND end>=from` → فارغة 422 `VAT_FILING_NO_FISCAL_PERIOD`.
4. precheck لكل فترة مفتوحة: مسودات + ورديات (نفس أكواد closePeriod) — تفشل → 409 قبل أي كتابة.
5. **معاملة واحدة**: (أ) حساب التسوية create-or-find إذا |صافي| ≥ 0.005 · (ب) قيد التسوية `postJournalInTx` (تاريخ = `period_to`، وصف يذكر الفئة، idempotency رقم 3) · (ج) INSERT الفiling (snapshot مجمَّد + net + journal id + filed_by) · (د) إغلاق كل فترة مغطاة مفتوحة (UPDATE = نسخ closePeriod داخل tx بعد إزالة الاستدعاء المتعاكس).
6. استجابة: `{ id, periodFrom, periodTo, netVat, journalEntryId, closedPeriodIds, rows }`.

أكواد: `VAT_FILING_ALREADY_FILED`409 · `VAT_FILING_NO_FISCAL_PERIOD`422 · `VAT_FILING_DATE_INVALID`422 · `VAT_FILING_ACCOUNT_REQUIRED`422 (إذا صُرّح بحساب غير موجود) · اندفاع `PERIOD_CLOSE_BLOCKED`/`FISCAL_PERIOD_HAS_DRAFT_JOURNALS`/`FISCAL_PERIOD_CLOSED`.

## 4 — RED: مواطن الفشل المتوقعة قبل التنفيذ (تُلتقط ثم تُحوَّل GREEN)

| # | Assertion RED | السبب |
|---|---|---|
| R1 | `POST /api/v1/tax/filings` → 404 | المسار غير موجود |
| R2 | `GET /api/v1/tax/filings` → 404 | ” |
| R3 | لا صف في `vat_filings` بعد «تقديم» | الجدول غير موجود |
| R4 | AC1: مستند لاحق بتاريخ داخل الفترة يُنشر (لا 409) | لا إقفال |
| R5 | AC3: رصيد 2222001 يبقى كما هو بلا تسوية | لا قيد |
| R6 | تداخل شهر+ربع → يُقبل (لا 409) | لا حارس |
| R7 | reopen فترة مُقفلة بإقرار → 200 | لا `VAT_FILING_EXISTS` |
| R8 | شاشة `/accounting/tax-filings` → 404 staff | صفحة غير موجودة |
| R9 | nav بدون `nav:tax-filings` في snapshot | لم يُولَّد |

## 5 — مواطن GREEN المتوقعة (تتحقق بعد التنفيذ)

- AC1: تقرير إعادة التشغيل بعد التقديم **مطابق حرفاً بحرف** للـsnapshot (deep equal) · مستند داخل الفترة → 409
  `FISCAL_PERIOD_CLOSED` · reopen → 409 `VAT_FILING_EXISTS`.
- AC3: على بذرة نظيفة: 2222001 قبل = صافي الفترة ثم يُصفَّر بالتسوية وذمة = الصافي · إقرار ثانٍ (شهر تالٍ) يبني على صفر.
- AC2: بنود مجمَّدة = تقرير رسمي (خاضع/صفرية-معفى/مردود/إشعار دائن…) بتصنيف R33.
- مزدوج/تداخل → 409 · صفر صافي → بلا قيد · isVat=false مثبت: تقرير الفترة التالية قبل/بعد تقديم سابق **متطابق**.
- 403 لمن بلا `accounting.period.close` · شاشة 200 + محتوى · snapshot يحوي `nav:tax-filings`.

## 6 — سلسلة التنفيذ (الترتيب)

1. **RED**: كتابة `apps/api/test/r45-tax-filings.spec.ts` (المواضيع §4 كاملة) → تشغيله → تجميع الفشل (نصّ للأدلة).
2. Migration `0151_vat_filings.sql` + `_down` + `schema/accounting.ts` (vatFilings + export).
3. `tax-filings.service.ts` (الخوارزمية §3) + `tax-filings.controller.ts` (`@Controller('tax')`) + wiring في `accounting.module` (imports ReportingModule).
4. حراسة `reopenPeriod`/`reopenYear` (`VAT_FILING_EXISTS`).
5. GREEN: تشغيل r45 → تصحيح حتى عُدّة خضراء (كل 9–12 طنّاً).
6. شاشة staff + nav + `build-ai-navigation-snapshot` + build (+ TSC/eslint مستهدف).
7. probes: `scripts/probe-d12-tax-filing.mjs` على verify2026 + evidence (يتطلب `pnpm verify-seed` إن كانت شهادة البيئة غائبة بعد re-clone).
8. تحقق حيّ لعيوب البطاقة المرجَّعة (R33 pointers): تشغيل فحص سريع على تقارير الضريبة (ACC-119/109/114/108 إشاراتها موجودة).
9. **دقة D10**: r44 + audit-* + phase4 + employee-statement (مستهدف) ثم **الحزمة الكاملة** FULL_EXIT=0.
10. توثيق: MISSING (بطاقة MF-18 → موجودة + §5.0 + جدول الوحدات صف 10) · VERIFY card D11 (أرقام) · SCREEN card · logs/d11 · اقتباسات D10 المؤجّلة إن تبقّت (لا — خُتمت).
11. commits: feat ثم docs (نمط `62f74bc`/`08417ee`) + push + تسليم D11 ثم D12 (MF-28) — السلسلة تنتهي بـD12.

## 7 — أخطاء بيئية مُسجلَّة بعد re-clone (لا تتكرر)

- السكربتات تحتاج `corepack enable` (pnpm 9.15.0) · `pnpm build` قبل أي `pnpm db:*` ·
  `db:roles` يطبع «erp_migrator does not exist» دون تعطيل المigrate · `psql` ليس في PATH في هذه البيئة
  (استخدم `withOwnerClient` في الاختبارات أو معرفة bin عند الحاجة) · launcher `scripts/local-start-api.py`
  أُعيد كتابته (dotenv semantics لمفتاح JWT متعدد الأسطر).
