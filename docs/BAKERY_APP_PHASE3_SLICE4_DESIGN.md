# الشريحة 4 — تنفيذ قرار العجز على المندوب، ثم شاشة إقفال العهدة (تصميمٌ وسجلّ قرار)

**التاريخ:** 2026-10-15 · **الفرع:** `arena/3e37b812-erp-cloud` · **قبلها:** `1e109f7`

هذا ملفّ تصميمٍ وسجلّ قرار، لا تقرير إنجاز. كُتب قبل لمس محرّك المحاسبة لأنّ الشريحة تُرحِّل
قيوداً حقيقية على ذمم موظفين.

---

## 1. قرار المالك (مثبَّتٌ هنا كما قيل)

> «أعتقد تقع على المندوب، أو بقرار اعتمادٍ لكلّ حالة.»

ثم اختار صراحةً:

| المحور | القرار |
| --- | --- |
| وعاء التنفيذ | **مديونية موظف** (لا خصمٌ من الراتب، ولا مسودة قيدٍ يختار المحاسب وعاءها) |
| أساس التقييم | **التكلفة** (`unit_cost`) — لا سعر البيع |
| الزناد | **اعتمادٌ صريح لكلّ حالة** — لا افتراض أبداً |
| الشريحة القادمة | **شاشة إقفال العهدة** |

---

## 2. ما قِيس في الكود قبل التصميم (لا تخمين)

1. **القرار موجودٌ في الخادم كعلمٍ بلا تنفيذ.** `approveClosing` يحسب
   `salaryDeductionApproved = shortageQty.gt(0) ? body.salaryDeductionApproved === true : false`
   (والتعليق في المصدر: «Never assume salary deduction is approved unless explicitly passed as
   true»)، ويخزّنه في `van_load_orders.salary_deduction_approved`. **ولا يستهلكه شيء**: بحثٌ في
   `apps/api/src` و`packages/database/src` يُظهر مستهلكيه = التخزين والإسقاط في اللوحة فقط. فلا
   خصم راتب، ولا ذمم، ولا قيد.
2. **لكلّ موظف حسابٌ في شجرة الحسابات أصلاً.** `employees.employee_account_id → accounts.id`
   (‏`packages/database/src/schema/hrm.ts:31`)، وHRM ينشئه تحت الجذر `2241` «موظفين الفرع
   الرئيسي» برقمٍ تالٍ حرّ (`employeeAccountRoot` / `nextEmployeeAccountCode` في
   `hrm.service.ts:586-606`)، والجذر قابل للتجاوز بالإعداد `hrm.employee_account_code`.
   ⇒ **وعاء «مديونية موظف» مفهومٌ قائم، فلا جدول جديد ولا طرف جديد ولا حساب مُختلَع.**
3. **السياسة تُقرأ ولا تُكتب.** `loadTenantPolicyInTx` تقرأ `tenant_settings` بالمفتاح
   `van_sales.policy`، و**لا `INSERT`/`UPDATE` لهذا الجدول في `apps/api/src` كله** ⇒ لا نقطة
   في المنتج تضبط `shortageValuationBasis` اليوم؛ فهي `unconfigured` في demo وكلّ إقفالٍ يقف عند
   `shortage_policy_status = 'pending_policy_approval'`. **ثغرةٌ يجب سدّها في هذه الشريحة**، وإلا
   فقرار المالك (التكلفة) لا يُضبط إلا بـSQL يدوي.
4. **ترتيب تسعير العجز قائم** (`resolveShortageUnitPriceInTx`): `policy.shortageUnitPrice`
   الصريح ← `unit_cost` إن كان الأساس التكلفة ← متوسط سعر البيع في مستندات الأمر ← سعر الصنف.
   فقرار «التكلفة» = ضبط `shortageValuationBasis: 'unit_cost'`، لا كود تسعير جديد.
5. **`shortage_policy_status` نصٌّ حرّ بلا قيد CHECK** (`0122_van_sales_core_integration_and_idemp
   itency.sql:31`) ⇒ إضافة قيمةٍ مثل `charged_to_employee` لا تحتاج ترحيل قيد.
6. **الترحيل 0124 يقول صراحةً إنّ القرار مؤجَّل**: «who bears the value → NOT here:
   `shortage_policy_status` stays …» — وهذه الشريحة تُنفّذ ما أُجِّل، بقرار المالك لا باجتهادي.
7. **الصلاحيات القائمة تكفي**: `van_sales.closing.submit` · `van_sales.closing.approve` ·
   `van_sales.override.approve` · `van_sales.load.manage` · `van_sales.view` (سجلّ العقود). فلا
   رمزَ صلاحيةٍ جديد إلا إن احتاجت نقطة الإعداد رمزاً — والأقرب `van_sales.override.approve`.
8. **نمط ربط الحسابات قائم** (`branch_posting_profiles` بمفاتيح `mapping` لكلّ `doc_type`) وهو
   نفسه الذي استعملته حسابات الإنتاج (قرار أ): فكلا الطرفين إمّا مضبوطٌ وإمّا رفضٌ صريح، ولا
   قيد بنصف mapping.

---

## 3. التصميم

### 3.1 نقطة إعداد السياسة (سدّ الثغرة 3)

```
PUT /van-sales/policy            @RequiresPermission('van_sales.override.approve')
  body: { shortageValuationBasis?: 'unconfigured'|'unit_cost'|'selling_price',
          shortageUnitPrice?: string,
          preventSelfApproval?: boolean }
  ⇒ يكتب tenant_settings['van_sales.policy'] (دمجٌ لا استبدال) + صفّ تدقيق
GET /van-sales/policy            @RequiresPermission('van_sales.view')
```

- **`allowInternalDeliveryWithoutTax` خارج هذه النقطة عمداً**: تلك سياسةٌ ضريبية (قرارٌ معلّق في
  §10 من تقرير الشريحة 1) ولا تُفتح ضمن شريحة عجز؛ والنقطة ترفضها صراحةً إن مُرّرت.
- القيم تُتحقَّق قبل الكتابة (أساسٌ مجهول ⇒ 422 بنصٍّ يسمّي المسموح).

### 3.2 ترحيل `0128_van_sales_shortage_charge.sql` (+ `down/`)

على `van_load_orders` (أعمدةٌ جديدة فقط، بلا جداول):

- `shortage_journal_entry_id uuid NULL → journal_entries.id` — القيد الذي نفّذ القرار.
- `shortage_charge_basis text NULL` — الأساس الذي قُيِّم به فعلاً (`unit_cost`/`selling_price`/
  `explicit`/`item_price`)، لأنّ «بكم حُوسب» جزءٌ من الدليل لا من الوصف.
- `shortage_charge_amount numeric(18,4) NULL` — المبلغ المُرحَّل (لا يُعاد حسابه للعرض).

بلا تعديلٍ في ترحيلٍ تاريخي (ممنوع)، وبلا جدول جديد (المفاهيم قائمة).

### 3.3 الترحيل المحاسبي عند الاعتماد

في `approveClosing`، بعد حساب العجز و**فقط** حين `salaryDeductionApproved === true` و`shortageQty > 0`:

1. **المدين:** `employees.employee_account_id` لموظف المندوب. فإن لم يكن للمندوب موظف، أو للموظف
   حساب ⇒ **رفض 422** يسمّي الناقص («المندوب X بلا موظف مرتبط / بلا حساب في شجرة الحسابات — لا
   تُرحَّل مديونية على حسابٍ غير موجود»). ولا يُنشأ حسابٌ ضمن العملية: إنشاء حساب الموظف من
   بطاقة الموظف في HRM.
2. **الدائن:** من `branch_posting_profiles` بنوع مستندٍ جديد `van_shortage_charge` ومفتاح
   `shortageExpenseAccountId` (أو `inventoryAccountId` إن اختارت المنشأة تحميله على المخزون).
   **ناقصٌ أو غير مضبوط ⇒ رفض 422** (`SHORTAGE_ACCOUNTS_INCOMPLETE`) — كسلوك حسابات الإنتاج
   تماماً: لا قيد بنصف mapping، ولا حساب مُختلَع، والاعتماد **لا يمرّ** (فقرار المعتمِد ماليّ ولا
   يُتجاهل بصمت).
3. **القيمة:** `shortageQty × resolveShortageUnitPriceInTx(...)` بحسب السياسة (القرار: التكلفة).
4. **القيد:** متوازن، `source_type='van_shortage_charge'`، `source_id=loadOrderId`، ومفتاح عدم
   التكرار `van_shortage_charge-journal:<loadOrderId>` — **فالاعتماد يُستأنف** (`isResume`) ولا يجوز
   أن يُرحَّل مرتين.
5. **الأثر على الصفّ:** `shortage_journal_entry_id` + `shortage_charge_amount` +
   `shortage_charge_basis`، و`shortage_policy_status = 'charged_to_employee'`.
6. **بلا علمٍ صريح ⇒ لا قيد إطلاقاً**: يبقى العجز موثّقاً بقيمةٍ محسوبة وحالة
   `pending_policy_approval`/`policy_configured`، وهذا مقصود (لا قيود عجز تلقائية).

### 3.4 شاشة إقفال العهدة (`/custody` في `apps/bakery`)

- النقاط: `submit-closing` · `approve-closing` · `settle-stock` · `close-transit-difference`
  (الوحدة المعلَنة في `lib/navigation.ts`)، بصلاحياتها القائمة.
- **فصل العجز رباعيّ الاتجاه** معروضٌ كأرقام الخادم لا كتلخيصٍ محلي: مبيع/بونص/مرتجع/تالف
  والمتوقع مقابل الفعلي وفرق الجرد (`countVarianceQty`) وقيمته.
- **قرار الاعتماد لكلّ حالة** يُعرض قبل النقر بمبلغه وأثره: «سيُرحَّل X ريال على حساب الموظف
  (رقم الحساب) — الأساس: التكلفة»؛ وبلا اختيارٍ صريح لا يُرسل العلم.
- **لا إقفال بفرق مخزونٍ غير مسوّى**: إن كان `awaitingStockSettlement` أو
  `awaitingTransitDecision` فالشاشة تقول إنّ الخطوة في `settle-stock`/`close-transit-difference`
  وتعرض الرفض الحيّ (قِيس في §3.3 من تقرير الشريحة 3 أنّ الاستلام الناقص يُبقي الفرق في الطريق).
- العقد المشترك في `packages/web-van/src/custody.ts` (نصوص رفض الخادم حرفاً + بوّابات الإجراء
  مرآةً لحالات الصفّ)، وglue في `apps/bakery/lib/custody-screen.ts`، وقياسٌ لكلٍّ منهما.

---

## 4. الاختبارات المخطَّطة (قبل الكتابة)

`apps/api/test/van-sales-shortage-charge.spec.ts` (مستأجرٌ مُهيّأ فعلياً، بلا mocks):

1. اعتمادٌ بعلمٍ صريح وحسابات مضبوطة ⇒ **قيدٌ واحد** متوازن، المدين = حساب الموظف، والمبلغ =
   العجز × التكلفة، و`shortage_charge_basis='unit_cost'`.
2. اعتمادٌ **بلا** علم ⇒ **صفر قيود**، والحالة لا تصير `charged_to_employee`.
3. استئناف الاعتماد/تكراره ⇒ **يبقى قيداً واحداً** (مفتاح عدم التكرار).
4. دائنٌ غير مضبوط في ملف الترحيل ⇒ 422 `SHORTAGE_ACCOUNTS_INCOMPLETE` **والاعتماد لا يمرّ**
   (الحالة قبل الاعتماد كما كانت).
5. مندوبٌ بلا موظف / موظفٌ بلا حساب ⇒ 422 يسمّي الناقص.
6. سياسة `selling_price` ⇒ التقييم بمتوسط سعر البيع (لا التكلفة).
7. `PUT /van-sales/policy` ⇒ يُقرأ من اللوحة، ويرفض أساساً مجهولاً، ويرفض
   `allowInternalDeliveryWithoutTax` (خارج نطاقها)، ويكتب صفّ تدقيق.
8. `shortageQty = 0` مع علمٍ صريح ⇒ لا قيد (لا مديونية بلا عجز).

وقياس الشاشة: عقد `custody.ts` (نصوص وبوّابات) + glue + `navigation.spec.ts` (الحكمان
المقترنان) + `-r typecheck` + `-r lint` + مجموعات API و`staff` كاملة، وإثباتٌ حيّ عبر `:3005`
(إقفال ← اعتماد بمديونية ← قراءة القيد من دفتر الأستاذ).

---

## 5. مخاطرٌ تُقال الآن

- **قيدٌ على ذمم موظف أثرُه نظاميّ لا محاسبيّ فقط**: لذا الزناد اعتمادٌ صريح لكلّ حالة، والقيمة
  بالتكلفة (الأهدأ)، والحساب حسابُ الموظف القائم لا حسابٌ مُختلَع، والمبلغ والحساب والأساس تُعرض
  **قبل** النقر. وأيُّ سقفٍ نظامي للخصم (أو ضرورة موافقة الموظف) قرارُ منشأةٍ لا يُفرض هنا —
  والمديونية ليست خصماً من الراتب، بل دينٌ يُحصَّل أو يُسقَط بقرار.
- **الترحيل الجديد عمودٌ لا جدول**: يُطبَّق ويُلفَّ (`db:migrate` / `db:migrate:down`) على قاعدة
  اختبار قبل أيّ مطالبة بنجاحه.
- **لا مساس بما استقرّ**: العجز يبقى مسجّلاً في `van_stock_movements` كما هو؛ والقيد الجديد طبقةٌ
  فوقه، والحركات التاريخية لا تُعدَّل.
