package com.erpcloud.bakery.data.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * عقودُ صناديق الإشعارات — من packages/contracts/src/platform/notifications.ts
 * ومتحكّم platform-services/notifications:
 * - `GET /notifications?limit&offset&filter[read]` ⇒ `{ data: [], meta: {total, limit, offset, unread} }`
 * - `POST /notifications/{id}/read` ⇒ 201، تكرارٌ آمن (idempotent).
 */
@Serializable
data class NotificationDto(
    val id: String = "",
    val membershipId: String? = null,
    val type: String = "",
    val payload: JsonObject? = null,
    val readAt: String? = null,
    val createdAt: String = "",
) {
    /** العنوانُ من الحمولة، وإلا فاسمُ النوع معرَّبًا. */
    val title: String
        get() = payloadString("title")?.takeIf { it.isNotBlank() } ?: typeTitleAr(type)

    val body: String
        get() = payloadString("body").orEmpty()

    val isRead: Boolean
        get() = !readAt.isNullOrBlank()

    fun payloadString(key: String): String? =
        (payload?.get(key) as? JsonPrimitive)?.contentOrNull

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

    fun typeTitleAr(): String = com.erpcloud.bakery.data.api.typeTitleAr(type)
}

@Serializable
data class NotificationListMeta(
    val total: Int = 0,
    val limit: Int = 0,
    val offset: Int = 0,
    val unread: Int = 0,
)

@Serializable
data class NotificationListResponse(
    val data: List<NotificationDto> = emptyList(),
    val meta: NotificationListMeta = NotificationListMeta(),
)

/** أسماءُ أنواع الإشعارات معرَّبةً — من نوع الوسم الذي يرسله الخادم. */
fun typeTitleAr(type: String): String = when (type) {
    "van_sales_closing_request" -> "طلب اعتماد إغلاق وردية"
    "van_sales_closing_approved" -> "تمّ اعتماد إغلاق الوردية"
    "van_sales_receipt_confirmed" -> "تأكيد استلام توريد"
    "van_sales_receipt_discrepancy" -> "تفاوت في استلام توريد"
    "van_sales_supply_pending_receipt" -> "توريد جديد بانتظار الاستلام"
    "van_sales_load_canceled" -> "إلغاء أمر تحميل"
    "invoice.issued" -> "إصدار فاتورة"
    "invoice.overdue" -> "فاتورة متأخّرة السداد"
    "payment.received", "payment_paid" -> "سند تحصيل مستلم"
    "purchase_bill.recorded" -> "تسجيل فاتورة مشتريات"
    "stock.low" -> "تنبيه انخفاض المخزون"
    "subscription.expiring" -> "قرب انتهاء الاشتراك"
    "user.invited" -> "دعوة عضوٍ جديد"
    "support_ticket_reply" -> "ردٌّ من الدعم الفنّي"
    "marketplace_addon_approved" -> "تفعيل إضافةٍ من المتجر"
    "marketplace_addon_rejected" -> "رفض طلب إضافةٍ من المتجر"
    "announcement" -> "تعميمٌ إداريّ"
    "comment.mention" -> "إشارةٌ في تعليق"
    "settings.updated" -> "تحديث إعدادات المنشأة"
    "salary" -> "رواتب"
    "advance" -> "سلفة"
    "leave" -> "إجازة"
    "check_in" -> "بصمة حضور"
    "check_out" -> "بصمة انصراف"
    "document" -> "مستند"
    "voucher" -> "سند"
    else -> "إشعار نظام"
}
