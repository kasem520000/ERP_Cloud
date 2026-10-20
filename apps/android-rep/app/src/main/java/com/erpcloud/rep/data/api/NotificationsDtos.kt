package com.erpcloud.rep.data.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * عقودُ صناديق الإشعارات — من packages/contracts/src/platform/notifications.ts
 * ومتحكّم platform-services/notifications:
 * - `GET /notifications?limit&offset&filter[read]` ⇒ `{ data: [], meta: {total, limit, offset, unread} }`
 *   (بلا غلاف data إضافيّ — الردُّ هو الغلافُ نفسُه).
 * - `POST /notifications/{id}/read` ⇒ 201، تكرارٌ آمن (idempotent).
 * كلاهما يتطلّب إذنَ `tenant.notification.view`.
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

    val isRead: Boolean
        get() = readAt != null

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

/** أسماءُ أنواع الإشعارات معرَّبةً — من نوع الوسم الذي يرسله الخادم. */
fun typeTitleAr(type: String): String = when (type) {
    "van_sales_closing_request" -> "طلبُ اعتماد إغلاق وردية"
    "van_sales_receipt_confirmed" -> "تأكيدُ استلام توريد"
    "van_sales_receipt_discrepancy" -> "فرقٌ في استلام توريد"
    "van_sales_load_canceled" -> "إلغاءُ أمر تحميل"
    "settings.updated" -> "تحديثُ إعدادات المنشأة"
    else -> type
}
