package com.erpcloud.rep.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * توقيتُ مكة المكرّمة الموحّد (`Asia/Riyadh`, `UTC+3`) — يضمنُ تطابق طوابع طابور
 * عدم الاتصال وملخّصات الورديات وتوقيت آخر تحديث مع التوقيت الرسمي للخادم.
 */
object MakkahTime {

    const val ZONE_ID: String = "Asia/Riyadh"

    val timeZone: TimeZone
        get() = TimeZone.getTimeZone(ZONE_ID)

    private fun formatter(pattern: String, locale: Locale = Locale.US): SimpleDateFormat =
        SimpleDateFormat(pattern, locale).apply {
            this.timeZone = timeZone
            isLenient = false
        }

    /** تاريخُ اليوم في مكة المكرّمة بصيغة `YYYY-MM-DD`. */
    fun todayIso(nowMillis: Long = System.currentTimeMillis()): String =
        formatter("yyyy-MM-dd").format(Date(nowMillis))

    /** الطابعُ الزمنيُّ الكامل بتوقيت مكة المكرّمة (`yyyy-MM-dd HH:mm:ss`). */
    fun nowTimestamp(nowMillis: Long = System.currentTimeMillis()): String =
        formatter("yyyy-MM-dd HH:mm:ss").format(Date(nowMillis))

    /** التاريخُ والوقتُ بتوقيت مكة المكرّمة للمشاركة (`yyyy/MM/dd HH:mm`). */
    fun nowSlashDateTime(nowMillis: Long = System.currentTimeMillis()): String =
        formatter("yyyy/MM/dd HH:mm").format(Date(nowMillis))

    /** تنسيقُ الساعة والدقيقة (`HH:mm`) بتوقيت مكة المكرّمة. */
    fun formatTimeHm(millis: Long): String =
        formatter("HH:mm").format(Date(millis))
}
