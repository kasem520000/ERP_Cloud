package com.erpcloud.bakery.data.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * عقودُ الإشعارات — GET /notifications وPOST /notifications/:id/read.
 * الخادمُ يعيد `{ data: NotificationDto[], meta: { page, limit, total, unread } }`.
 */
@Serializable
data class NotificationPageDto(
    val data: List<NotificationDto> = emptyList(),
    val meta: NotificationMetaDto = NotificationMetaDto(),
)

@Serializable
data class NotificationMetaDto(
    val page: Int = 1,
    val limit: Int = 30,
    val total: Int = 0,
    val unread: Int = 0,
)

@Serializable
data class NotificationDto(
    val id: String = "",
    val type: String = "",
    val title: String = "",
    val body: String? = null,
    val payload: JsonObject? = null,
    val readAt: String? = null,
    val createdAt: String? = null,
) {
    val isRead: Boolean get() = !readAt.isNullOrBlank()

    fun payloadString(key: String): String? =
        (payload?.get(key) as? JsonElement)?.let { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }

    /**
     * عزلُ إشعارات الإدارة والمحاسبين عن إشعارات عهدة المندوب الفرديّة:
     * - استبعادُ إشعارات المندوب الصرفة (`van_sales_supply_pending_receipt` و`van_sales_load_canceled`).
     * - استبعادُ إشعارات `van_sales_closing_approved` المرسَلة للمندوب (`audience = rep`)
     *   أو القديمة التي تخلو من `salesmanName` في حمولتها.
     */
    val isManagementRelevant: Boolean
        get() {
            val audience = payloadString("audience")?.lowercase()
            if (audience == "rep") return false
            return when (type) {
                "van_sales_supply_pending_receipt",
                "van_sales_load_canceled",
                -> false
                "van_sales_closing_approved" ->
                    audience == "management" || !payloadString("salesmanName").isNullOrBlank()
                else -> true
            }
        }

    fun typeTitleAr(): String = when (type) {
        "van_sales_closing_request" -> "طلب اعتماد إغلاق وردية"
        "van_sales_closing_approved" -> "تمّ اعتماد إغلاق الوردية"
        "van_sales_receipt_confirmed" -> "تأكيد استلام توريد"
        "van_sales_receipt_discrepancy" -> "تفاوت في استلام توريد"
        "van_sales_supply_pending_receipt" -> "توريد جديد بانتظار الاستلام"
        "van_sales_load_canceled" -> "إلغاء أمر تحميل"
        "invoice.issued" -> "إصدار فاتورة"
        "invoice.overdue" -> "فاتورة متأخّرة السداد"
        "payment.received" -> "سند تحصيل مستلم"
        "purchase_bill.recorded" -> "تسجيل فاتورة مشتريات"
        "stock.low" -> "تنبيه انخفاض المخزون"
        "subscription.expiring" -> "قرب انتهاء الاشتراك"
        "user.invited" -> "دعوة عضوٍ جديد"
        "support_ticket_reply" -> "ردٌّ من الدعم الفنّي"
        "marketplace_addon_approved" -> "تفعيل إضافةٍ من المتجر"
        "marketplace_addon_rejected" -> "رفض طلب إضافةٍ من المتجر"
        "announcement" -> "تعميمٌ إداريّ"
        "comment.mention" -> "إشارةٌ في تعليق"
        else -> "إشعار نظام"
    }
}

@Serializable
data class NotificationReadAckDto(
    val id: String = "",
    val read: Boolean = true,
)
