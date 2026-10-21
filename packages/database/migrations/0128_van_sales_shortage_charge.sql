-- 0128_van_sales_shortage_charge.sql
--
-- 🧾 عجز العهدة المحمَّل على المندوب — من علمٍ مسجَّل إلى دليلٍ مُرحَّل.
--
-- القرار (من مالك المنتج، 2026-10-15): العجز في عهدة المندوب يقع **مديونيةً على الموظف**،
-- ويُقيَّم **بالتكلفة**، وزنادُه **اعتمادٌ صريح لكلّ حالة** — لا افتراض أبداً.
--
-- وما كان قبله: `approveClosing` يحسب
--
--     salaryDeductionApproved = shortageQty > 0 ? body.salaryDeductionApproved === true : false
--
-- ويخزّنه في `van_load_orders.salary_deduction_approved` … ثم لا يستهلكه شيء. فـ«العجز على
-- المندوب» كان قراراً موثّقاً وقيمةً محسوبة (`shortage_value`) **بلا تنفيذٍ مالي**: لا ذمم
-- موظف، ولا قيد، ولا أثر في دفتر الأستاذ. والترحيل 0124 قالها صراحةً إنه مؤجَّل: «who bears
-- the value → NOT here».
--
-- التنفيذ لا يحتاج جدولاً جديداً ولا طرفاً جديداً ولا حساباً مُختلَعاً:
--   • المدين = حساب الموظف نفسه في الدليل (`employees.employee_account_id`، يُنشئه HRM تحت
--     الجذر `2241` «موظفين الفرع الرئيسي») — والاتجاه مطابقٌ لما تكتبه سلفة/خصم في
--     `hrm.service.ts`: «debits the employee's own account … the employee now owes».
--   • الدائن = من ملف الترحيل بنوع المستند `van_shortage_charge` (المفتاح
--     `shortageChargeAccountId`، أو `inventoryAdjustmentAccountId` الذي امتصّ الفقد أولاً).
--   • القيمة = `shortage_qty × resolveShortageUnitPriceInTx(...)` بحسب سياسة المستأجر
--     (`tenant_settings.van_sales.policy.shortageValuationBasis`، والقرار: `unit_cost`).
--
-- الأعمدة الثلاثة دليلٌ لا وصف: القيد نفسه، وبأيّ أساسٍ قُيِّم (فـ«بكم حُوسب» جزءٌ من الدليل)،
-- والمبلغ المُرحَّل كما رُحِّل — لا يُعاد حسابه للعرض فيتغيّر المعروض بعد تغيير السياسة.
--
-- وبلا علمٍ صريح لا يُرحَّل شيء (لا قيود عجز تلقائية)، والاعتماد يُستأنف (`isResume`) فمفتاح
-- عدم التكرار `van-shortage-charge:<load_order_id>` يمنع قيداً ثانياً.

ALTER TABLE van_load_orders
  ADD COLUMN IF NOT EXISTS shortage_journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shortage_charge_basis text,
  ADD COLUMN IF NOT EXISTS shortage_charge_amount numeric(18,4);

COMMENT ON COLUMN van_load_orders.shortage_journal_entry_id IS
  'القيد الذي نفّذ تحميل العجز على المندوب (مدينٌ حسابه) — NULL يعني أنه لم يُرحَّل: إما لم يُعتمد التحميل صراحةً، وإما الاعتماد سابق لهذا الترحيل.';
COMMENT ON COLUMN van_load_orders.shortage_charge_basis IS
  'الأساس الذي قُيِّم به العجز فعلاً: unit_cost | selling_price | explicit | item_price — لا ما تقوله السياسة اليوم بل ما قيل به يوم الاعتماد.';
COMMENT ON COLUMN van_load_orders.shortage_charge_amount IS
  'المبلغ المُرحَّل على ذمّة الموظف كما رُحِّل (لا يُعاد حسابه للعرض).';

CREATE INDEX IF NOT EXISTS van_load_orders_shortage_entry_idx
  ON van_load_orders (tenant_id, shortage_journal_entry_id)
  WHERE shortage_journal_entry_id IS NOT NULL;

-- لا backfill عن قصد: NULL يعني «اعتمادٌ لم يُرحَّل له عجز»، والفرق بين «لم يُعتمد التحميل»
-- و«اعتمادٌ قبل هذا الترحيل» يُقرأ من `salary_deduction_approved` نفسها — فلا يُختلَع تاريخ.
