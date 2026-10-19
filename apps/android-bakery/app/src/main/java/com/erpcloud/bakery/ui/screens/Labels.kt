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
        "sale" -> "بيع" to ChipTone.INFO
        "sale_return" -> "مرتجع" to ChipTone.WARN
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
}
