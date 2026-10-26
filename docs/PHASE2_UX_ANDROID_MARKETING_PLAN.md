# خطة التنفيذ المرحلية للجولة الثانية: تحسينات الواجهات، التوقيت، تطبيقات الأندرويد، والواجهة التسويقية

- **الفرع النشط:** `arena/4c98c7f3-erp-cloud` (الالتزام الأساسي المرفوع: `cd984b6`)
- **قاعدة العمل:** تقسيم المهام إلى مراحل موثّقة، وتحديث هذا الملف فوراً عقب إتمام كل مرحلة، والتحقق الحيّ والبصري والمحاسبي قبل الرفع إلى `origin/arena/4c98c7f3-erp-cloud`.

---

## جدول المراحل وحالة التقدّم

| المرحلة | النطاق والبنود المشمولة | الحالة |
|---|---|---|
| **المرحلة 1** | **(البنود 1، 2، 3):** توحيد شاشة التحقق من الجلسة وشاشة تسجيل الدخول في `apps/bakery` مع بقية التطبيقات + جعل اسم المستودع الافتراضي للمنشآت الجديدة **`المستودع الرئيسي`** + اعتماد **توقيت مكة المكرمة (`Asia/Riyadh`)** للتاريخ والوقت عبر النظام بالكامل | ✅ **مكتمل** |
| **المرحلة 2** | **(البندان 4، 5):** إصلاح تحديد القائمة الجانبية ونوع المستند في فواتير ومردودات المشتريات (`?kind=purchase_return`) + إعادة بناء وتنظيم شاشة نقطة البيع (`/sales/pos`) وفواتير المبيعات والمشتريات ومردوداتها لإظهار زر حذف الصنف وزر الإتمام/الحفظ مباشرة دون سحب أفقي أو تمرير سفلي طويل | ✅ **مكتمل** |
| **المرحلة 3** | **(البند 6):** جلب `apps/android-bakery` و`apps/android-rep` فقط من الفرع `arena/51e2c443-erp-cloud` + فحص شامل لكل أمر ومسار وواجهة ومطابقتها مالياً وبرمجياً مع الخادم (`@erp/api`) وتطبيق الموظفين (`apps/staff`) والمخابز (`apps/bakery`) وإصلاح أي تعارض | ✅ **مكتمل** |
| **المرحلة 4** | **(البند 7):** تحديث الواجهة التسويقية `apps/marketing` لتعكس كل إمكانات النظام السحابي وتطبيقاته + إضافة زر **«تسجيل الدخول»** في القسم الرئيسي (`Hero`) بجانب «ابدأ مجاناً» و«شاهد الوحدات» لسهولة الدخول من الجوال | 🔄 **قيد التنفيذ** |
| **المرحلة 5** | البناء الإنتاجي الشامل + التحقق البصري الحيّ بمتصفح Chromium (حاسوب وجوال) + المطابقة المحاسبية `pnpm verify-seed` + التوثيق والرفع النهائي إلى `origin/arena/4c98c7f3-erp-cloud` | ⏳ مخطط |

---

## سجل الإنجاز التفصيلي حسب المراحل

### المرحلة 1 — مكتملة (`Items 1, 2, 3`)
1. **البند 1 — توحيد شاشة التحقق من الجلسة (`BootCard`) وشاشة تسجيل الدخول في `apps/bakery`:**
   - إضافة أنماط `.boot` و`.boot-card` و`.logo` و`.auth-page` و`.auth-brand` و`.auth-card` كاملة في `apps/bakery/app/globals.css` مطابقة لـ`apps/staff` ولوحة المنصة، واستخدام `<BootCard />` في `BakeryGuard` أثناء فحص الترخيص.
   - إعادة بناء `apps/bakery/components/login-screen.tsx` بنفس الهوية الثنائية (`.auth-page` + `.auth-brand` + `.auth-card`) مع دعم التحقق الثنائي `MFA` واستعادة وتعيين كلمة المرور ورابط إنشاء اشتراك جديد وإزالة أي رموز تقنية إنجليزية.
2. **البند 2 — اسم المستودع الافتراضي للمنشآت الجديدة = `المستودع الرئيسي`:**
   - إصلاح الشرط الخاطئ `options.nameEn ? nameEn : 'المستودع الرئيسي'` في `apps/api/src/modules/organization/provisioning/org-provisioning.service.ts` إلى `options.warehouseName ?? 'المستودع الرئيسي'` بحيث يُنشأ المستودع الافتراضي دائماً باسم **`المستودع الرئيسي`** حتى عند تمرير `nameEn` للفرع من التسجيل الذاتي أو لوحة المنصة.
   - إضافة الهجرة `0155_arabic_warehouse_and_makkah_timezone.sql` لتحديث أي مستودعات افتراضية سابقة باسم `Main branch` / `Main warehouse` إلى `المستودع الرئيسي`.
3. **البند 3 — توحيد التاريخ والوقت على توقيت مكة المكرمة (`Asia/Riyadh`):**
   - تغيير القيمة الافتراضية لـ `timezone` في `packages/config/src/tenant-settings.ts` من `'UTC'` إلى `'Asia/Riyadh'` وتحديث قاعدة البيانات في الهجرة `0155`.
   - تحديث دوال `dateText` و`dateTime` و`today` في `apps/staff/lib/{format.ts,lookups.ts}`، و`formatDate` و`formatDateTime` في `@erp/ui`، وطباعة السندات في `@erp/web-van`، وتنسيقات التواريخ في `apps/bakery` و`apps/platform-admin` و`pos.service.ts` و`org-provisioning.service.ts` و`main.ts` (`TZ=Asia/Riyadh`) و`ecosystem.config.cjs` لتعتمد توقيت مكة المكرمة `UTC+3`.
   - **الاختبارات الآلية المجتازة:** `517 / 517` اختبار ناجح (`@erp/config` `32/32`، `@erp/web-van` `95/95`، `@erp/staff` `105/105`، `@erp/bakery` `259/259`، و`organization-provisioning.spec.ts` + `deployment-artifacts.spec.ts` `26/26`).

### المرحلة 2 — مكتملة (`Items 4, 5`)
4. **البند 4 — إصلاح تمييز القائمة الجانبية ونوع المستند بين فاتورة المشتريات ومردود المشتريات (`?kind=purchase_return`):**
   - إضافة مطابقة واعية بمعاملات الاستعلام ومسار الوحدة (`scoreNavItemMatch` و`resolveActiveSidebarKey` و`findScreenForPath`) في `apps/staff/lib/navigation.ts` وربطها عبر `SearchParamsBridge` في `apps/staff/components/app-shell.tsx`: عند فتح `/purchases/invoices/new` يُميَّز رابط **«فاتورة المشتريات»** فقط، وعند فتح `/purchases/invoices/new?kind=purchase_return` يُميَّز رابط **«مردود المشتريات»** فقط (مع إصلاح جميع الروابط الاستعلامية المتجاورة).
   - تحديث `apps/staff/app/purchases/invoices/new/page.tsx` لقراءة ومزامنة `?kind=purchase_return` عبر `useSearchParams()` وتحديث عنوان الشاشة وخيار الفاتورة المرجعية والرابط تلقائياً.
5. **البند 5 — إعادة تصميم شاشة الكاشير (`/sales/pos`) وفواتير المبيعات والمشتريات ومردود المشتريات بلا تمرير أفقي أو سفلي:**
   - إعادة بناء جدول الأصناف المشترك `InvoiceLines` في `apps/staff/components/invoice-editor.tsx` بـ 8 أعمدة مضبوطة النسب (`table-layout: fixed; width: 100%`) ليظهر زر **«حذف»** الأحمر في أقصى اليسار دائماً بلا أي شريط تمرير أفقي، مع طيّ الحقول الاختيارية للسطر (`رقم الدفعة`، `الأرقام التسلسلية`، `مركز التكلفة`) داخل زر **«تفاصيل ▾»** مدمج.
   - دمج حقول رأس الفاتورة في لوحة واحدة مدمجة قابلة لطيّ الخيارات الثانوية، وإضافة شريط سفلي ثابت `StickyInvoiceBar` يعرض الإجماليات الخمسة حيّةً بجانب أزرار **«حفظ وترحيل»** و**«حفظ وترحيل + طباعة»** و**«حفظ كمسودة»** في `sales/invoices/new` و`purchases/invoices/new`.
   - إعادة تنظيم عمود **«الفاتورة الحالية»** في `apps/staff/app/sales/pos/page.tsx` بجدول سلة خالٍ من التمرير الأفقي وزر حذف مباشر، وشريط عميل/خصم مدمج قابل للتوسيع، وتثبيت شريط الإجمالي وزر **«إتمام البيع»** أسفل اللوحة ليبقى ظاهراً دائماً دون النزول لأسفل الصفحة.
   - **الاختبارات الآلية وفحص الأنواع:** `tsc --noEmit` و`eslint` بلا أخطاء، و`106 / 106` اختبار ناجح في `@erp/staff` (شاملاً اختبارات التمييز بين فاتورة المشتريات ومردود المشتريات).

### المرحلة 3 — مكتملة (`Item 6`)
6. **البند 6 — جلب `apps/android-bakery` و`apps/android-rep` من `arena/51e2c443-erp-cloud` والمطابقة الشاملة مالياً وبرمجياً:**
   - استيراد مساري `apps/android-bakery` و`apps/android-rep` **فقط** من `origin/arena/51e2c443-erp-cloud` دون المساس بأي ملف آخر على `arena/4c98c7f3-erp-cloud`.
   - التحقق الآلي من تطابق **`147 / 147`** مسار Retrofit في `BakeryApi.kt` و**`24 / 24`** مسار في `RepApi.kt` مع وحدات الخادم (`@erp/api`) بنسبة خطأ **`0%`**، وتطابق عنوان الإنتاج `https://api.sahabaccounting.com/api/v1/` مع إعدادات Nginx وبيئة السحابة.
   - **إصلاح 7 فجوات حرجة تم اكتشافها أثناء الفحص المعمّق:**
     1. **حماية `minSdk = 24` وتوقيت مكة المكرمة (`Asia/Riyadh`):** إضافة أداة `MakkahTime.kt` في كلا التطبيقين وإزالة جميع استدعاءات `java.time.*` (التي تتطلب API 26+) وتنسيقات `SimpleDateFormat` / `Calendar` المعتمدة على توقيت الجهاز عبر **14 ملفاً** (`AppViewModel.kt`, `Common.kt`, `Charts.kt`, `CashBoxesScreen.kt`, `PayrollScreen.kt`, `PrintersScreen.kt`, `InventoryScreen.kt`, `ProductionScreen.kt`, `PosScreen.kt`, `EmployeeAccountScreen.kt`, `SystemReportsScreen.kt`, `BakeryDocs.kt`, `QueueStore.kt`, `WorkspaceScreen.kt`).
     2. **التوافق المحاسبي لخصم السطر (`ACC-061` طريقة الصافي) ومراكز التكلفة (`ACC-053`):** تحديث `StaffDtos.kt` و`PurchasesScreen.kt` و`SalesInvoicesScreen.kt` لإدخال وحفظ `discountRate` (`خصم %`) و`costCenterId` و`description` عند تحرير المسودات وعند استرجاع سطور فواتير المشتريات والمبيعات المرحّلة في المرتجعات، وتمرير `discountRate` إلى `Dec.previewInvoiceTotals` لتطابق معاينة الصافي والضريبة والإجمالي حسابات الخادم حرفياً.
     3. **تصفية صناديق النقد والبنوك (`CashLocationDto.kind`):** إصلاح شرط التصفية الخاطئ `it.kind == "cash"` (حيث يرسل الخادم `'safe' | 'bank'`) إلى `if (method == "cash") it.kind != "bank" else it.kind == "bank"` في حوارات ترحيل وسداد فواتير المبيعات والمشتريات.
     4. **معالجة فواصل الآلاف في `android-rep` (`Dec.normalizeDigits`):** مطابقة محلّل الأرقام في تطبيق المندوب مع تطبيق المخبز بحيث تُحذف فواصل الآلاف (`1,250.50` / `1,000,000`) بدلاً من تحويلها إلى نقاط عشرية مكررة ترفض الرقم.
     5. **طابع وقت رمز ZATCA QR بتوقيت مكة (`+03:00`):** تحديث `ZatcaQr.normalizeTimestamp` في `apps/android-bakery` لتحويل المسافة إلى `T` وإزالة أجزاء الثانية قبل `Z` أو إزاحة التوقيت `[+-]HH:MM` دون كسر طوابع وقت خادم `TZ=Asia/Riyadh`.
     6. **تعريب اسم المستودع الافتراضي:** تعريب أي تسمية موروثة (`Main branch` / `Main warehouse`) تلقائياً إلى **`المستودع الرئيسي`** في `BakeryDtos.kt` و`VanDtos.kt` و`ReceiptScreen.kt`.
     7. **ترجمة رموز الأخطاء المحاسبية الجديدة (`ErrorsAr.kt`):** إضافة رسائل عربية واضحة لرموز `SALES_SETTLEMENT_ACCOUNT_INVALID`، `PURCHASE_SETTLEMENT_ACCOUNT_INVALID`، `OPENING_ENTRY_UNBALANCED`، `PURCHASE_RETURN_QTY_EXCEEDED`، `PURCHASE_RETURN_PRICE_EXCEEDED`، `RETURN_QTY_EXCEEDED`، `PAYMENT_EXCEEDS_DUE`، و`FISCAL_PERIOD_CLOSED` في كلا التطبيقين.
   - **الاختبارات التعاقدية المضافة:** `apps/api/test/android-apps-contract.spec.ts` (`5 / 5` اختبارات ناجحة تتحقق آلياً من المسارات الـ 171، وتوقيت مكة، وخلوّ `107` ملفات Kotlin من `java.time` والأقواس غير المتوازنة، وتوافق `ACC-061`/`ACC-053`).

