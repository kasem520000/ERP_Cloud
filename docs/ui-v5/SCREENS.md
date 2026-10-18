# سجل الشاشات — v5

> مُولَّد من `docs/ui-v5/screens.json` بالأمر `node scripts/ui-registry.mjs`. لا تُحرّره يدوياً.

**الإجمالي:** 297 شاشة · **مكتملة:** 236

المفتاح: `- [x]` الشاشة أُعيد بناؤها/اعتُمدت في v5 · `- [ ]` لم تُعالج بعد · **R** أُعيد بناء هيكلها · **S** طُبّق عليها النظام المشترك وتحقّقت.

| التطبيق | الشاشات | مكتمل |
| --- | ---: | ---: |
| لوحة الموظفين · staff | 201 | 164 |
| لوحة المنصة · platform-admin | 38 | 34 |
| بوابة العميل · customer-portal | 11 | 9 |
| الموقع التسويقي · marketing | 36 | 18 |
| تطبيق المخابز · bakery | 11 | 11 |

## لوحة الموظفين · staff

### إدارة العلاقات

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | أنشطة المبيعات | `/crm/activities` | `crm/activities/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | صفقة (تفاصيل) | `/crm/deals/[id]` | `crm/deals/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | تنبؤ المبيعات | `/crm/forecast` | `crm/forecast/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مسار المبيعات | `/crm/pipelines` | `crm/pipelines/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### إدارة المراسي

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | الإضافات | `/marina/additions` | `marina/additions/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الحجوزات | `/marina/bookings` | `marina/bookings/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | إغلاق اليومية | `/marina/day-close` | `marina/day-close/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بطاقة الفئة وفترات التأجير | `/marina/groups` | `marina/groups/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بحث الفواتير | `/marina/link-invoices` | `marina/link-invoices/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | تحضير المراكب | `/marina/preparation` | `marina/preparation/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | خطة الدور | `/marina/rota` | `marina/rota/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بطاقات النماذج والمراكب والملاك | `/marina/vessels` | `marina/vessels/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | المخالفات | `/marina/violations` | `marina/violations/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### الإشعارات

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | مركز الإشعارات | `/notifications` | `notifications/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### الاعتمادات

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | سجل الموافقات | `/approvals/history` | `approvals/history/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | وارد الموافقات | `/approvals/inbox` | `approvals/inbox/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### الإعدادات

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | إعدادات المساعد | `/settings/ai` | `settings/ai/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مسارات الموافقات | `/settings/approvals` | `settings/approvals/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | سجلات المستخدمين | `/settings/audit` | `settings/audit/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | النسخ الإحتياطي | `/settings/backup` | `settings/backup/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بطاقة فرع | `/settings/branches` | `settings/branches/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | تغيير كلمة المرور | `/settings/change-password` | `settings/change-password/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | بطاقة المنشأة | `/settings/company` | `settings/company/page.tsx` |  |  |
| [x] | الحقول الإضافية | `/settings/custom-fields` | `settings/custom-fields/page.tsx` | R | تحقق في المتصفح 1440 |
| [x] | تدوير البيانات | `/settings/data-rotation` | `settings/data-rotation/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | أجهزة أندرويد المرتبطة | `/settings/devices` | `settings/devices/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | التجارة الإلكترونية — سلة · زد · Shopify | `/settings/ecommerce` | `settings/ecommerce/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | البريد — القوالب والسجلّ | `/settings/email` | `settings/email/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مدير الملفات | `/settings/files` | `settings/files/page.tsx` | R | تحقق في المتصفح 1440 |
| [x] | إعدادات عامة | `/settings/general` | `settings/general/page.tsx` | R | تحقق في المتصفح 1440 |
| [x] | صيانة الفواتير | `/settings/invoice-maintenance` | `settings/invoice-maintenance/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | اللغة | `/settings/language` | `settings/language/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | سوق الإضافات | `/settings/marketplace` | `settings/marketplace/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | إنشاء ملف | `/settings/new-file` | `settings/new-file/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | العروض | `/settings/offers` | `settings/offers/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بوابات الدفع — جيديا · NeoLeap | `/settings/payment-gateways` | `settings/payment-gateways/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | روابط الدفع — ميسر | `/settings/payments` | `settings/payments/page.tsx` |  |  |
| [x] | الربط المحاسبي | `/settings/posting-profiles` | `settings/posting-profiles/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | إعدادات الأسعار | `/settings/price-lists` | `settings/price-lists/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | إعدادات الطباعة | `/settings/printing` | `settings/printing/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | إستعادة البيانات | `/settings/restore` | `settings/restore/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | صلاحيات المستخدمين | `/settings/roles` | `settings/roles/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مزامنة البيانات | `/settings/sync` | `settings/sync/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | مزامنة كيان | `/settings/sync/[entity]` | `settings/sync/[entity]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | إدارة المزامنة | `/settings/sync/manage` | `settings/sync/manage/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مزامنة الفواتير Zatca | `/settings/sync/zatca` | `settings/sync/zatca/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | التحقق بخطوتين | `/settings/two-factor` | `settings/two-factor/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | الاستخدام والحصص | `/settings/usage` | `settings/usage/page.tsx` |  |  |
| [x] | بطاقة مستخدم | `/settings/users` | `settings/users/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | واتساب — إرسال الفواتير | `/settings/whatsapp` | `settings/whatsapp/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الدومين والشعار | `/settings/white-label` | `settings/white-label/page.tsx` | R | تحقق في المتصفح 1440 |
| [x] | إعدادات الربط مع هيئة الزكاة والضريبة | `/settings/zatca` | `settings/zatca/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الفواتير المرفوعة على موقع الضرائب | `/settings/zatca/sent` | `settings/zatca/sent/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مزامنة الفواتير - ZATCA | `/settings/zatca/status` | `settings/zatca/status/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### الترحيل

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | إستيراد وتصدير البيانات | `/migration/runs` | `migration/runs/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### التصنيع

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | قوائم المواد | `/manufacturing/boms` | `manufacturing/boms/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | أوامر التصنيع | `/manufacturing/orders` | `manufacturing/orders/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### التعليقات

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | إشارات التعليقات | `/comments/mentions` | `comments/mentions/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### التفصيل

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | فواتير التفصيل | `/tailoring/invoices` | `tailoring/invoices/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | قياسات العملاء | `/tailoring/measurements` | `tailoring/measurements/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | خصائص القياسات | `/tailoring/measurements/attributes` | `tailoring/measurements/attributes/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | إدارة الخيارات الجاهزة | `/tailoring/options` | `tailoring/options/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | إدارة طلبات التفصيل | `/tailoring/orders` | `tailoring/orders/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | أنواع التفصيل | `/tailoring/types` | `tailoring/types/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### التقارير

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | مركز التقارير (كل التقارير) | `/reports` | `reports/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | تقرير | `/reports/[key]` | `reports/[key]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | منشئ التقارير المخصص | `/reports/builder` | `reports/builder/page.tsx` | R | تحقق في المتصفح 1440 |
| [x] | التقارير المحفوظة | `/reports/custom` | `reports/custom/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### التكاملات

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | إدارة الطلبات | `/integrations/salla/orders` | `integrations/salla/orders/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | المنتجات | `/integrations/salla/products` | `integrations/salla/products/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | إعدادات ربط سلة | `/integrations/salla/settings` | `integrations/salla/settings/page.tsx` |  |  |
| [x] | ربط المستودعات | `/integrations/salla/warehouses` | `integrations/salla/warehouses/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### التوزيع (فان)

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | نظام المصنع والتوزيع | `/van-sales` | `van-sales/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | شاشة مندوب التوزيع | `/van-sales/rep` | `van-sales/rep/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### التوقيع الإلكتروني

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [ ] | توقيع إلكتروني | `/esign/[token]` | `esign/[token]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |

### الجوال

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [ ] | تطبيق الموظف | `/m` | `m/page.tsx` |  |  |
| [ ] | موافقات الفريق | `/m/approvals` | `m/approvals/page.tsx` |  |  |
| [ ] | حضور وانصراف | `/m/attendance` | `m/attendance/page.tsx` |  |  |
| [ ] | راتبي وإجازاتي | `/m/profile` | `m/profile/page.tsx` |  |  |
| [ ] | طلب جديد | `/m/requests/new` | `m/requests/new/page.tsx` |  |  |

### الخزينة

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | الحسابات البنكية | `/treasury/bank-accounts` | `treasury/bank-accounts/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | التسوية البنكية | `/treasury/bank-reconciliation` | `treasury/bank-reconciliation/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | كشوف الحساب البنكي | `/treasury/bank-statements` | `treasury/bank-statements/page.tsx` | R | تحقق في المتصفح 1440 |
| [x] | 🏦 تعريف البنوك | `/treasury/banks` | `treasury/banks/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | 🏦 كشف الشيكات | `/treasury/cheques` | `treasury/cheques/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | 📊 إغلاق اليومية | `/treasury/day-close` | `treasury/day-close/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | 🏦 حركة الصندوق | `/treasury/movements` | `treasury/movements/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | 🏦 تعريف الخزينة | `/treasury/safes` | `treasury/safes/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مناقلة | `/treasury/transfers` | `treasury/transfers/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | عرض السندات | `/treasury/vouchers` | `treasury/vouchers/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### الدعم

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [ ] | عن البرنامج | `/support/about` | `support/about/page.tsx` |  |  |
| [ ] | 🆘 إطلب المساعدة | `/support/help` | `support/help/page.tsx` |  |  |
| [x] | الترخيص | `/support/license` | `support/license/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | فتح المصمم لتصميم التقارير | `/support/report-designer` | `support/report-designer/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### الشاشات المسجّلة

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [ ] | شاشة مسجّلة | `/s/[...slug]` | `s/[...slug]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |

### الطباعة

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [ ] | طباعة مستند | `/print/[doc]/[id]` | `print/[doc]/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |

### المبيعات

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | 👤 عميل نقدي | `/sales/cash-customers` | `sales/cash-customers/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بطاقة عميل | `/sales/customers` | `sales/customers/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | طلبات المتجر الإلكتروني | `/sales/ecommerce-orders` | `sales/ecommerce-orders/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | فاتورة مبيعات | `/sales/invoices` | `sales/invoices/page.tsx` | R | تحقق في المتصفح 1440 · رأس صفحة موحّد |
| [ ] | فاتورة مبيعات (تفاصيل) | `/sales/invoices/[id]` | `sales/invoices/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | فاتورة إخراج | `/sales/invoices/new` | `sales/invoices/new/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | إشعار مبيعات | `/sales/notes/[kind]` | `sales/notes/[kind]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | وصول العملاء للبوابة | `/sales/portal-access` | `sales/portal-access/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | نقطة البيع | `/sales/pos` | `sales/pos/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | عرض سعر | `/sales/quotations` | `sales/quotations/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | عرض سعر (تفاصيل) | `/sales/quotations/[id]` | `sales/quotations/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [ ] | توقيع عرض السعر | `/sales/quotations/[id]/esign` | `sales/quotations/[id]/esign/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | مردود المبيعات | `/sales/returns` | `sales/returns/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | 📋 طباعة فواتير مندوب وعمولاتهم | `/sales/salesman-commissions` | `sales/salesman-commissions/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بطاقة مندوب | `/sales/salesmen` | `sales/salesmen/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | ورديات المبيعات | `/sales/shifts` | `sales/shifts/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | كشف عميل | `/sales/statements` | `sales/statements/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### المحاسبة

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | دليل الحسابات | `/accounting/accounts` | `accounting/accounts/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | شجرة الحسابات | `/accounting/accounts/tree` | `accounting/accounts/tree/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | أماكن النقد | `/accounting/cash-locations` | `accounting/cash-locations/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | 📊 كشف مركز الكلفة | `/accounting/cost-center-statement` | `accounting/cost-center-statement/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بطاقة مركز تكلفة | `/accounting/cost-centers` | `accounting/cost-centers/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | 📒 بطاقة حساب المصاريف | `/accounting/expenses` | `accounting/expenses/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | أرباح وخسائر حسابات رئيسية | `/accounting/income-statement` | `accounting/income-statement/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | القيود اليومية | `/accounting/journal-entries` | `accounting/journal-entries/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | قيد يومية | `/accounting/journal-entries/[id]` | `accounting/journal-entries/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | سند قيد | `/accounting/journal-entries/new` | `accounting/journal-entries/new/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | كشف حساب | `/accounting/ledger` | `accounting/ledger/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | طرق الدفع | `/accounting/payment-methods` | `accounting/payment-methods/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الفترات المحاسبية | `/accounting/periods` | `accounting/periods/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | ميزان المراجعة | `/accounting/trial-balance` | `accounting/trial-balance/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### المساعد الذكي

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | المساعد المحاسبي | `/assistant` | `assistant/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### المستودعات

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | تسوية مخزنية | `/inventory/adjustments` | `inventory/adjustments/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | طباعة الباركود | `/inventory/barcodes` | `inventory/barcodes/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | أصناف تحت حد الطلب | `/inventory/below-minimum` | `inventory/below-minimum/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | أرصدة الرفوف | `/inventory/bin-balances` | `inventory/bin-balances/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | رفوف المستودع | `/inventory/bins` | `inventory/bins/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بطاقة مجموعة | `/inventory/categories` | `inventory/categories/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | توصيل مخزني | `/inventory/deliveries` | `inventory/deliveries/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | تواريخ الصلاحية | `/inventory/expiry` | `inventory/expiry/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بضاعة بالطريق | `/inventory/in-transit` | `inventory/in-transit/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بطاقة الصنف | `/inventory/item-card` | `inventory/item-card/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | وحدات الصنف والباركود | `/inventory/item-units` | `inventory/item-units/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | دليل المواد وبطاقاتها | `/inventory/items` | `inventory/items/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | جرد المواد | `/inventory/levels` | `inventory/levels/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | صلاحية المواد (الدفعات) | `/inventory/lots` | `inventory/lots/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | حركة مادة تفصيلي | `/inventory/movements` | `inventory/movements/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | لوحة المخزون | `/inventory/overview` | `inventory/overview/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | تقرير أمر الإنتاج | `/inventory/production` | `inventory/production/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | طلب بضاعة | `/inventory/requests` | `inventory/requests/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | تقرير الأرقام التسلسلية | `/inventory/serials` | `inventory/serials/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مناقلة | `/inventory/transfers` | `inventory/transfers/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بطاقة وحدة | `/inventory/units` | `inventory/units/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | سند إدخال / إخراج | `/inventory/vouchers` | `inventory/vouchers/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بطاقة مستودع | `/inventory/warehouses` | `inventory/warehouses/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### المشاريع

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | عقد عميل | `/projects` | `projects/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | مشروع | `/projects/[id]` | `projects/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [ ] | لوحة المشروع | `/projects/[id]/board` | `projects/[id]/board/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [ ] | تكلفة المشروع | `/projects/[id]/cost` | `projects/[id]/cost/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [ ] | مخطط المشروع الزمني | `/projects/[id]/gantt` | `projects/[id]/gantt/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [ ] | مهمة مشروع | `/projects/[id]/tasks/[taskId]` | `projects/[id]/tasks/[taskId]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [ ] | أوقات المشروع | `/projects/[id]/time` | `projects/[id]/time/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | لوحة كانبان | `/projects/board` | `projects/board/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بطاقة بند | `/projects/boq` | `projects/boq/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مرتجع مقاولات | `/projects/contracting-return` | `projects/contracting-return/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | عقد مقاول | `/projects/contractor-contract` | `projects/contractor-contract/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | سند دفع لمقاول | `/projects/contractor-payment` | `projects/contractor-payment/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | تكلفة المشروع | `/projects/cost` | `projects/cost/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | متابعة | `/projects/followup` | `projects/followup/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مخطط جانت | `/projects/gantt` | `projects/gantt/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | عروض | `/projects/offers` | `projects/offers/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مراحل مشروع | `/projects/stages` | `projects/stages/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | مهمة | `/projects/tasks/[taskId]` | `projects/tasks/[taskId]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | تتبع الوقت | `/projects/time` | `projects/time/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### المشتريات

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | المشتريات (تحويل) | `/purchases` | `purchases/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | فاتورة المشتريات | `/purchases/invoices` | `purchases/invoices/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | فاتورة مشتريات (تفاصيل) | `/purchases/invoices/[id]` | `purchases/invoices/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | فاتورة إدخال | `/purchases/invoices/new` | `purchases/invoices/new/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | قراءة فاتورة بالـ OCR | `/purchases/invoices/ocr` | `purchases/invoices/ocr/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | إشعار مشتريات | `/purchases/notes/[kind]` | `purchases/notes/[kind]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | بوابة الموردين | `/purchases/supplier-portal` | `purchases/supplier-portal/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بطاقة مورد | `/purchases/suppliers` | `purchases/suppliers/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### الموظفون والرواتب

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | الحوافز والجزاءات | `/hrm/adjustments` | `hrm/adjustments/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | تنبيهات الإقامة والتأمين | `/hrm/compliance` | `hrm/compliance/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الإدارات والأقسام | `/hrm/departments` | `hrm/departments/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | حركات الموظف | `/hrm/employee-movements` | `hrm/employee-movements/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | كشف حساب موظف | `/hrm/employee-statement` | `hrm/employee-statement/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | تعريف موظف | `/hrm/employees` | `hrm/employees/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | نطاق حضور الفروع | `/hrm/geofences` | `hrm/geofences/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الوظائف | `/hrm/jobs` | `hrm/jobs/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | إجازات الموظفين | `/hrm/leaves` | `hrm/leaves/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | إستحقاق وصرف الرواتب | `/hrm/payroll` | `hrm/payroll/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | مسير رواتب | `/hrm/payroll/[id]` | `hrm/payroll/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [ ] | ملف حماية الأجور | `/hrm/payroll/[id]/wps` | `hrm/payroll/[id]/wps/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | دفع الرواتب | `/hrm/salary-payments` | `hrm/salary-payments/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | تقرير الرواتب | `/hrm/salary-report` | `hrm/salary-report/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### النظارات

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | أسماء الحقول | `/optics/field-labels` | `optics/field-labels/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | بيانات النظارات | `/optics/prescriptions` | `optics/prescriptions/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### بوابة الموردين

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [ ] | بوابة الموردين | `/supplier-portal` | `supplier-portal/page.tsx` |  |  |

### عام

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [ ] | لوحة التحكم | `/` | `page.tsx` |  |  |

### لوحات المؤشرات

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | لوحات المؤشرات | `/dashboards` | `dashboards/page.tsx` | R | تحقق في المتصفح 1440 · رأس صفحة موحّد |
| [ ] | لوحة مؤشرات | `/dashboards/[id]` | `dashboards/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |

### نظام التصميم

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [ ] | نظام التصميم (تطوير) | `/design` | `design/page.tsx` |  |  |

### نقاط البيع

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | نقطة البيع أوفلاين | `/pos/offline` | `pos/offline/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | طابور POS أوفلاين | `/pos/offline-queue` | `pos/offline-queue/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

## لوحة المنصة · platform-admin

### لوحة المنصة

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | لوحة المنصة | `/` | `page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | طلبات التفعيل | `/activation-requests` | `activation-requests/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | المساعد المحاسبي | `/ai` | `ai/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | التحليلات | `/analytics` | `analytics/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | تحليلات الموقع | `/analytics/site` | `analytics/site/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الإعلانات والإشعارات | `/announcements` | `announcements/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مستكشف الـAPI | `/api-explorer` | `api-explorer/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مفاتيح الـAPI | `/api-keys` | `api-keys/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | سجل التدقيق | `/audit` | `audit/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | البيانات والاسترجاع | `/backups` | `backups/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الحملات البريدية | `/campaigns` | `campaigns/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | المحتوى | `/content` | `content/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | طلبات البيانات | `/data-requests` | `data-requests/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | نظام تصميم اللوحة | `/design` | `design/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | المتابعة والتحصيل | `/dunning` | `dunning/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | البريد | `/email` | `email/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الملفات | `/files` | `files/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | صحة النظام | `/health` | `health/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الدخول المؤقّت | `/impersonation` | `impersonation/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | فواتير المنصة | `/invoices` | `invoices/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | طباعة فاتورة المنصة | `/invoices/[id]/print` | `invoices/[id]/print/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | المهام والطوابير | `/jobs` | `jobs/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | العملاء المتوقّعون | `/leads` | `leads/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | سوق الإضافات | `/marketplace` | `marketplace/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الباقات والأسعار | `/plans` | `plans/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الإيراد | `/revenue` | `revenue/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | أدوار المنصة | `/roles` | `roles/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | إعدادات المنصة | `/settings` | `settings/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الاشتراكات والتراخيص | `/subscriptions` | `subscriptions/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | المستأجرون | `/tenants` | `tenants/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | ملف المستأجر | `/tenants/[id]` | `tenants/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | مستأجر جديد | `/tenants/new` | `tenants/new/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مكتب الدعم | `/tickets` | `tickets/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | تذكرة دعم | `/tickets/[id]` | `tickets/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | الاستخدام والحصص | `/usage` | `usage/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مستخدمو المنصة | `/users` | `users/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | ملف مستخدم | `/users/[id]` | `users/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | الويب هوك | `/webhooks` | `webhooks/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

## بوابة العميل · customer-portal

### المصادقة

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | الدخول | `/` | `page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | تغيير كلمة المرور | `/auth/change-password` | `auth/change-password/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | استعادة كلمة المرور | `/auth/forgot` | `auth/forgot/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | تسجيل الدخول | `/auth/login` | `auth/login/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

### بوابة العميل

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | بوابة العميل | `/portal` | `portal/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | فواتيري | `/portal/invoices` | `portal/invoices/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | تفاصيل الفاتورة | `/portal/invoices/[id]` | `portal/invoices/[id]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [ ] | سداد الفاتورة | `/portal/invoices/[id]/pay` | `portal/invoices/[id]/pay/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | المدفوعات | `/portal/payments` | `portal/payments/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | ملفي | `/portal/profile` | `portal/profile/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | كشف الحساب | `/portal/statement` | `portal/statement/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

## الموقع التسويقي · marketing

### الإنجليزية

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [ ] | الرئيسية (EN) | `/en` | `en/page.tsx` |  |  |
| [ ] | المدوّنة (EN) | `/en/blog` | `en/blog/page.tsx` |  |  |
| [ ] | مقال (EN) | `/en/blog/[slug]` | `en/blog/[slug]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [ ] | دراسات الحالة (EN) | `/en/cases` | `en/cases/page.tsx` |  |  |
| [ ] | دراسة حالة (EN) | `/en/cases/[slug]` | `en/cases/[slug]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [ ] | الوحدات (EN) | `/en/features` | `en/features/page.tsx` |  |  |
| [ ] | الفاتورة الإلكترونية (EN) | `/en/features/einvoicing` | `en/features/einvoicing/page.tsx` |  |  |
| [ ] | المساعدة (EN) | `/en/help` | `en/help/page.tsx` |  |  |
| [ ] | مقال مساعدة (EN) | `/en/help/[slug]` | `en/help/[slug]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [ ] | صفحة قانونية (EN) | `/en/legal/[slug]` | `en/legal/[slug]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |

### الموقع التسويقي

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | الرئيسية | `/` | `page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | المدوّنة | `/blog` | `blog/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | مقال | `/blog/[slug]` | `blog/[slug]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | دراسات الحالة | `/cases` | `cases/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | دراسة حالة | `/cases/[slug]` | `cases/[slug]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | سجل التغييرات | `/changelog` | `changelog/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | تحديث | `/changelog/[slug]` | `changelog/[slug]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | تواصل معنا | `/contact` | `contact/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | اطلب عرضاً | `/demo` | `demo/page.tsx` |  |  |
| [x] | نظام التصميم | `/design` | `design/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الوحدات | `/features` | `features/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الفاتورة الإلكترونية | `/features/einvoicing` | `features/einvoicing/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | مركز المساعدة | `/help` | `help/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | مقال مساعدة | `/help/[slug]` | `help/[slug]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | القطاعات | `/industries` | `industries/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | قطاع | `/industries/[slug]` | `industries/[slug]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [ ] | صفحة قانونية | `/legal/[slug]` | `legal/[slug]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | دخول العملاء | `/login` | `login/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | صيانة | `/maintenance` | `maintenance/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [ ] | صفحة 404 | `/not-found-view/[locale]` | `not-found-view/[locale]/page.tsx` |  | مسار ديناميكي — يُتحقق بسجل حقيقي |
| [x] | الاشتراك | `/onboarding` | `onboarding/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الباقات | `/pricing` | `pricing/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | حالة الخدمة | `/status` | `status/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الأمان والثقة | `/trust` | `trust/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | إلغاء الاشتراك | `/unsubscribe` | `unsubscribe/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | التحقق من فاتورة | `/verify` | `verify/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |

## تطبيق المخابز · bakery

### تطبيق المخابز

| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |
| :-: | --- | --- | --- | :-: | --- |
| [x] | الرئيسية | `/` | `page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | المحاسبة | `/accounting` | `accounting/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | التحصيل | `/collection` | `collection/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | العهدة | `/custody` | `custody/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | التوزيع | `/distribution` | `distribution/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الإنتاج | `/production` | `production/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | شاشة المندوب | `/rep` | `rep/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | التقارير | `/reports` | `reports/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | المناديب | `/reps` | `reps/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | المبيعات | `/sales` | `sales/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
| [x] | الخزينة | `/treasury` | `treasury/page.tsx` | R | تحقق في المتصفح 1440 · ضوابط مشتركة |
