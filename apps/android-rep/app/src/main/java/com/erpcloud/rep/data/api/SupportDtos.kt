package com.erpcloud.rep.data.api

import kotlinx.serialization.Serializable

/** هويةُ النظام من الخادم (بلا جلسة) — `GET /public/site`. */
@Serializable
data class PublicSiteDto(
    val brandName: String = "",
    val brandInitials: String = "",
    val taglineAr: String = "",
    val taglineEn: String = "",
    val supportEmail: String = "",
    val supportPhone: String = "",
    val companyLegalName: String = "",
)

/** مقالٌ في مركز المساعدة — `GET /public/help`. */
@Serializable
data class PublicHelpPostDto(
    val slug: String = "",
    val titleAr: String = "",
    val summaryAr: String? = null,
    val category: String? = null,
    val publishedAt: String = "",
)

/** سؤالٌ شائع — `GET /public/faq`. */
@Serializable
data class PublicFaqDto(
    val slug: String = "",
    val question: String = "",
    val answer: String = "",
)

/** تذكرةُ دعمٍ فنيّ — `GET/POST /support/tickets`. */
@Serializable
data class SupportTicketDto(
    val id: String = "",
    val subject: String = "",
    val status: String = "open",
    val priority: String = "normal",
    val category: String? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
    val firstResponseAt: String? = null,
    val messageCount: Int = 0,
    val messages: List<SupportMessageDto> = emptyList(),
)

/** رسالةٌ داخل تذكرة الدعم — `GET /support/tickets/{id}`. */
@Serializable
data class SupportMessageDto(
    val id: String = "",
    val authorLabel: String? = null,
    val authorKind: String = "customer",
    val body: String = "",
    val createdAt: String = "",
)
