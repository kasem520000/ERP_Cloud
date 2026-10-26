package com.erpcloud.rep.util

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * المالُ والكميّاتُ في التوزيع كلُّها نصوصٌ عشريّة — لا `Double` في أيّ مسار.
 * يطابقُ منطق `com.erpcloud.bakery.util.Dec` في تطبيع الأرقام العربيّة والفواصل
 * الألفيّة والتقريب المحاسبي (`HALF_UP`).
 */
object Dec {

    /**
     * يحوّلُ الأرقام العربيّة المشرقيّة والفارسيّة إلى لاتينيّة، ويعالجُ فواصل الآلاف
     * بدقّة (مثل `"1,250.50"` أو `"1,000,000"`) فلا تتحوّل خطأً إلى نقاطٍ عشريّة متكرّرة.
     */
    fun normalizeDigits(raw: String): String {
        val sb = StringBuilder(raw.length)
        for (ch in raw) {
            when (ch) {
                in '٠'..'٩' -> sb.append(('0'.code + (ch.code - '٠'.code)).toChar())
                in '۰'..'۹' -> sb.append(('0'.code + (ch.code - '۰'.code)).toChar())
                '٫' -> sb.append('.')
                '٬', ' ', '\u00A0', '\u202F' -> { /* فاصلةُ آلافٍ أو مسافةُ تنسيق — تُحذف */ }
                else -> sb.append(ch)
            }
        }
        val intermediate = sb.toString()
        val commaCount = intermediate.count { it == ',' }
        if (commaCount == 0) return intermediate
        if ('.' in intermediate) return intermediate.replace(",", "")
        if (commaCount > 1) return intermediate.replace(",", "")
        return intermediate.replace(',', '.')
    }

    fun parse(value: String?): BigDecimal? {
        if (value.isNullOrBlank()) return null
        val cleaned = normalizeDigits(value).trim()
        if (cleaned.isEmpty() || cleaned == "-" || cleaned == ".") return null
        return try {
            BigDecimal(cleaned)
        } catch (_: NumberFormatException) {
            null
        }
    }

    fun orZero(value: String?): BigDecimal = parse(value) ?: BigDecimal.ZERO

    fun isPositive(value: String?): Boolean = (parse(value)?.signum() ?: 0) > 0

    fun isNonNegative(value: String?): Boolean = (parse(value)?.signum() ?: -1) >= 0

    /** تنسيقُ مبلغٍ ماليٍّ بالريال (منزلتان عشريّتان على الأقل). */
    fun money(value: String?): String = format(value, minDecimals = 2, maxDecimals = 2)

    /** تنسيقُ كميّةٍ بالكيلوغرام (بلا أصفارٍ زائدة، حتّى ٤ منازل). */
    fun kg(value: String?): String = format(value, minDecimals = 0, maxDecimals = 4)

    /** تنسيقٌ رقميٌّ عامٌّ بلا أصفارٍ لاحقةٍ زائدة حتّى [maxDecimals] منازل. */
    fun fmt(value: String?, maxDecimals: Int = 2): String =
        format(value, minDecimals = 0, maxDecimals = maxDecimals)

    /** نصُّ إرسالٍ إلى الخادم — أرقامٌ لاتينيّة، بلا أصفارٍ لاحقةٍ زائدة. */
    fun wire(value: String): String {
        val bd = parse(value) ?: return normalizeDigits(value).trim()
        val stripped = bd.stripTrailingZeros()
        return if (stripped.scale() < 0) stripped.setScale(0).toPlainString() else stripped.toPlainString()
    }

    /** يقبلُ حقلُ الإدخال الرقميّ: فراغًا، أو أرقامًا ونقطةً عشريّةً واحدةً غير سالبة. */
    fun isValidInput(raw: String, allowNegative: Boolean = false): Boolean {
        if (raw.isEmpty()) return true
        val norm = normalizeDigits(raw)
        val body = if (allowNegative && norm.startsWith("-")) norm.substring(1) else norm
        var dots = 0
        for (c in body) {
            when {
                c in '0'..'9' -> {}
                c == '.' -> {
                    dots++
                    if (dots > 1) return false
                }
                else -> return false
            }
        }
        return true
    }

    private fun format(value: String?, minDecimals: Int, maxDecimals: Int): String {
        val bd = parse(value) ?: return if (value.isNullOrBlank()) "0" else value
        val scaled = bd.setScale(maxDecimals, RoundingMode.HALF_UP).stripTrailingZeros()
        val finalScale = scaled.scale().coerceAtLeast(minDecimals)
        return scaled.setScale(finalScale, RoundingMode.HALF_UP).toPlainString()
    }
}
