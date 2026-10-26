package com.erpcloud.bakery.util

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * توقيتُ مكة المكرّمة الموحّد (`Asia/Riyadh`, `UTC+3`) — متوافقٌ مع `minSdk = 24`
 * بلا اعتمادٍ على `java.time.*` (API 26+)، لضمان تطابق تواريخ الفواتير والسندات
 * والتقارير وطوابع الإيصالات مع توقيت الخادم المعتمد في المنصة.
 */
object MakkahTime {

    const val ZONE_ID: String = "Asia/Riyadh"

    val timeZone: TimeZone
        get() = TimeZone.getTimeZone(ZONE_ID)

    private val utcZone: TimeZone
        get() = TimeZone.getTimeZone("UTC")

    private fun formatter(pattern: String, locale: Locale = Locale.US, zone: TimeZone = timeZone): SimpleDateFormat =
        SimpleDateFormat(pattern, locale).apply {
            this.timeZone = zone
            isLenient = false
        }

    /** تاريخُ اليوم في مكة المكرّمة بصيغة `YYYY-MM-DD`. */
    fun todayIso(nowMillis: Long = System.currentTimeMillis()): String =
        formatter("yyyy-MM-dd").format(Date(nowMillis))

    /** تاريخٌ قبل [days] يومًا في مكة المكرّمة بصيغة `YYYY-MM-DD`. */
    fun daysAgoIso(days: Int, nowMillis: Long = System.currentTimeMillis()): String {
        val cal = Calendar.getInstance(timeZone, Locale.US).apply {
            timeInMillis = nowMillis
            add(Calendar.DAY_OF_YEAR, -days)
        }
        return formatter("yyyy-MM-dd").format(cal.time)
    }

    /** أوّلُ يومٍ في الشهر الحالي بتوقيت مكة المكرّمة (`YYYY-MM-01`). */
    fun firstOfCurrentMonthIso(nowMillis: Long = System.currentTimeMillis()): String {
        val cal = Calendar.getInstance(timeZone, Locale.US).apply {
            timeInMillis = nowMillis
            set(Calendar.DAY_OF_MONTH, 1)
        }
        return formatter("yyyy-MM-dd").format(cal.time)
    }

    /** أوّلُ يومٍ في الشهر الماضي بتوقيت مكة المكرّمة (`YYYY-MM-01`). */
    fun firstOfPreviousMonthIso(nowMillis: Long = System.currentTimeMillis()): String {
        val cal = Calendar.getInstance(timeZone, Locale.US).apply {
            timeInMillis = nowMillis
            add(Calendar.MONTH, -1)
            set(Calendar.DAY_OF_MONTH, 1)
        }
        return formatter("yyyy-MM-dd").format(cal.time)
    }

    /** أوّلُ يومٍ في السنة الحاليّة بتوقيت مكة المكرّمة (`YYYY-01-01`). */
    fun firstOfCurrentYearIso(nowMillis: Long = System.currentTimeMillis()): String =
        formatter("yyyy-01-01").format(Date(nowMillis))

    /** الشهرُ الحالي لمسيّرات الرواتب بتوقيت مكة المكرّمة (`YYYY-MM`). */
    fun currentYearMonth(nowMillis: Long = System.currentTimeMillis()): String =
        formatter("yyyy-MM").format(Date(nowMillis))

    /** التاريخُ والوقتُ الحاليان بتوقيت مكة المكرّمة (`yyyy-MM-dd HH:mm`). */
    fun nowDateTime(nowMillis: Long = System.currentTimeMillis()): String =
        formatter("yyyy-MM-dd HH:mm").format(Date(nowMillis))

    /** اسمُ اليوم بالعربيّة لتاريخ `YYYY-MM-DD` على تقويم مكة المكرّمة. */
    fun dayLabelAr(isoDate: String): String {
        val parsed = runCatching { formatter("yyyy-MM-dd").parse(isoDate.trim()) }.getOrNull()
        return if (parsed != null) {
            formatter("EEEE", Locale("ar")).format(parsed)
        } else {
            isoDate
        }
    }

    /**
     * تحويلُ `YYYY-MM-DD` إلى منتصف ليل UTC بالملي ثانية كما يتوقعه `DatePicker` في Material 3،
     * مع الرجوع إلى تاريخ اليوم بتوقيت مكة المكرّمة عند غياب القيمة أو فسادها.
     */
    fun isoDateToUtcMidnightMillis(value: String, nowMillis: Long = System.currentTimeMillis()): Long {
        val candidate = value.trim().ifBlank { todayIso(nowMillis) }
        return runCatching {
            formatter("yyyy-MM-dd", Locale.US, utcZone).parse(candidate)?.time
        }.getOrNull() ?: System.currentTimeMillis()
    }

    /** تحويلُ قيمة `DatePicker` (منتصف ليل UTC) إلى نصّ `YYYY-MM-DD`. */
    fun utcMidnightMillisToIsoDate(millis: Long): String =
        formatter("yyyy-MM-dd", Locale.US, utcZone).format(Date(millis))
}
