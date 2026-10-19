package com.erpcloud.bakery.util

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * كل أرقام الخادم نصوص (numeric من PostgreSQL) — هذه الأداةُ تتعامل معها بدقةٍ عشرية
 * بلا تحويلٍ إلى double (انظر docs/ANDROID_REP_APP_API_REFERENCE.md §١).
 */
object Dec {

    /** تحليلُ نصٍّ إلى BigDecimal — null إن كان فارغًا أو غير رقمي. */
    fun parse(value: String?): BigDecimal? {
        val text = value?.trim().orEmpty()
        if (text.isEmpty()) return null
        return try {
            BigDecimal(text)
        } catch (_: NumberFormatException) {
            null
        }
    }

    fun orZero(value: String?): BigDecimal = parse(value) ?: BigDecimal.ZERO

    fun isPositive(value: String?): Boolean {
        val parsed = parse(value) ?: return false
        return parsed.signum() > 0
    }

    fun isNonNegative(value: String?): Boolean {
        val parsed = parse(value) ?: return false
        return parsed.signum() >= 0
    }

    /** هل النصُّ رقمٌ عشريٌّ صالحٌ للإدخال (أرقام ونقطة وسالب فقط)؟ */
    fun isValidInput(value: String): Boolean {
        if (value.isEmpty()) return true
        if (!value.matches(Regex("^-?\\d*(\\.\\d*)?$"))) return false
        // نقطة بلا أرقام أو علامة وحدها لا تُعدّ جاهزةً للإرسال لكنها إدخالٌ مشروع
        return true
    }

    /** تنسيقُ قيمةٍ للعرض: قصّ الأصفار الزائدة مع حدٍّ أعلى للخانات. */
    fun fmt(value: String?, maxScale: Int = 2, minScale: Int = 0): String {
        val parsed = parse(value) ?: return value ?: ""
        val scaled = parsed.setScale(maxScale, RoundingMode.HALF_UP)
            .stripTrailingZeros()
        val final = if (scaled.scale() < minScale) scaled.setScale(minScale) else scaled
        return final.toPlainString()
    }

    /** المال: خانتان دائمًا. */
    fun money(value: String?): String = parse(value)
        ?.setScale(2, RoundingMode.HALF_UP)?.toPlainString() ?: (value ?: "")

    /** الكيلوغرام: خانتان للعرض (الخادم يرسل ٤). */
    fun kg(value: String?): String = parse(value)
        ?.setScale(3, RoundingMode.HALF_UP)?.stripTrailingZeros()?.toPlainString() ?: (value ?: "")

    /** إعدادُ النصّ للإرسال: كما كتبه المندوب أو "" — لا اختراعَ أرقام. */
    fun wire(value: String?): String = value?.trim().orEmpty()
}
