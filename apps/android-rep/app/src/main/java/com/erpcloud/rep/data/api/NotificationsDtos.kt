package com.erpcloud.rep.data.api

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
    val id: String,
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

    val loadOrderNumber: String?
        get() = payloadString("loadOrderNumber")?.takeIf { it.isNotBlank() }

    val isRead: Boolean
        get() = readAt != null

    /** نطاقُ الإشعار — يراعي حقلَ الجمهور `audience` بالإضافة إلى نوع الإشعار. */
    val scope: NotificationScope
        get() = notificationScope(type, payload)

    private fun payloadString(key: String): String? =
        (payload?.get(key) as? JsonPrimitive)?.contentOrNull
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

/**
 * نطاقُ الإشعار: **عهدةُ المندوب** (توريدُه واستلامُه واعتمادُ إقفاله) أم
 * **قراراتُ الإدارة** (طلباتُ الاعتمادِ وفرقُ الاستلام) أم **النظامُ**.
 */
enum class NotificationScope {
    /** يخصُّ عملَ هذا المندوب نفسِه: توريدٌ بانتظاره، اعتمادُ إقفاله، إلغاءُ أمره. */
    MY_WORK,

    /** قراراتٌ وطلباتٌ جهةَ الإدارة/المحاسبة: اعتمادُ الإقفال، فرقُ الاستلام، المالية. */
    MANAGEMENT,

    /** إشعاراتٌ عامّةٌ موجَّهة للعضويّة (تعميمٌ أو ردُّ دعم). */
    SYSTEM,
}

/** أسماءُ أنواع الإشعارات معرَّبةً — من نوع الوسم الذي يرسله الخادم حرفيًّا. */
fun typeTitleAr(type: String): String = when (type) {
    "van_sales_supply_pending_receipt" -> "توريدٌ بانتظار استلامك"
    "van_sales_closing_approved" -> "اعتُمد إغلاقُ ورديتك"
    "van_sales_closing_request" -> "طلبُ اعتماد إغلاق وردية"
    "van_sales_receipt_confirmed" -> "تأكيدُ استلام توريد"
    "van_sales_receipt_discrepancy" -> "فرقٌ في استلام توريد"
    "van_sales_load_canceled" -> "إلغاءُ أمر تحميل"
    "payment.received" -> "استُلمت دفعة"
    "invoice.issued" -> "إصدار فاتورة"
    "invoice.overdue" -> "فاتورة متأخّرة"
    "purchase_bill.recorded" -> "تسجيل مشتريات"
    "stock.low" -> "تنبيه انخفاض مخزون"
    "announcement" -> "تعميمٌ من الإدارة"
    "support_ticket_reply" -> "ردٌّ من الدعم الفنّي"
    "comment.mention" -> "إشارةٌ إليك في تعليق"
    "settings.updated" -> "تحديثُ إعدادات المنشأة"
    else -> "إشعار نظام"
}

/** تصنيفُ النطاق — الأنواعُ التي تخصُّ عملَ المندوب نفسِه مقابل قرارات الإدارة. */
fun notificationScope(type: String, payload: JsonObject? = null): NotificationScope {
    val audience = (payload?.get("audience") as? JsonPrimitive)?.contentOrNull?.lowercase()
    if (audience == "management") return NotificationScope.MANAGEMENT
    if (audience == "rep") return NotificationScope.MY_WORK

    return when (type) {
        "van_sales_supply_pending_receipt",
        "van_sales_load_canceled",
        -> NotificationScope.MY_WORK

        "van_sales_closing_approved" -> {
            val hasSalesmanName = !(payload?.get("salesmanName") as? JsonPrimitive)?.contentOrNull.isNullOrBlank()
            if (hasSalesmanName) NotificationScope.MANAGEMENT else NotificationScope.MY_WORK
        }

        "van_sales_closing_request",
        "van_sales_receipt_confirmed",
        "van_sales_receipt_discrepancy",
        "payment.received",
        "invoice.issued",
        "invoice.overdue",
        "purchase_bill.recorded",
        "stock.low",
        "subscription.expiring",
        "user.invited",
        "marketplace_addon_approved",
        "marketplace_addon_rejected",
        "settings.updated",
        -> NotificationScope.MANAGEMENT

        else -> NotificationScope.SYSTEM
    }
}
