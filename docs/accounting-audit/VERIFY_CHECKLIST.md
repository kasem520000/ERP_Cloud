# قائمة تحقق واجهات — مستأجر verify2026 (أُنشئت 2026-10-26T01:48:10.225Z)

> وُلِّدت آلياً بواسطة `pnpm verify-seed` (apps/api/scripts/verify-seed.ts).
> القيم أدناه مأخوذة من قاعدة البيانات وردود تقارير API **بعد** توليد الحركات.
> عند إيجاد فرق: سجّل (اسم الشاشة / القيمة المتوقعة / الفعلية / الفرق) وأرسلها.

## فحوصات داخلية (بذرة + قيود): **30/30 PASS**

| الفحص | النتيجة | متوقع | فعلي |
|---|---|---|---|
| ميزان العام (DB): Σمدين = Σدائن | ✅ PASS | مدين = دائن > 0 | 252126.50 / 252126.50 |
| توازن القيود الفردي: 0 قيد مرحّل غير متوازن | ✅ PASS | 0 قيود غير متوازنة | 0 |
| الصندوق: cash_location_balances = GL 1211001 | ✅ PASS | 49890.00 | 49890.00 |
| البنك: cash_location_balances = GL 1221001 | ✅ PASS | 180113.80 | 180113.80 |
| ذمم العملاء: GL 12310001 = مجموع أرصدة العملاء | ✅ PASS | 139.20 | 139.20 |
| ذمم الموردين: GL 22111001 = مجموع أرصدة الموردين | ✅ PASS | 263.50 | 263.50 |
| المخزون: مجموع قيمة الأرصدة = GL 1270001 | ✅ PASS | 335.00 | 335.00 |
| بضاعة بالطريق (1270003) = 0 بعد الاستلام الكامل للمناقلة | ✅ PASS | 0.00 | 0.00 |
| فاتورة س2 الآجلة: مدفوع 100 من 285.20 (جزئي) | ✅ PASS | paid_total=100.00، حالة=partial | paid_total=100.00، حالة=partial |
| تفريع الفواتير: subtotal - discount + tax = total لكل مستند مرحّل | ✅ PASS | لا فواتير مخالفة | ✓ |
| مطابقة الدفاتر الفرعية الشاملة (/reports/subledger-reconciliation): 6/6 أزواج فرقها 0.00 | ✅ PASS | 6 أزواج بفرق 0.00 | 6/6 بفرق 0.00 |
| تقرير ميزان المراجعة API (/reports/trial-balance): مدين = دائن = إجمالي القيود | ✅ PASS | 252126.50 = 252126.50 | 252126.50 / 252126.50 |
| كشف ميزان المراجعة (/statements/trial-balance): مجموع الأرصدة الختامية متوازن | ✅ PASS | ختامي مدين = ختامي دائن | 250753.50 / 250753.50 |
| قائمة الدخل (/reports/profit-loss): صافي الربح = إيرادات الأستاذ − مصروفاته | ✅ PASS | 195.00 | 195.00 |
| الميزانية العمومية (/reports/balance-sheet): الأصول = الخصوم + حقوق الملكية | ✅ PASS | 250478.00 | 250478.00 |
| تقرير أعمار ديون العملاء (/reports/ar-aging): الإجمالي = GL 12310001 | ✅ PASS | 139.20 | 139.20 |
| تقرير أعمار ديون الموردين (/reports/ap-aging): الإجمالي = GL 22111001 | ✅ PASS | 263.50 | 263.50 |
| تقرير أرصدة العملاء (/reports/customer-balances) = GL 12310001 | ✅ PASS | 139.20 | 139.20 |
| تقرير أرصدة الموردين (/reports/supplier-balances) = GL 22111001 | ✅ PASS | 263.50 | 263.50 |
| تقرير تقييم المخزون (/reports/inventory-valuation) = GL 1270001 | ✅ PASS | 335.00 | 335.00 |
| إقرار ضريبة القيمة المضافة (/reports/vat-return): صافي الضريبة = رصيد 2222001 | ✅ PASS | -10.50 | -10.50 |
| مراكز التكلفة (/cost-centers?with_balances=1): رصيد المركز = 30.00 مع نوع فرعي (sub) | ✅ PASS | kind=sub، رصيد=30.00 | kind=sub، رصيد=30.00 |
| مسح شامل لكتالوج التقارير (108 تقريراً): جميعها ترد بلا خطأ 500/404 | ✅ PASS | 108/108 سليمة | 108/108 OK |
| حارس القيد غير المتوازن (Dr 100 ≠ Cr 90) → يُرفض 422 | ✅ PASS | HTTP 4xx | HTTP 422 JOURNAL_NOT_BALANCED |
| حارس القيد اليدوي المباشر على حساب الصندوق الرقابي (1211001) → يُرفض 422 | ✅ PASS | HTTP 4xx | HTTP 422 MANUAL_JOURNAL_ON_TREASURY_ACCOUNT |
| حارس انتماء تاريخ القيد للفترة المحاسبية المرسلة (ACC-070) → يُرفض 409 | ✅ PASS | HTTP 409 FISCAL_PERIOD_DATE_MISMATCH | HTTP 409 FISCAL_PERIOD_DATE_MISMATCH |
| حارس صلاحيات مندوب التوزيع على قائمة مناديب الشركة (/van-sales/salesmen) → 403 | ✅ PASS | HTTP 403 | HTTP 403 VAN_SALES_COMPANY_SCOPE_REQUIRED |
| بوابة العميل (/auth/login + /portal/invoices): حساب البوابة معزول (kind=portal) ويعمل بنجاح | ✅ PASS | HTTP 200 + kind=portal + بوابة محمية | login=200 kind=portal /portal/invoices=200  |
| اسم المستودع الافتراضي للمنشأة = «المستودع الرئيسي» والتوقيت = Asia/Riyadh (مكة المكرمة) | ✅ PASS | المستودع الرئيسي · Asia/Riyadh | المستودع الرئيسي · Asia/Riyadh |
| توافق عقد تطبيقات الأندرويد الحيّ (/cash-locations kind=safe|bank + /notifications meta.unread) | ✅ PASS | HTTP 200 + kind∈{safe,bank} + meta.unread رقمي | cashLocations=200(bank,safe) notifications=200 |

## روابط سريعة

- staff: http://localhost:3001
- بوابة العميل: http://localhost:3004
- المخابز/المندوب: http://localhost:3005/rep
- API: http://127.0.0.1:3000/api/v1

## الشاشات والقيم المتوقعة

### 1. تسجيل الدخول (كل التطبيقات)

`http://localhost:3001`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| رمز الشركة (Tenant) | verify2026 | تظهر حقل «رمز الشركة» في شاشة الدخول |
| المالك | owner@verify2026.test / Mstr-Qz7-2026$Local | يدخل staff |
| المحاسب | accountant@verify2026.test / Acct-Qz7-2026$Local | صلاحيات محاسب |
| أمين الصندوق | cashier@verify2026.test / Cash-Qz7-2026$Local |  |
| المندوب (تطبيق المخابز) | rep@verify2026.test / Van-Qz7-2026$Local | يدخل http://localhost:3005/rep |
| بوابة العميل | portal-customer@verify2026.test / Port-Qz7-2026$Local | يدخل http://localhost:3004 |
| بوابة المورد | portal-supplier@verify2026.test / Supp-Qz7-2026$Local | http://localhost:3004 أو شاشة المورد |

### 2. الشركة والمستخدمون والمندوب

`http://localhost:3001/settings/company`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| اسم المنشأة (عربي) | شركة التحقق التجريبية | أيضاً في /settings/company |
| اسم المنشأة (إنجليزي) | Verify Trading Co. | قيمة عرض إن لم تُضبط — مقصودة |
| الرقم الضريبي | 300000000000003 | قيمة عرض مقصودة في بذرة التحقق |
| البريد | info@demo.test |  |
| /settings/users عدد المستخدمين | 6 | 4 موظفين (مالك/محاسب/صندوق/مندوب) + حسابا البوابات؛ إن لم تُظهر الشاشة حسابات البوابات فالعدد 4 |
| المستخدم accountant@verify2026.test | محاسبة التحقق — Accountant — active |  |
| المستخدم cashier@verify2026.test | أمين صندوق التحقق — Cashier — active |  |
| المستخدم owner@verify2026.test | مالك منشأة التحقق — Owner — active |  |
| المستخدم portal-customer@verify2026.test | بوابة عميل التحقق — Customer portal — active |  |
| المستخدم portal-supplier@verify2026.test | بوابة مورد التحقق — Customer portal — active |  |
| المستخدم rep@verify2026.test | مندوب التحقق — مندوب توزيع — active |  |
| /sales/salesmen المندوب | مندوب التحقق (مستودع VAN-1) |  |
| الموظف EMP-REP-1 | مندوب التحقق — active | /hrm/employees |

### 3. فواتير المبيعات (نقدي/آجل/مرتجع)

`http://localhost:3001/sales/invoices`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| عدد الفواتير | 4 | س1 نقدي، س2 آجل، مرتجع |
| SI-000001 (sale) إجمالي | 115.00 | net 100.00 + VAT 15.00 — الحالة posted |
| SI-000001 المدفوع/الحالة | 115.00 — paid |  |
| SI-000002 (sale) إجمالي | 285.20 | net 248.00 + VAT 37.20 — الحالة posted |
| SI-000002 المدفوع/الحالة | 100.00 — partial |  |
| SI-000003 (sale) إجمالي | 13.80 | net 12.00 + VAT 1.80 — الحالة posted |
| SI-000003 المدفوع/الحالة | 13.80 — paid |  |
| SR-000001 (sale_return) إجمالي | 46.00 | net 40.00 + VAT 6.00 — الحالة posted |
| SR-000001 المدفوع/الحالة | 0.00 — unpaid |  |
| /sales/customers رصيد عميل التحقق الآجل |  | ↓ |
| رصيد عميل «عميل التحقق الآجل» | 139.20 | من قيود 12310001 (مدين = مستحق) |
| /sales/customers رصيد عميل التحقق النقدي | 0.00 | فاتورته مستقرة نقداً |
| /sales/statements عميل التحقق الآجل | فاتورة 285.20 / مرتجع −46.00 / دفعة 100.00 / رصيد 139.20 | اختر العميل الآجل من القائمة |

### 4. المشتريات والموردون

`http://localhost:3001/purchases/invoices`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| PI-000001 إجمالي | 575.00 | net 500.00 + VAT 75.00 — posted |
| PI-000001 المدفوع | 300.00 | سند سداد 300 نقداً |
| PR-000001 إجمالي | 11.50 | net 10.00 + VAT 1.50 — posted |
| PR-000001 المدفوع | 0.00 | سند سداد 300 نقداً |
| /purchases/suppliers رصيد المورد |  | ↓ |
| رصيد مورد «مورد التحقق» | 263.50 | من قيود 22111001 (دائن = مستحق للمورد) |

### 5. المخزون (أصناف/مستويات/حركات/مناقلات)

`http://localhost:3001/inventory/levels`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| VRF-BRK في MAIN | 13 × 5.00 = 65.00 | صنف التحقق بالحبة |
| VRF-FL في MAIN | 22 × 10.00 = 220.00 | دقيق التحقق |
| VRF-FL في VAN-1 | 5 × 10.00 = 50.00 | دقيق التحقق |
| /inventory/items عدد الأصناف | 2 | VRF-FL (10/20) و VRF-BRK (5/12) |
| /inventory/movements عدد حركات المخزون | 10 | مشتريات+مبيعات+مرتجع+مناقلة |
| /inventory/transfers المناقلة | 1 مناقلة MAIN→VAN-1 بكمية 5 — مُرسَلة واستُلمت بالكامل | stock_transfer_lines=1، stock_transfers=1، bin_transfers=0 |
| /reports/inventory-valuation قيمة المخزون (الإجمالي) | 335.00 | يجب أن تعادل رصيد 1270001 أدناه |

### 6. الخزينة (سندات/أرصدة/مناقلات)

`http://localhost:3001/treasury/vouchers`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| رصيد «الحساب البنكي الرئيسي» (bank) | 180113.80 | افتحه أيضاً في /treasury/safes |
| رصيد «الصندوق الرئيسي» (safe) | 49890.00 | افتحه أيضاً في /treasury/safes |
| PV-000001 (payment/supplier) | 300.00 | posted |
| PV-000002 (payment/expense) | 40.00 | posted |
| RV-000001 (receipt/other) | 115.00 — فيها VAT 15.00 | posted |
| عدد السندات المرحّلة | 3 | المسودات أيضاً تظهر بحالة «مسودة» |
| /treasury/transfers المناقلة النقدية | CT-000001 بمبلغ 100.00 (received) | صندوق → بنك 100.00 |
| GL 1211001 (الصندوق) | 49890.00 | يجب = رصيد الصندوق أعلاه |
| GL 1221001 (البنك) | 180113.80 | يجب = رصيد البنك أعلاه |

### 7. المحاسبة (ميزان/قيود/دفتر/مصروفات)

`http://localhost:3001/accounting/trial-balance`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| ميزان: إجمالي مدين | 252126.50 | يجب = إجمالي دائن |
| ميزان: إجمالي دائن | 252126.50 |  |
| عدد القيود المرحّلة | 16 | من JE-000001 إلى JE-000016 — /accounting/journal-entries |
| 1160001 أثاث | مدين 20000.00 / دائن 0.00 → صافي 20000.00 | في /accounting/ledger ابحث بالحساب نفسه |
| 1211001 الصندوق الرئيسي | مدين 50330.00 / دائن 440.00 → صافي 49890.00 | في /accounting/ledger ابحث بالحساب نفسه |
| 1221001 شبكة | مدين 180113.80 / دائن 0.00 → صافي 180113.80 | في /accounting/ledger ابحث بالحساب نفسه |
| 12310001 عميل عام | مدين 285.20 / دائن 146.00 → صافي 139.20 | في /accounting/ledger ابحث بالحساب نفسه |
| 1270001 حساب بضاعة آخر المدة | مدين 570.00 / دائن 235.00 → صافي 335.00 | في /accounting/ledger ابحث بالحساب نفسه |
| 2110001 راس المال المدفوع | مدين 0.00 / دائن 250030.00 → صافي -250030.00 | في /accounting/ledger ابحث بالحساب نفسه |
| 22111001 مورد عام | مدين 311.50 / دائن 575.00 → صافي -263.50 | في /accounting/ledger ابحث بالحساب نفسه |
| 2222001 ضريبة القيمة المضافة | مدين 81.00 / دائن 70.50 → صافي 10.50 | في /accounting/ledger ابحث بالحساب نفسه |
| 3110001 مصاريف بنكية | مدين 70.00 / دائن 0.00 → صافي 70.00 | في /accounting/ledger ابحث بالحساب نفسه |
| 3200004 تكلفة المبيعات | مدين 175.00 / دائن 20.00 → صافي 155.00 | في /accounting/ledger ابحث بالحساب نفسه |
| 4100001 المبيعات | مدين 0.00 / دائن 360.00 → صافي -360.00 | في /accounting/ledger ابحث بالحساب نفسه |
| 4100002 مردودات المبيعات | مدين 40.00 / دائن 0.00 → صافي 40.00 | في /accounting/ledger ابحث بالحساب نفسه |
| 4200001 ايرادات توصيل | مدين 0.00 / دائن 100.00 → صافي -100.00 | في /accounting/ledger ابحث بالحساب نفسه |
| /accounting/expenses (أنواع المصروفات — تعريفات) وسند المصروف | PV-000002 = 40.00 | الشاشة تعريفات لا سندات؛ السند المرحّل نفسه (PV-000002 = 40.00) يُقرأ في /treasury/vouchers?kind=payment وفي /treasury/movements |
| /accounting/income-statement (أو تقرير profit-loss) صافي الربح |  | محسوب من الإيرادات − تكلفة المبيعات − المصروفات + إيرادات أخرى — لا يوجد رقم ثابت هنا عمداً؛ قارن بسطر صافي الربح في التقرير نفسه مقابل هذه القيود |

### 8. تقرير customer-balances

`http://localhost:3001/reports/customer-balances?from=2026-01-01&to=2026-12-31`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| إجماليات التقرير (totals) | debit=285.20، credit=146.00 | افتح الرابط بحساب المالك |
| صف 1 | seq: 1 | account_code: 000002 | party: عميل التحقق الآجل | debit: 285.20 | credit: 146.00 | balance: 139.20 | status: مدين |  |

### 9. تقرير supplier-balances

`http://localhost:3001/reports/supplier-balances?from=2026-01-01&to=2026-12-31`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| إجماليات التقرير (totals) | debit=311.50، credit=575.00، balance=263.50 | افتح الرابط بحساب المالك |
| صف 1 | code: 000001 | party: مورد التحقق | debit: 311.5000 | credit: 575.0000 | balance: 263.5000 |  |

### 10. تقرير trial-balance

`http://localhost:3001/reports/trial-balance?from=2026-01-01&to=2026-12-31`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| إجماليات التقرير (totals) | debit=252126.50، credit=252126.50، balance=0.00 | افتح الرابط بحساب المالك |
| صف 1 | code: 1160001 | account: أثاث | debit: 20000.0000 | credit: 0.0000 | balance: 20000.0000 |  |
| صف 2 | code: 1211001 | account: الصندوق الرئيسي | debit: 50330.0000 | credit: 440.0000 | balance: 49890.0000 |  |
| صف 3 | code: 1211003 | account: نقد تحت التحويل | debit: 100.0000 | credit: 100.0000 | balance: 0.0000 |  |
| صف 4 | code: 1221001 | account: شبكة | debit: 180113.8000 | credit: 0.0000 | balance: 180113.8000 |  |
| صف 5 | code: 12310001 | account: عميل عام | debit: 285.2000 | credit: 146.0000 | balance: 139.2000 |  |
| صف 6 | code: 1270001 | account: حساب بضاعة آخر المدة | debit: 570.0000 | credit: 235.0000 | balance: 335.0000 |  |
| صف 7 | code: 1270003 | account: بضاعة تحت التحويل | debit: 50.0000 | credit: 50.0000 | balance: 0.0000 |  |
| صف 8 | code: 2110001 | account: راس المال المدفوع | debit: 0.0000 | credit: 250030.0000 | balance: -250030.0000 |  |
| … | و7 صفاً آخر في التقرير الكلي |  |

### 11. تقرير vat-return

`http://localhost:3001/reports/vat-return?from=2026-01-01&to=2026-12-31`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| إجماليات التقرير (totals) | vat=-10.50 | افتح الرابط بحساب المالك |
| صف 1 | bucket: مبيعات خاضعة | base: 360.0000 | vat: 54.0000 |  |
| صف 2 | bucket: مبيعات بنسبة صفرية / معفاة (بلا ضريبة) | base: 0 | vat: 0 |  |
| صف 3 | bucket: مردود مبيعات | base: -40.0000 | vat: -6.0000 |  |
| صف 4 | bucket: إشعار دائن مبيعات | base: 0 | vat: 0 |  |
| صف 5 | bucket: مشتريات خاضعة | base: 500.0000 | vat: -75.0000 |  |
| صف 6 | bucket: مشتريات بلا ضريبة | base: 0 | vat: 0 |  |
| صف 7 | bucket: مردود مشتريات | base: -10.0000 | vat: 1.5000 |  |
| صف 8 | bucket: إشعار مدين مشتريات | base: 0 | vat: 0 |  |
| … | و2 صفاً آخر في التقرير الكلي |  |

### 12. تقرير vat-return-period

`http://localhost:3001/reports/vat-return-period?from=2026-01-01&to=2026-12-31`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| إجماليات التقرير (totals) | — | افتح الرابط بحساب المالك |
| صف 1 | section: ضريبة القيمة المضافة على المبيعات | line: المبيعات الخاضعة للنسبة الأساسية | net: 320.00 | vat: 48.00 | s_net_vat: 48.00 |  |
| صف 2 | section: ضريبة القيمة المضافة على المبيعات | line: الإيرادات الأخرى | net: 0.00 | vat: 0.00 | s_net_vat: 0.00 |  |
| صف 3 | section: ضريبة القيمة المضافة على المبيعات | line: سندات القبض | net: 100.00 | vat: 15.00 | s_net_vat: 15.00 |  |
| صف 4 | section: ضريبة القيمة المضافة على المبيعات | line: المبيعات المحلية الخاضعة للنسبة الصفرية | net: 0.00 | vat: 0.00 | s_net_vat: 0.00 |  |
| صف 5 | section: ضريبة القيمة المضافة على المبيعات | line: المبيعات المعفاة | net: 0.00 | vat: 0.00 | s_net_vat: 0.00 |  |
| صف 6 | section: ضريبة القيمة المضافة على المبيعات | line: صافي المبيعات | net: 420.00 | vat: 63.00 | s_net_vat: 0.00 |  |
| صف 7 | section: ضريبة القيمة المضافة على المشتريات | line: المشتريات الخاضعة للنسبة الأساسية | net: 490.00 | vat: 73.50 | s_net_vat: -73.50 |  |
| صف 8 | section: ضريبة القيمة المضافة على المشتريات | line: الإستيرادات الخاضعة للقيمة المضافة بالنسبة الأساسية | net: 0.00 | vat: 0.00 | s_net_vat: 0.00 |  |
| … | و5 صفاً آخر في التقرير الكلي |  |

### 13. تقرير ar-aging

`http://localhost:3001/reports/ar-aging?from=2026-01-01&to=2026-12-31`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| إجماليات التقرير (totals) | bucket_0_30=0.00، bucket_31_60=139.20، bucket_61_90=0.00، bucket_90_plus=0.00، unapplied=0.00، due=139.20 | افتح الرابط بحساب المالك |
| صف 1 | party: عميل التحقق الآجل | bucket_0_30: 0.00 | bucket_31_60: 139.20 | bucket_61_90: 0.00 | bucket_90_plus: 0.00 | unapplied: 0.00 | due: 139.20 |  |

### 14. تقرير ap-aging

`http://localhost:3001/reports/ap-aging?from=2026-01-01&to=2026-12-31`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| إجماليات التقرير (totals) | bucket_0_30=0.00، bucket_31_60=0.00، bucket_61_90=263.50، bucket_90_plus=0.00، unapplied=0.00، due=263.50 | افتح الرابط بحساب المالك |
| صف 1 | party: مورد التحقق | bucket_0_30: 0.00 | bucket_31_60: 0.00 | bucket_61_90: 263.50 | bucket_90_plus: 0.00 | unapplied: 0.00 | due: 263.50 |  |

### 15. تقرير subledger-reconciliation

`http://localhost:3001/reports/subledger-reconciliation?from=2026-01-01&to=2026-12-31`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| إجماليات التقرير (totals) | difference=0.00 | افتح الرابط بحساب المالك |
| صف 1 | pair: بنك — 1221001 شبكة | control_name: الحساب البنكي الرئيسي | control_balance: 180113.80 | sub_balance: 180113.80 | difference: 0.00 | status: مطابق | suspected: — |  |
| صف 2 | pair: صندوق — 1211001 الصندوق الرئيسي | control_name: الصندوق الرئيسي | control_balance: 49890.00 | sub_balance: 49890.00 | difference: 0.00 | status: مطابق | suspected: — |  |
| صف 3 | pair: مخزون — 1270001 | control_name: حساب بضاعة آخر المدة | control_balance: 335.00 | sub_balance: 335.00 | difference: 0.00 | status: مطابق | suspected: — |  |
| صف 4 | pair: ذمم مدينة — عميل التحقق الآجل | control_name: 12310001 عميل عام | control_balance: 139.20 | sub_balance: 139.20 | difference: 0.00 | status: مطابق | suspected: — |  |
| صف 5 | pair: ذمم دائنة — مورد التحقق | control_name: 22111001 مورد عام | control_balance: 263.50 | sub_balance: 263.50 | difference: 0.00 | status: مطابق | suspected: — |  |
| صف 6 | pair: ضريبة — 2222001 | control_name: ضريبة القيمة المضافة | control_balance: -10.50 | sub_balance: -10.5000 | difference: 0.00 | status: مطابق | suspected: — |  |

### 16. تقرير cash-statement

`http://localhost:3001/reports/cash-statement?from=2026-01-01&to=2026-12-31`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| إجماليات التقرير (totals) | income=230443.80، outcome=440.00 | افتح الرابط بحساب المالك |
| صف 1 | seq: 1 | operation: رصيد سابق | doc_no: — | day: 2025-12-31 | income: 0.00 | outcome: 0.00 | balance: 0.00 | note:  | s_all: 230003.80 | s_period: 230003.80 | s_count: 1 |  |
| صف 2 | seq: 2 | operation: قيد اليومية | doc_no: JE-000001 | day: 2026-01-01 | income: 230000.00 | outcome: 0.00 | balance: 230000.00 | note: قيد افتتاحي — رأس المال | s_all: 0 | s_period: 0 | s_count: 1 |  |
| صف 3 | seq: 3 | operation: قيد مبيعات | doc_no: JE-000003 | day: 2026-10-26 | income: 115.00 | outcome: 0.00 | balance: 230115.00 | note: Sales invoice SI-000001 | s_all: 0 | s_period: 0 | s_count: 1 |  |
| صف 4 | seq: 4 | operation: قيد اليومية | doc_no: JE-000006 | day: 2026-10-26 | income: 100.00 | outcome: 0.00 | balance: 230215.00 | note: سداد دفعة فاتورة مبيعات SI-000002 | s_all: 0 | s_period: 0 | s_count: 1 |  |
| صف 5 | seq: 5 | operation: سند صرف | doc_no: JE-000007 | day: 2026-10-26 | income: 0.00 | outcome: 300.00 | balance: 229915.00 | note: سداد فاتورة مشتريات PI-000001 | s_all: 0 | s_period: 0 | s_count: 1 |  |
| صف 6 | seq: 6 | operation: سند صرف | doc_no: JE-000008 | day: 2026-10-26 | income: 0.00 | outcome: 40.00 | balance: 229875.00 | note: VRF مصروف رسوم بنكية 40 | s_all: 0 | s_period: 0 | s_count: 1 |  |
| صف 7 | seq: 7 | operation: سند قبض | doc_no: JE-000009 | day: 2026-10-26 | income: 115.00 | outcome: 0.00 | balance: 229990.00 | note: VRF قبض إيراد بضريبة 115 | s_all: 0 | s_period: 0 | s_count: 1 |  |
| صف 8 | seq: 8 | operation: قيد اليومية | doc_no: JE-000010 | day: 2026-10-26 | income: 0.00 | outcome: 100.00 | balance: 229890.00 | note: ارسال مناقلة CT-000001 | s_all: 0 | s_period: 0 | s_count: 1 |  |
| … | و2 صفاً آخر في التقرير الكلي |  |

### 17. تقرير inventory-valuation

`http://localhost:3001/reports/inventory-valuation?from=2026-01-01&to=2026-12-31`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| إجماليات التقرير (totals) | quantity=40.00، value=335.00 | افتح الرابط بحساب المالك |
| صف 1 | sku: VRF-FL | item: دقيق التحقق | warehouse: المستودع الرئيسي | quantity: 22.0000 | average_cost: 10.0000 | value: 220.0000 |  |
| صف 2 | sku: VRF-FL | item: دقيق التحقق | warehouse: مستودع سيارة التوزيع | quantity: 5.0000 | average_cost: 10.0000 | value: 50.0000 |  |
| صف 3 | sku: VRF-BRK | item: صنف التحقق بالحبة | warehouse: المستودع الرئيسي | quantity: 13.0000 | average_cost: 5.0000 | value: 65.0000 |  |

### 18. تقرير profit-loss

`http://localhost:3001/reports/profit-loss?from=2026-01-01&to=2026-12-31`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| إجماليات التقرير (totals) | — | افتح الرابط بحساب المالك |
| صف 1 | section: إجمالي الإيرادات | amount: 420.0000 |  |
| صف 2 | section: إجمالي المصروفات | amount: 225.0000 |  |
| صف 3 | section: صافي الربح | amount: 195.0000 |  |

### 19. تقرير balance-sheet

`http://localhost:3001/reports/balance-sheet?from=2026-01-01&to=2026-12-31`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| إجماليات التقرير (totals) | — | افتح الرابط بحساب المالك |
| صف 1 | section: الأصول | code: 1160001 | account: أثاث | balance: 20000.0000 |  |
| صف 2 | section: الأصول | code: 1211001 | account: الصندوق الرئيسي | balance: 49890.0000 |  |
| صف 3 | section: الأصول | code: 1211003 | account: نقد تحت التحويل | balance: 0.0000 |  |
| صف 4 | section: الأصول | code: 1221001 | account: شبكة | balance: 180113.8000 |  |
| صف 5 | section: الأصول | code: 12310001 | account: عميل عام | balance: 139.2000 |  |
| صف 6 | section: الأصول | code: 1270001 | account: حساب بضاعة آخر المدة | balance: 335.0000 |  |
| صف 7 | section: الأصول | code: 1270003 | account: بضاعة تحت التحويل | balance: 0.0000 |  |
| صف 8 | section: الخصوم | code: 22111001 | account: مورد عام | balance: 263.5000 |  |
| … | و3 صفاً آخر في التقرير الكلي |  |

### 20. مراكز التكلفة والمشاريع ونقطة البيع (توسعة التحقق الشامل)

`http://localhost:3001/accounting/cost-centers`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| مركز تكلفة ADMIN | الإدارة العامة (جذري) | /accounting/cost-centers |
| مركز تكلفة CC-VRF-GRP | مجموعة مراكز التحقق (جذري) | /accounting/cost-centers |
| مركز تكلفة CC-VRF-SALES | مركز مبيعات التحقق (مركز فرعي) | /accounting/cost-centers |
| مركز تكلفة SALES | المبيعات (جذري) | /accounting/cost-centers |
| مركز تكلفة STORE | المستودع (جذري) | /accounting/cost-centers |
| مشروع PRJ-VRF-01 | مشروع تجهيز فرع التحقق — قيمة العقد 1000.00 | http://localhost:3001/projects |
| نقطة البيع POS | فاتورة كاشير فورية مسددة على البنك (13.80) | http://localhost:3001/pos |

### 21. بوابة العميل (تطبيق منفصل)

`http://localhost:3004/auth/login`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| رمز الشركة + البريد | verify2026 + portal-customer@verify2026.test | أول دخول لحساب أُنشئ بـ portal-access يُلزم بتغيير كلمة المرور (/auth/change-password) ثم يفتح /portal/invoices |
| تغيير كلمة المرور أول دخول | إلزامي للحسابات المُسلَّمة بكلمة مؤقتة | سلوك مقصود: portal-access يضبط must_change_password — القائمة كانت تغفل توثيقه |
| فواتير البوابة | فاتورة SI-000002 بمبلغ 285.20 ومرتجع −46.00 | لعميل التحقق الآجل فقط |
| /portal/statement الرصيد | 139.20 | يشمل دفعات الفواتير (invoice_payments) ضمن الحركات |
| /portal/payments الدفعة | 100.00 — دفعة واحدة (+ سندات القبض/الصرف المرتبطة بالطرف) |  |
| حسابات البوابة المُنشأة | 2 | عميل + مورد (2) — تُرى في /settings/users قائمة المستخدمين، لا في نموذج الدعوات (الدعوات لموظفي المنشأة) |
| بوابة المورد: الدخول | portal-supplier@verify2026.test | أيضاً من /purchases/supplier-portal داخل staff (يظهر مستخدماً واحداً نشطاً) |

### 22. تطبيق المخابز (مندوب التوزيع)

`http://localhost:3005/rep`

| ماذا أتحقق | القيمة المتوقعة | ملاحظة |
|---|---|---|
| الدخول | rep@verify2026.test / Van-Qz7-2026$Local | رمز الشركة verify2026 |
| الشاشات تفتح بلا جدار ترخيص | موزّع، تحصيل، عهدة، إنتاج، تقارير… كلها تفتح | الحمولات (العهدة) فارغة عمداً: هذه البذرة لا تولّد حركات مخابز |
| مندوب التحقق يظهر في /reps | مندوب التحقق — مستودع سيارة VAN-1 | أيضاً /sales/salesmen في staff |
| /reps بحساب مندوب مُحصّر | محجوبة (القائمة تُخفيها والمسار يرد 403 VAN_SALES_COMPANY_SCOPE_REQUIRED) | مقصود ومختبَر: بطاقات المناديب سطحُ منشأة يتطلّب إذن إدارة الخط (مثل van_sales.load.manage) — المالك/مدير الخط يفتحها؛ المندوب يقرأ خطَّه في /van-sales/me وشاشة التوزيع الخاصة به |

## قالب الإبلاغ عن فرق

```
الشاشة (المسار):
القيمة المتوقعة:
القيمة الفعلية:
الفرق:
```

## التنظيف

```bash
pnpm verify-seed -- --purge-only   # يحذف مستأجر التحقق وحده ولا يلمس غيره
```
