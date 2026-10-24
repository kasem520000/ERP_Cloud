package com.erpcloud.rep.util

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * كل أرقام الخادم نصوص (numeric من PostgreSQL) — هذه الأداةُ تتعامل معها بدقةٍ عشرية
 * بلا تحويلٍ إلى double، مع تطبيع الأرقام العربية-الهندية والفارسية قبل التحليل والإرسال.
 */
object Dec {

    /** تحويلُ الأرقام العربية-الهندية (٠-٩) والفارسية (۰-۹) والفاصلة العشرية العربية إلى ASCII. */
    fun normalizeDigits(raw: String?): String {
        if (raw.isNullOrEmpty()) return ""
        val sb = StringBuilder(raw.length)
        for (ch in raw) {
            when (ch) {
                in '٠'..'٩' -> sb.append(('0'.code + (ch.code - '٠'.code)).toChar())
                in '۰'..'۹' -> sb.append(('0'.code + (ch.code - '۰'.code)).toChar())
                '٫', ',' -> sb.append('.')
                '٬', ' ' -> {} // تجاهل فواصل الآلاف والمسافات
                '−', '–' -> sb.append('-')
                else -> sb.append(ch)
            }
        }
        return sb.toString()
    }

    /** تحليلُ نصٍّ إلى BigDecimal — null إن كان فارغًا أو غير رقمي. */
    fun parse(value: String?): BigDecimal? {
        val text = normalizeDigits(value).trim()
        if (text.isEmpty() || text == "-" || text == "." || text == "-.") return null
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

    /** هل النصُّ رقمٌ عشريٌّ صالحٌ للإدخال (يقبل الأرقام العربية واللاتينية ونقطة وسالب)؟ */
    fun isValidInput(value: String): Boolean {
        if (value.isEmpty()) return true
        val normalized = normalizeDigits(value)
        return normalized.matches(Regex("^-?\\d*(\\.\\d*)?$"))
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

    /** الكيلوغرام: حتى ٣ خانات للعرض (الخادم يرسل ٤). */
    fun kg(value: String?): String = parse(value)
        ?.setScale(3, RoundingMode.HALF_UP)?.stripTrailingZeros()?.toPlainString() ?: (value ?: "")

    /** إعدادُ النصّ للإرسال على السلك: أرقام ASCII صالحة بلا نقطةٍ معلّقة، أو "" عند الفراغ. */
    fun wire(value: String?): String {
        val normalized = normalizeDigits(value).trim().trimEnd('.')
        if (normalized.isEmpty() || normalized == "-") return ""
        return parse(normalized)?.stripTrailingZeros()?.let { bd ->
            if (bd.scale() < 0) bd.setScale(0).toPlainString() else bd.toPlainString()
        } ?: normalized
    }
}
