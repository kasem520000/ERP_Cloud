package com.erpcloud.bakery.ui.screens

import com.erpcloud.bakery.ui.components.ChipTone

/**
 * تسمياتُ الخادم بالعربيّة — القاعدةُ: ما لم يعرفه التطبيق يُعرض خامًا كما
 * جاء (لا تسميةً مُختلَعة)، فالخادمُ مصدرُ الحقيقة ولا تُترجَم قيمةٌ غامضة
 * إلى ما ليست هي.
 */
object Labels {

    /** حالةُ أمر التحميل — من CHECK الخادم و`van_load_orders.status`. */
    fun loadStatus(status: String): Pair<String, ChipTone> = when (status) {
        "pending_receipt" -> "بانتظار الاستلام" to ChipTone.WARN
        "loaded" -> "مُحمَّل" to ChipTone.INFO
        "in_route" -> "في الطريق" to ChipTone.INFO
        "pending_closing" -> "بانتظار الإقفال" to ChipTone.WARN
        "pending_stock_settlement" -> "بانتظار تسوية المخزون" to ChipTone.WARN
        "settled" -> "مُسوّاة" to ChipTone.OK
        "cancelled" -> "ملغاة" to ChipTone.NEUTRAL
        else -> status to ChipTone.NEUTRAL
    }

    /** حالةُ دفعة الإنتاج. */
    fun batchStatus(status: String): Pair<String, ChipTone> = when (status) {
        "active" -> "نشطة" to ChipTone.OK
        "exhausted" -> "مستنفدة" to ChipTone.NEUTRAL
        "closed" -> "مغلقة" to ChipTone.NEUTRAL
        else -> status to ChipTone.NEUTRAL
    }

    /** أساسُ تكلفة الدفعة كما يكتبه الخادم (`cost_basis` بعد التخطيط). */
    fun costBasis(basis: String): String = when (basis) {
        "manufacturing_order" -> "أمرُ تصنيعٍ رسميّ"
        "manual_input_or_item_cost" -> "إدخالٌ يدويّ/تكلفةُ البطاقة"
        "manual_input" -> "إدخالٌ يدويّ"
        "item_cost" -> "تكلفةُ بطاقة الصنف"
        else -> basis.ifBlank { "—" }
    }

    /** أساسُ تقييم العجز في السياسة. */
    fun shortageBasis(basis: String): String = when (basis) {
        "unconfigured" -> "غير مضبوطة"
        "unit_cost" -> "بالتكلفة"
        "selling_price" -> "بسعر البيع"
        else -> basis
    }

    /** مصدرُ التقييم الفعليّ في السياسة (`valuationSource`). */
    fun valuationSource(source: String): String = when (source) {
        "explicit_policy_price" -> "سعرٌ صريحٌ في السياسة"
        "unit_cost" -> "بالتكلفة"
        "selling_price" -> "بسعر البيع"
        "unconfigured" -> "غير مضبوطة"
        else -> source
    }

    /** نوعُ المستند. */
    fun documentKind(kind: String): Pair<String, ChipTone> = when (kind) {
        "sale" -> "فاتورة بيع" to ChipTone.INFO
        "return", "sale_return" -> "مردود مبيعات" to ChipTone.WARN
        "credit_note" -> "إشعار دائن" to ChipTone.INFO
        "debit_note" -> "إشعار مدين" to ChipTone.WARN
        "quotation" -> "عرض سعر" to ChipTone.NEUTRAL
        else -> kind to ChipTone.NEUTRAL
    }

    /** طريقةُ الدفع. */
    fun paymentMethod(method: String): String = when (method) {
        "cash" -> "نقد"
        "card" -> "شبكة"
        "credit" -> "آجل"
        else -> method.ifBlank { "—" }
    }

    /** وضعُ الفاتورة. */
    fun invoiceMode(mode: String): String = when (mode) {
        "zatca_tax" -> "فاتورة ضريبيّة"
        "internal_delivery" -> "تسليمٌ داخليّ"
        else -> mode.ifBlank { "—" }
    }

    /** حالةُ تسوية المخزون. */
    fun stockSettlement(status: String): String = when (status) {
        "not_required" -> "لا تلزم"
        "pending_transit_decision" -> "بانتظار قرار فرق العبور"
        "pending" -> "معلّقة"
        "posted" -> "مُرحَّلة"
        else -> status
    }

    /** قرارُ فرق العبور. */
    fun transitMode(mode: String): String = when (mode) {
        "return" -> "إرجاعٌ إلى المصدر"
        "shortage" -> "عجزُ تحويل"
        else -> mode
    }

    /** مصيرُ المتبقّي بعد الجرد. */
    fun remainingAction(action: String): String = when (action) {
        "return_to_main" -> "إعادةٌ إلى المستودع الرئيسيّ"
        "carry_over" -> "يبقى في السيارة (عهدةٌ قائمة)"
        else -> action
    }

    /** نوعُ الحركة (حركات البضاعة في اللوحة). */
    fun movementType(type: String): String = when (type) {
        "load" -> "تحميل"
        "sale" -> "بيع"
        "bonus" -> "مجاني"
        "return" -> "مرتجع"
        "damage" -> "تالف"
        "shortage" -> "عجز"
        "count_settlement" -> "تسوية جرد"
        else -> type
    }

    /** تاريخٌ YYYY-MM-DD كما جاء — للعرض بلا تحويل (البساطةُ أوضح من إعادة التهيئة). */
    fun dateOrDash(value: String?): String = value?.takeIf { it.isNotBlank() } ?: "—"

    // ---------------------------------------------------- تسمياتُ وحدات «الطاقم»

    /** نوعُ السند المخزنيّ — كما في `VOUCHER_KIND_LABELS` عند الخادم. */
    fun voucherKind(kind: String): String = when (kind) {
        "opening" -> "بضاعة أول المدة"
        "stock_in" -> "سند إدخال مخزني"
        "stock_out" -> "سند إخراج مخزني"
        else -> kind
    }

    /** حالةُ مستندٍ (مسودة/مرحّل/ملغى…) — تُعرض خامًا إن جهلت. */
    fun docStatus(status: String): Pair<String, ChipTone> = when (status) {
        "draft" -> "مسودة" to ChipTone.WARN
        "posted" -> "مرحّلة" to ChipTone.OK
        "paid" -> "مدفوعة" to ChipTone.OK
        "void", "voided", "cancelled" -> "ملغاة" to ChipTone.DANGER
        "pending" -> "بانتظار الاعتماد" to ChipTone.WARN
        "approved" -> "معتمدة" to ChipTone.OK
        "active" -> "نشطة" to ChipTone.OK
        "suspended" -> "موقوفة" to ChipTone.WARN
        "terminated" -> "منتهية" to ChipTone.DANGER
        "reversed" -> "معكوسة" to ChipTone.DANGER
        else -> status to ChipTone.NEUTRAL
    }

    /** نوعُ فاتورة المشتريات. */
    fun purchaseKind(kind: String): String = when (kind) {
        "purchase" -> "مشتريات"
        "purchase_return" -> "مردود مشتريات"
        else -> kind
    }

    /** إضافةٌ أم استقطاعٌ في المنصرفات. */
    fun adjustmentKind(kind: String): String = when (kind) {
        "addition" -> "إضافة"
        "deduction" -> "استقطاع"
        else -> kind
    }

    /** طريقةُ دفع الرواتب ونقطة البيع. */
    fun payMethod(method: String?): String = when (method) {
        "cash" -> "نقدي"
        "card" -> "شبكة"
        "bank", "bank_transfer" -> "تحويل بنكي"
        "cheque" -> "شيك"
        "credit" -> "آجل"
        "split" -> "متعدّد"
        else -> method ?: "—"
    }

    /** حالةُ العضويّة. */
    fun membershipStatus(status: String): Pair<String, ChipTone> = when (status) {
        "active" -> "نشط" to ChipTone.OK
        "invited" -> "مدعوّ" to ChipTone.INFO
        "suspended" -> "موقوف" to ChipTone.WARN
        "removed" -> "مزال" to ChipTone.DANGER
        else -> status to ChipTone.NEUTRAL
    }

    /** نوعُ سند الخزينة — قبضٌ أم صرف. */
    fun voucherFlow(kind: String): Pair<String, ChipTone> = when (kind) {
        "receipt" -> "سند قبض" to ChipTone.OK
        "payment" -> "سند صرف" to ChipTone.WARN
        else -> kind to ChipTone.NEUTRAL
    }

    /** تصنيفُ سند الخزينة — من أين/إلى أين المال. */
    fun voucherSubtype(subtype: String): String = when (subtype) {
        "customer" -> "عميل"
        "supplier" -> "مورّد"
        "expense" -> "مصروف"
        "account" -> "حساب"
        "salary" -> "راتب"
        "vat" -> "ضريبة"
        "other" -> "أخرى"
        else -> subtype
    }

    /** طريقةُ السند — نفسَ طرق الدفع مع الشيك والتحويل. */
    fun voucherMethod(method: String?): String = when (method) {
        "bank_transfer" -> "تحويل بنكي"
        "cheque" -> "شيك"
        else -> payMethod(method)
    }

    /** مستندُ حركة المخزون — كما في `docType` عند الخادم. */
    fun movementDoc(docType: String?): String = when (docType) {
        "purchase_invoice" -> "فاتورة مشتريات"
        "purchase_return" -> "مردود مشتريات"
        "purchase_void" -> "إبطال فاتورة مشتريات"
        "sales_invoice" -> "فاتورة مبيعات"
        "sales_return" -> "مردود مبيعات"
        "sales_void" -> "إبطال فاتورة مبيعات"
        "pos_sale" -> "بيعة نقطة بيع"
        "stock_voucher" -> "سند مخزني"
        "stock_voucher_void" -> "إبطال سند مخزني"
        "production" -> "إنتاج"
        "production_order" -> "أمر إنتاج"
        "factory_production_batch" -> "دفعة إنتاج"
        "load_order" -> "أمر تحميل"
        "van_load_order" -> "أمر تحميل مندوب"
        "van_return" -> "مرتجع مندوب"
        "van_sales_return_doc" -> "سند مرتجع مبيعات"
        "van_damage_writeoff" -> "إتلاف عجز مندوب"
        "transfer" -> "تحويل مستودع"
        "stock_transfer" -> "تحويل مخزني"
        "stock_transfer_receipt" -> "استلام تحويل مخزني"
        "stock_transfer_cancel" -> "إلغاء تحويل مخزني"
        "stock_transfer_return" -> "مرتجع تحويل مخزني"
        "stock_adjustment" -> "تسوية جرد"
        "adjustment" -> "تسوية جرد"
        "allocation" -> "تخصيص"
        "stock_delivery" -> "تسليم مخزني"
        "goods_request" -> "طلب بضاعة"
        "bin_count" -> "جرد صندوق"
        "bin_issue" -> "صرف من صندوق"
        "bin_receipt" -> "إيداع في صندوق"
        "cash_transfer" -> "مناقلة نقدية"
        "journal_entry" -> "قيد يومية"
        "shift_close" -> "إقفال وردية"
        "quotation" -> "عرض سعر"
        "installment_contract" -> "عقد تقسيط"
        "contractor_contract" -> "عقد مقاول"
        "contractor_payment" -> "دفععة مقاول"
        "contracting_return" -> "مرتجع تعاقد"
        "progress_bill" -> "مستخلص"
        "project_offer" -> "عرض مشروع"
        "supplier_rfq" -> "طلب عروض مورد"
        "manufacturing_order" -> "أمر تصنيع"
        "tailoring_order" -> "أمر خياطة"
        "tailoring_invoice" -> "فاتورة خياطة"
        "marina_booking" -> "حجز مرسى"
        "marina_violation" -> "مخالفة مرسى"
        else -> docType ?: "—"
    }

    /** مجموعةُ التقرير كما في فهرس التقارير. */
    fun reportGroup(group: String): String = when (group) {
        "sales" -> "المبيعات"
        "purchases" -> "المشتريات"
        "inventory" -> "المخزون"
        "accounting" -> "المحاسبة"
        "pos" -> "نقطة البيع"
        "hrm" -> "الموارد البشريّة"
        "marina" -> "المراسي"
        "projects" -> "المشاريع"
        "zatca" -> "الفاتورة الإلكترونيّة"
        else -> group
    }

    // ------------------------------------------------ أسماءُ الأذونات بالعربية

    /** اسمُ الإذن بالعربية — والصنفُ الذي ينتمي إليه. */
    fun permission(code: String): String = PERMISSION_NAMES[code] ?: code

    /** تصنيفُ الإذن (الوحدة) بالعربية. */
    fun permissionModule(code: String): String {
        val module = code.substringBefore('.')
        return PERMISSION_MODULES[module] ?: module
    }

    private val PERMISSION_NAMES = mapOf(
            "accounting.account.manage" to "إدارة دليل الحسابات",
            "accounting.account.view" to "عرض دليل الحسابات",
            "accounting.costcenter.manage" to "مراكز التكلفة",
            "accounting.journal.create" to "إنشاء القيود اليومية",
            "accounting.journal.post" to "ترحيل القيود",
            "accounting.journal.reverse" to "عكس القيود",
            "accounting.opening.manage" to "قيود الأرصدة الافتتاحية",
            "accounting.period.close" to "إقلاق الفترات المالية",
            "accounting.period.reopen" to "إعادة فتح الفترات",
            "accounting.period.view" to "عرض الفترات المالية",
            "accounting.reports.view" to "التقارير المالية",
            "ai.assistant.use" to "استخدام المساعد الذكي",
            "ai.settings.manage" to "إعدادات الذكاء الاصطناعي",
            "approval.approve" to "اعتماد الطلبات",
            "approval.manage" to "إدارة طلبات الاعتماد",
            "catalog.category.manage" to "إدارة المجموعات",
            "catalog.category.view" to "عرض المجموعات",
            "catalog.import.execute" to "استيراد الكتالوج",
            "catalog.item.manage" to "إدارة الأصناف",
            "catalog.item.view" to "عرض الأصناف",
            "catalog.price.manage" to "قوائم الأسعار",
            "catalog.taxgroup.manage" to "إدارة مجموعات الضريبة",
            "catalog.taxgroup.view" to "عرض مجموعات الضريبة",
            "catalog.unit.manage" to "إدارة وحدات القياس",
            "catalog.unit.view" to "عرض وحدات القياس",
            "comment.manage" to "إدارة التعليقات",
            "comment.view" to "قراءة التعليقات",
            "compat.manage" to "إدارة التزامن القديم",
            "compat.sync" to "مزامنة النظام القديم",
            "compat.view" to "التوافق مع النسخة القديمة",
            "console.activation.review" to "المنصة — مراجعة التنشيط",
            "console.apikeys.manage" to "المنصة — مفاتيح API",
            "console.audit.view" to "المنصة — التدقيق",
            "console.billing.manage" to "المنصة — الفوترة",
            "console.content.view" to "المنصة — المحتوى",
            "console.email.manage" to "المنصة — البريد",
            "console.email.view" to "المنصة — سجلّ البريد",
            "console.health.view" to "المنصة — الصحة",
            "console.jobs.view" to "المنصة — المهامّ",
            "console.leads.view" to "المنصة — العملاء المحتملون",
            "console.marketplace.manage" to "المنصة — المتجر",
            "console.plans.manage" to "المنصة — الخطط",
            "console.subscriptions.manage" to "المنصة — الاشتراكات",
            "console.support.manage" to "المنصة — الدعم",
            "console.tenants.manage" to "المنصة — إدارة المستأجرين",
            "console.tenants.view" to "المنصة — عرض المستأجرين",
            "console.users.manage" to "المنصة — إدارة المستخدمين",
            "console.users.view" to "المنصة — عرض المستخدمين",
            "crm.activities.manage" to "أنشطة العملاء",
            "crm.deals.manage" to "إدارة الفرص البيعية",
            "crm.deals.view" to "عرض الفرص البيعية",
            "custom_fields.manage" to "إدارة الحقول المخصصة",
            "custom_fields.view" to "عرض الحقول المخصصة",
            "custom_reports.manage" to "التقارير المخصصة — إدارة",
            "custom_reports.view" to "التقارير المخصصة — عرض",
            "dashboards.manage" to "إدارة اللوحات",
            "dashboards.view" to "عرض اللوحات",
            "ecommerce.manage" to "إدارة المتجر الإلكتروني",
            "einvoice.credentials.manage" to "بيانات اعتماد الفوترة",
            "einvoice.manage" to "إدارة الفاتورة الإلكترونية",
            "einvoice.submit" to "إرسال الفواتير لهيئة الزكاة",
            "einvoice.view" to "عرض الفاتورة الإلكترونية",
            "employee.self.manage" to "الخدمة الذاتية — تعديل",
            "employee.self.view" to "الخدمة الذاتية — عرض",
            "employee.team.approve" to "اعتماد فريق العمل",
            "esign.manage" to "التوقيع الإلكتروني",
            "fitment.manage" to "إدارة التركيبات",
            "fitment.view" to "عرض التركيبات",
            "hrm.adjust.approve" to "اعتماد المنصرفات",
            "hrm.manage" to "إدارة الموظفين والمنصرفات",
            "hrm.payroll.post" to "ترحيل وصرف الرواتب",
            "hrm.view" to "عرض الموظفين",
            "installments.collect" to "تحصيل الأقساط",
            "installments.manage" to "إدارة الأقساط",
            "installments.view" to "عرض الأقساط",
            "inventory.adjust" to "سندات الإدخال والإخراج",
            "inventory.adjust.approve" to "اعتماد تسويات الجرد",
            "inventory.bins.manage" to "إدارة المواقع والرفوف",
            "inventory.delivery.manage" to "أوامر التسليم",
            "inventory.negative.override" to "السماح برصيد سالب",
            "inventory.production.complete" to "إتمام أوامر الإنتاج المخزنية",
            "inventory.production.manage" to "أوامر الإنتاج المخزنية",
            "inventory.request.approve" to "اعتماد طلبات الصرف",
            "inventory.request.manage" to "طلبات الصرف",
            "inventory.transfer" to "مناقلة بين المستودعات",
            "inventory.transfer.receive" to "استلام المناقلات",
            "inventory.view" to "عرض المخزون",
            "manufacturing.manage" to "إدارة التصنيع",
            "manufacturing.produce" to "تسجيل إنتاج التصنيع",
            "manufacturing.view" to "عرض التصنيع",
            "marina.invoice" to "فواتير المراسي",
            "marina.manage" to "إدارة المراسي",
            "marina.view" to "عرض المراسي",
            "migration.run.execute" to "تنفيذ الترحيل",
            "migration.run.import" to "استيراد البيانات القديمة",
            "migration.view" to "عرض أدوات الترحيل",
            "optics.manage" to "إدارة البصريات",
            "optics.view" to "عرض البصريات",
            "organization.branch.manage" to "إدارة الفروع",
            "organization.branch.view" to "عرض الفروع",
            "organization.cashlocation.manage" to "إدارة الخزائن والبنوك",
            "organization.cashlocation.view" to "عرض الخزائن والبنوك",
            "organization.companyprofile.manage" to "تعديل ملف المنشأة",
            "organization.companyprofile.view" to "عرض ملف المنشأة",
            "organization.currency.manage" to "إدارة العملات",
            "organization.currency.view" to "عرض العملات",
            "organization.postingprofile.manage" to "إدارة ملفات الترحيل",
            "organization.postingprofile.view" to "عرض ملفات الترحيل",
            "organization.priceList.manage" to "إدارة قوائم الأسعار",
            "organization.priceList.view" to "عرض قوائم الأسعار",
            "organization.warehouse.manage" to "إدارة المستودعات",
            "organization.warehouse.view" to "عرض المستودعات",
            "parties.allocate" to "تخصيص السداد على الفواتير",
            "parties.creditlimit.override" to "تجاوز حدود الائتمان",
            "parties.manage" to "إدارة العملاء والموردين",
            "parties.view" to "عرض العملاء والموردين",
            "payments.links.manage" to "ربط المدفوعات",
            "payroll.wps.export" to "تصدير ملف رواتب WPS",
            "platform.audit.view" to "سجلّ التدقيق (تهجئة قديمة)",
            "platform.file.upload" to "رفع الملفات (تهجئة قديمة)",
            "platform.job.view" to "مراقبة المهامّ (تهجئة قديمة)",
            "platform.membership.manage" to "إدارة المستخدمين (تهجئة قديمة)",
            "platform.notification.manage" to "إنشاء الإشعارات (تهجئة قديمة)",
            "platform.notification.view" to "قراءة الإشعارات (تهجئة قديمة)",
            "platform.role.manage" to "إدارة الأدوار (تهجئة قديمة)",
            "platform.settings.manage" to "إعدادات المنشأة (تهجئة قديمة)",
            "platform.tenant.manage" to "تعديل بيانات المنشأة (تهجئة قديمة)",
            "platform.tenant.view" to "عرض بيانات المنشأة (تهجئة قديمة)",
            "pos.config.manage" to "إعدادات نقطة البيع",
            "pos.operate" to "البيع من نقطة البيع",
            "pos.priceoverride" to "تجاوز سعر نقطة البيع",
            "pos.tables.manage" to "طاولات نقطة البيع",
            "pos.view" to "عرض نقطة البيع",
            "projects.bill.post" to "ترحيل مستحقات المشاريع",
            "projects.contractor.pay" to "صرف مستحقات المتعاقدين",
            "projects.manage" to "إدارة المشاريع",
            "projects.stage.accredit" to "اعتماد مراحل المشاريع",
            "projects.tasks.manage" to "إدارة مهامّ المشاريع",
            "projects.tasks.view" to "عرض مهامّ المشاريع",
            "projects.time_logs.manage" to "سجلات الوقت",
            "projects.view" to "عرض المشاريع",
            "purchase.adjustment.create" to "تسويات المشتريات",
            "purchase.cost.manage" to "التكاليف الإضافية للشحن",
            "purchase.invoice.create" to "إنشاء فواتير الشراء",
            "purchase.invoice.pay" to "سداد فواتير الشراء",
            "purchase.invoice.post" to "ترحيل فواتير الشراء",
            "purchase.invoice.void" to "إلغاء فواتير الشراء",
            "purchase.ocr.use" to "قارئ الفواتير بالصور (OCR)",
            "purchase.view" to "عرض المشتريات",
            "reporting.export.execute" to "تصدير التقارير",
            "reporting.layout.manage" to "تخطيطات التقارير",
            "reporting.view" to "عرض التقارير",
            "sales.adjustment.create" to "تسويات أسعار البيع",
            "sales.discount.override" to "تجاوز حدود الخصم",
            "sales.invoice.create" to "إنشاء فواتير البيع",
            "sales.invoice.pay" to "تسجيل سداد الفواتير",
            "sales.invoice.post" to "ترحيل فواتير البيع",
            "sales.invoice.void" to "إلغاء فواتير البيع",
            "sales.offer.create" to "عروض الأسعار",
            "sales.offer.manage" to "إدارة عروض الأسعار",
            "sales.return.create" to "إنشاء مرتجعات البيع",
            "sales.salesman.manage" to "إدارة مناديب المبيعات",
            "sales.view" to "عرض المبيعات",
            "salla.integration.manage" to "إدارة تكامل سلا",
            "salla.integration.view" to "عرض تكامل سلا",
            "settings.backup.manage" to "النسخ الاحتياطية",
            "settings.companyfile.create" to "ملف الشركة",
            "settings.maintenance.manage" to "الصيانة",
            "settings.restore.manage" to "استعادة النسخ الاحتياطية",
            "settings.rotation.manage" to "تدوير البيانات",
            "supplier_portal.access" to "بوابة الموردين",
            "tailoring.manage" to "إدارة الخياطة",
            "tailoring.view" to "عرض الخياطة",
            "tenant.apps.manage" to "تطبيقات المتجر والعلامة التجارية",
            "tenant.audit.view" to "سجلّ التدقيق",
            "tenant.device.manage" to "إدارة الأجهزة وبياناتها",
            "tenant.device.view" to "عرض الأجهزة المسجَّلة",
            "tenant.email.log.view" to "سجلّ البريد المرسَل",
            "tenant.email.template.manage" to "قوالب البريد الإلكتروني",
            "tenant.file.manage" to "حذف الملفات",
            "tenant.file.upload" to "رفع الملفات",
            "tenant.job.view" to "مراقبة مهامّ الخلفية",
            "tenant.manage" to "تعديل بيانات المنشأة",
            "tenant.membership.manage" to "إدارة المستخدمين والعضويّات",
            "tenant.notification.manage" to "إنشاء الإشعارات للآخرين",
            "tenant.notification.view" to "قراءة الإشعارات",
            "tenant.role.manage" to "إدارة الأدوار والصلاحيات",
            "tenant.settings.manage" to "إعدادات المنشأة",
            "tenant.view" to "عرض بيانات المنشأة",
            "treasury.bank.manage" to "إدارة الحسابات البنكية",
            "treasury.bank.view" to "عرض الحسابات البنكية",
            "treasury.cheque.clear" to "تسوية الشيكات",
            "treasury.expensetype.manage" to "أنواع المصروفات",
            "treasury.shift.close" to "إقفال ورديات الصندوق",
            "treasury.shift.post" to "ترحيل ورديات الصندوق",
            "treasury.transfer.manage" to "التحويلات بين الخزائن",
            "treasury.view" to "عرض الخزينة",
            "treasury.voucher.create" to "إنشاء السندات",
            "treasury.voucher.post" to "ترحيل السندات",
            "treasury.voucher.void" to "إلغاء السندات",
            "van_sales.closing.approve" to "اعتماد الإقفال والتسويات",
            "van_sales.closing.submit" to "إقفال ورديات المندوبين",
            "van_sales.collection.create" to "تسجيل تحصيل النقد",
            "van_sales.invoice.create" to "إنشاء مستندات البيع للمندوب",
            "van_sales.load.manage" to "إدارة أوامر التحميل",
            "van_sales.override.approve" to "اعتماد التجاوزات وسياسة العجز",
            "van_sales.pricing.manage" to "أسعار العملاء والبونص",
            "van_sales.production.manage" to "إدارة دفعات الإنتاج",
            "van_sales.view" to "عرض وحدات التوزيع",
    )

    private val PERMISSION_MODULES = mapOf(
            "accounting" to "المحاسبة",
            "ai" to "الذكاء الاصطناعي",
            "approval" to "الاعتمادات",
            "catalog" to "الكتالوج",
            "comment" to "التعليقات",
            "compat" to "التوافق",
            "console" to "منصة SaaS",
            "crm" to "علاقات العملاء",
            "custom_fields" to "حقول مخصصة",
            "custom_reports" to "تقارير مخصصة",
            "dashboards" to "اللوحات",
            "ecommerce" to "التجارة الإلكترونية",
            "einvoice" to "الفوترة الإلكترونية",
            "employee" to "الموظف",
            "esign" to "التوقيع",
            "fitment" to "التركيبات",
            "hrm" to "الموارد البشريّة",
            "installments" to "الأقساط",
            "inventory" to "المخزون",
            "manufacturing" to "التصنيع",
            "marina" to "المراسي",
            "migration" to "الترحيل",
            "optics" to "البصريات",
            "organization" to "التنظيم",
            "parties" to "الأطراف",
            "payments" to "المدفوعات",
            "payroll" to "الرواتب",
            "platform" to "المنصة",
            "pos" to "نقطة البيع",
            "projects" to "المشاريع",
            "purchase" to "المشتريات",
            "reporting" to "التقارير",
            "sales" to "المبيعات",
            "salla" to "تكامل سلا",
            "settings" to "الإعدادات",
            "supplier_portal" to "بوابة الموردين",
            "tailoring" to "الخياطة",
            "tenant" to "المنشأة",
            "treasury" to "الخزينة",
            "van_sales" to "التوزيع",
    )
}
