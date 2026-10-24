package com.erpcloud.bakery.data.api

import java.util.Locale

/**
 * ترجمةُ رموزِ أخطاءِ الخادم إلى عربيّةٍ يقرؤها المستخدم — متزامنةٌ مع
 * `packages/contracts/src/errors-ar.ts` شاملةً تحديثات R19–R34.
 */
object ErrorsAr {

    private val map: Map<String, String> = buildMap {
        // ------------------------------------------------ الهوية والصلاحيات
        put("UNAUTHENTICATED", "انتهت الجلسة — سجّل الدخول من جديد.")
        put("INVALID_CREDENTIALS", "البريدُ الإلكترونيّ أو كلمةُ المرور أو رمزُ المنشأة غير صحيح.")
        put("ACCOUNT_LOCKED", "الحسابُ مقفَلٌ مؤقّتًا لكثرة المحاولات — انتظر قليلًا ثم أعد المحاولة.")
        put("MFA_REQUIRED", "هذا الحسابُ يتطلّب رمز التحقّق الثنائيّ (MFA).")
        put("MFA_INVALID", "رمزُ التحقّق الثنائيّ غير صحيح أو منتهي الصلاحيّة.")
        put("PASSWORD_TOO_WEAK", "كلمةُ المرور ضعيفة — لا تقلّ عن ١٢ حرفًا وتجمع ٣ فئاتٍ على الأقل.")
        put("PASSWORD_REUSED", "لا يمكن إعادةُ استخدام كلمة مرورٍ سابقة.")
        put("TENANT_SUSPENDED", "اشتراكُ المنشأة موقوفٌ حاليًّا — تواصل مع إدارة المنصّة.")
        put("FORBIDDEN", "حسابُك لا يحمل الإذنَ اللازم لهذا الإجراء.")
        put("VALIDATION_FAILED", "بياناتٌ ناقصةٌ أو غير صالحة — راجع الحقول المطلوبة.")
        put("VERSION_CONFLICT", "غيّر مستخدمٌ آخر نفس السجل — حدّث الصفحة ثم أعد المحاولة.")
        put("CONFLICT", "تعارضٌ مع سجلٍّ قائم — راجع البيانات أو حدّث الشاشة.")
        put("DUPLICATE_CODE", "الرمزُ مستخدمٌ مسبقًا لسجلٍّ آخر.")
        put("NOT_FOUND", "السجلُ المطلوب غير موجود (أو حُذف).")
        put("RATE_LIMITED", "طلباتٌ متتابعةٌ كثيرة — انتظر لحظاتٍ ثم أعد المحاولة.")
        put("INTERNAL", "عطلٌ داخليٌّ في الخادم — أعد المحاولة، وإن تكرر فأبلغ الدعم.")

        // ------------------------------------------------ نقطة البيع
        put("POS_CART_EMPTY", "السلّةُ فارغة — أضف صنفًا واحدًا على الأقل.")
        put("POS_LINE_ITEM_REQUIRED", "كلُّ سطرٍ في السلّة يحتاج صنفًا.")
        put("POS_LINE_QUANTITY_INVALID", "كميّاتُ السلّة يجب أن تكون أكبر من صفر.")
        put("POS_PAYMENT_METHOD_INVALID", "طريقةُ الدفع غير مدعومة.")
        put("POS_CREDIT_CUSTOMER_REQUIRED", "البيعُ الآجل يحتاج عميلًا مسجّلًا.")
        put("POS_TENDER_INVALID", "مبلغُ الدفع غير صالح — أدخل رقمًا موجبًا.")
        put("POS_INSUFFICIENT_CASH", "المبلغُ المسلَّم أقلُّ من إجمالي البيعة.")
        put("POS_TENDER_MISMATCH", "مجموعُ طرق الدفع لا يطابق إجماليَ البيعة.")
        put("POS_SHIFT_REQUIRED", "افتح ورديةَ الكاشير لهذا الفرع قبل البيع النقدي.")
        put("POS_SHIFT_INVALID", "ورديةُ الكاشير غير صالحة — افتح ورديةً جديدة.")
        put("POS_SHIFT_CLOSED", "ورديةُ الكاشير مغلقة — افتح ورديةً جديدة.")
        put("POS_SHIFT_BRANCH_MISMATCH", "ورديةُ الكاشير تخصُّ فرعًا آخر.")
        put("POS_VOID_REASON_REQUIRED", "إبطالُ البيعة يحتاج سببًا مكتوبًا.")
        put("POS_PRICE_OVERRIDE_FORBIDDEN", "تغييرُ السعر يحتاج إذنَ تجاوز السعر (pos.priceoverride).")
        put("DISCOUNT_LIMIT_EXCEEDED", "نسبةُ أو قيمةُ الخصم تتجاوز السقف المسموح لحسابك.")
        put("SALES_WAREHOUSE_REQUIRED", "اختر المستودعَ الذي تُصرفُ منه الأصناف.")
        put("CASH_LOCATION_REQUIRED", "اختر الخزينةَ التي تستلمُ أو تصرفُ المبلغ.")
        put("CASH_LOCATION_NOT_FOUND", "الخزينةُ المختارة غير موجودة.")

        // ------------------------------------------------ المبيعات والذمم والائتمان (R33–R34)
        put("SALES_LINES_REQUIRED", "أضف سطرًا واحدًا على الأقلّ للفاتورة.")
        put("SALES_CUSTOMER_REQUIRED", "حدّد عميلًا من السجلّ أو اسمًا نقديًّا.")
        put("SALES_INVOICE_NOT_FOUND", "الفاتورةُ غير موجودة.")
        put("SALES_INVOICE_INVALID_STATUS", "حالةُ الفاتورة لا تسمح بهذا الإجراء.")
        put("SALES_INVOICE_NOT_POSTED", "الفاتورةُ غير مرحّلة — رحّلها أولًا.")
        put("SALES_TOTALS_INVALID", "إجمالياتُ الفاتورة لا تطابق سطورها — أعد الحفظ.")
        put("INVOICE_ALREADY_PAID", "الفاتورةُ مسدَّدةٌ بالكامل ولا تقبلُ تحصيلًا إضافيًّا.")
        put("INVOICE_HAS_RETURNS", "لا يمكن إبطالُ الفاتورة لوجود مرتجعٍ مرتبطٍ بها.")
        put("RETURN_QTY_EXCEEDED", "الكميّةُ المرتجعة تتجاوز المتاحَ للإرجاع من الفاتورة الأصليّة.")
        put("RETURN_PRICE_EXCEEDED", "سعرُ الوحدة في المرتجع يتجاوز سعر الفاتورة الأصليّة.")
        put("PARTY_CREDIT_HOLD", "هذا العميلُ موقوفٌ ائتمانيًّا — أزل الإيقاف الائتمانيّ من بطاقة العميل أو بِع نقدًا.")
        put("CREDIT_LIMIT_EXCEEDED", "تجاوزَ العميلُ سقفَ الائتمان المسموح له.")
        put("PAYMENT_AMOUNT_INVALID", "مبلغُ الدفعة غير صالح.")
        put("PAYMENT_EXCEEDS_DUE", "مبلغُ الدفعة يتجاوز المستحقَّ على الفاتورة.")
        put("ALLOCATION_AMOUNT_EXCEEDS_INVOICE_BALANCE", "مبلغُ التخصيص يتجاوز الرصيدَ المتبقّي على الفاتورة.")
        put("FISCAL_PERIOD_CLOSED", "الفترةُ المحاسبيّةُ لهذا التاريخ مقفلة.")
        put("ACCOUNT_NOT_POSTABLE", "الحسابُ المختار تجميعيٌّ غير قابلٍ للترحيل المباشر — اختر حسابًا فرعيًّا.")

        // ------------------------------------------------ المشتريات
        put("PURCHASE_LINES_REQUIRED", "أضف سطرًا واحدًا على الأقلّ لفاتورة الشراء.")
        put("PURCHASE_INVOICE_NOT_FOUND", "فاتورةُ الشراء غير موجودة.")
        put("PURCHASE_INVOICE_INVALID_STATUS", "حالةُ فاتورة الشراء لا تسمح بهذا الإجراء.")
        put("PURCHASE_INVOICE_IMMUTABLE", "فاتورةُ الشراء مرحّلة — لا تُعدَّل.")
        put("PURCHASE_INVOICE_NOT_POSTED", "فاتورةُ الشراء غير مرحّلة.")
        put("PURCHASE_RETURN_REFERENCE_REQUIRED", "اختر فاتورةَ الشراء المرحَّلة التي يُردُّ عليها المرتجع.")
        put("PURCHASE_COST_ACCOUNT_REQUIRED", "اختر الحسابَ المحاسبيَّ للكلفة.")
        put("PURCHASE_COST_INVALID", "قيمةُ الكلفة غير صالحة.")

        // ------------------------------------------------ الخزينة (شاملةً ACC-193)
        put("CHEQUE_NO_REQUIRED", "طريقةُ الشيك تحتاج رقمَ الشيك.")
        put("CHEQUE_INVALID_STATE", "حالةُ الشيك لا تسمح بهذا الإجراء.")
        put("VOUCHER_NOT_FOUND", "السندُ غير موجود.")
        put("VOUCHER_INVALID_STATUS", "حالةُ السند لا تسمح بهذا الإجراء.")
        put("VOUCHER_TIME_INVALID", "تاريخُ/وقتُ السند خارج النطاق المسموح.")
        put("VOUCHER_FOREIGN_AMOUNT_INVALID", "المبلغُ بالعملةِ الأجنبيّة غير صالح.")
        put("VOUCHER_VAT_INVALID", "ضريبةُ السند غير صالحة — يجب أن تكون موجبةً وأقلَّ من إجماليّ مبلغ السند.")
        put("VOUCHER_NET_AMOUNT_MISMATCH", "صافي السند لا يطابق (الإجمالي − الضريبة).")
        put("VOUCHER_COUNTER_ACCOUNT_REQUIRED", "اختر الحسابَ المقابل للسند.")
        put("VOUCHER_PARTY_REQUIRED", "اختر العميلَ أو المورّد للسند.")
        put("CASH_TRANSFER_AMOUNT_INVALID", "مبلغُ التحويل بين الخزائن غير صالح.")
        put("CASH_TRANSFER_INVALID", "بياناتُ التحويل بين الخزائن غير صالحة.")
        put("CASH_TRANSFER_INVALID_STATE", "حالةُ التحويل لا تسمح بهذا الإجراء.")
        put("SHIFT_NOT_FOUND", "الورديةُ غير موجودة.")
        put("SHIFT_INVALID_STATE", "حالةُ الوردية لا تسمح بهذا الإجراء.")
        put("MOVEMENT_DATE_INVALID", "تاريخُ الحركة غير صالح.")

        // ------------------------------------------------ المخزون والجرد
        put("ITEM_NOT_FOUND", "الصنفُ غير موجود.")
        put("WAREHOUSE_NOT_FOUND", "المستودعُ غير موجود.")
        put("INSUFFICIENT_STOCK", "الرصيدُ المتاح في المستودع لا يكفي للكميّة المطلوبة.")
        put("INVENTORY_LINES_REQUIRED", "أضف سطرًا واحدًا على الأقلّ للسند.")
        put("SERIALS_REQUIRED", "هذا الصنفُ يتتبّعُ الأرقامَ التسلسليّة — أدخلها.")
        put("SERIAL_NOT_FOUND", "رقمٌ تسلسليٌّ غير موجود في المخزون.")
        put("SERIAL_DUPLICATE", "رقمٌ تسلسليٌّ مكرّر.")
        put("LOT_NOT_FOUND", "الدفعةُ (Lot) غير موجودة.")
        put("TRANSFER_INVALID_STATE", "حالةُ التحويل المخزنيِّ لا تسمح بهذا الإجراء.")

        // ------------------------------------------------ الأطراف والكتالوج
        put("PARTY_NOT_FOUND", "العميل/المورّد غير موجود.")
        put("PARTY_HAS_OPEN_BALANCE", "لا يمكن حذفُ أو تعطيلُ طرفٍ عليه رصيدٌ مفتوح.")
        put("PERIOD_CLOSED", "الفترةُ المحاسبيّة مقفلة.")

        // ------------------------------------------------ الموارد البشريّة
        put("EMPLOYEE_NOT_FOUND", "الموظفُ غير موجود.")
        put("ADJUSTMENT_TYPE_REQUIRED", "اختر نوعَ المنصرف أو الاستقطاع.")
        put("ADJUSTMENT_CASH_LOCATION_REQUIRED", "اختر الصندوقَ أو البنك للصرف الفوريّ، أو فعّل خيار الخصم/الإضافة على مسيّر الراتب.")
        put("PAYROLL_RUN_EXISTS", "يوجد مسيّرُ رواتب مسجَّلٌ لهذا الشهر مسبقًا.")
        put("PAYROLL_RUN_NOT_POSTED", "رحّل مسيّرَ الرواتب أوّلًا قبل الصرف.")
        put("SALARY_ALREADY_PAID", "راتبُ هذا الشهر مصروفٌ مسبقًا.")
        put("PAYROLL_RUN_INVALID_STATE", "حالةُ ملفّ الرواتب لا تسمح بهذا الإجراء.")
        put("SALARY_COMPONENT_INVALID", "مكوّنُ الراتب غير صالح.")

        // ------------------------------------------------ الأدوار والعضويات
        put("SYSTEM_ROLE_PERMISSIONS_IMMUTABLE", "صلاحياتُ هذا الدورِ النظاميِّ لا تُعدَّل — متاحةٌ لمالكِ الحسابِ فقط.")
        put("OWNER_ROLE_NOT_ASSIGNABLE", "دورُ مالكِ الحسابِ لا يُمنحُ للأعضاء — أنشئ دورًا مخصّصًا.")
    }

    /** الترجمةُ العربيّةُ للرمز، أو null إن لم توجد في الخريطة. */
    fun translate(code: String?): String? {
        if (code.isNullOrBlank()) return null
        return map[code.trim().uppercase(Locale.US)]
    }
}
