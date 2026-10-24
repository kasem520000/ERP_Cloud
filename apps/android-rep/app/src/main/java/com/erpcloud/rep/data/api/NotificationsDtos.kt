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
 * كلاهما يتطلّب إذنَ tenant.notification.view.
 *
 * الصندوقُ نفسُه محصورٌ بعضويّة المُتصل (كلُّ إشعارٍ له membershipId واحد) — والفصلُ
 * بين إشعارات المناديب وإشعارات الإدارة يصنعُه الخادمُ عند الإنشاء (انظر وثيقة
 * docs/NOTIFICATION_ROUTING_SERVER_REQUIREMENTS.md)؛ وهنا نُعرّبُ الأنواع ونصنّفُ
 * نطاقَها كي تعرضَها شاشةُ الإشعاراتِ مصنَّفةً حتى يتمّ إصلاحُ التوجيه في الخادم.
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

    /** نطاقُ الإشعار — من صاحب هذا الصندوق؟ (تُشتقّ من النوع لا من الحمولة). */
    val scope: NotificationScope
        get() = notificationScope(type)

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
 * **قراراتُ الإدارة** (طلباتُ الاعتمادِ وفرقُ الاستلام) أم **النظامُ** (إعدادات…).
 * الصندوقُ واحدٌ لكلّ عضويّة، والنطاقُ يُشتقّ من نوع الوسم الذي يرسله الخادم.
 */
enum class NotificationScope {
    /** يخصُّ عملَ هذا المندوب نفسِه: توريدٌ بانتظاره، اعتمادُ إقفاله، إلغاءُ أمره. */
    MY_WORK,

    /** قراراتٌ وطلباتٌ جهةَ الإدارة/المحاسبة: اعتمادُ الإقفال، فرقُ الاستلام. */
    MANAGEMENT,

    /** إشعاراتٌ عامّةٌ من النظام (إعداداتُ المنشأة…). */
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
    "comment.mention" -> "إشارةٌ إليك في تعليق"
    "settings.updated" -> "تحديثُ إعدادات المنشأة"
    else -> type
}

/** تصنيفُ النطاق — الأنواعُ التي تخصُّ عملَ المندوب نفسِه مقابل قرارات الإدارة. */
fun notificationScope(type: String): NotificationScope = when (type) {
    "van_sales_supply_pending_receipt",
    "van_sales_closing_approved",
    "van_sales_load_canceled",
    -> NotificationScope.MY_WORK

    "van_sales_closing_request",
    "van_sales_receipt_confirmed",
    "van_sales_receipt_discrepancy",
    "payment.received",
    "comment.mention",
    "settings.updated",
    -> NotificationScope.MANAGEMENT

    else -> NotificationScope.SYSTEM
}
