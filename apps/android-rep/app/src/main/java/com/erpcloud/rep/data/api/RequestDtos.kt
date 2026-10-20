package com.erpcloud.rep.data.api

import kotlinx.serialization.Serializable

/**
 * أجسامُ الإجراءات — نفسُ الحقول التي ترسلها شاشةُ الويب
 * (buildDocumentPayload / buildReturnPayload / buildCollectionPayload /
 * buildClosingPayload / buildReceiptPayload).
 *
 * الحقولُ الفارغة/الصفرية لا تُرسل أصلًا (Json.encodeDefaults=false) — كما تفعل
 * بانياتُ الويب التي ترسل undefined. والـidempotencyKey يُضاف إلى الجسم **قبل**
 * الإرسال ويُخزَّن معه في الطابور فتستعمله كلُّ إعادة.
 */

@Serializable
data class SaleRequest(
    val loadOrderId: String,
    val partyId: String? = null,
    val customerName: String? = null,
    val invoiceMode: String = "zatca_tax",
    val paymentMethod: String = "cash",
    val cashLocationId: String? = null,
    val soldQty: String,
    val bonusQty: String? = null,
    val bonusReason: String? = null,
    val unitPrice: String? = null,
    val discountAmount: String? = null,
    val discountReason: String? = null,
    val customerBonusConfirmed: Boolean? = null,
    val customerConfirmationCode: String? = null,
    val notes: String? = null,
    val idempotencyKey: String? = null,
)

@Serializable
data class ReturnRequest(
    val returnedQty: String,
    val reason: String? = null,
    val notes: String? = null,
    val idempotencyKey: String? = null,
)

@Serializable
data class CollectionRequest(
    val documentId: String,
    val collectedAmount: String,
    val cashLocationId: String? = null,
    val offsetAccountId: String? = null,
    val notes: String? = null,
    val idempotencyKey: String? = null,
)

/** جسمُ تأكيد الاستلام — **بلا idempotencyKey**: المسارُ لا يقرؤه ولا يُحفظ في طابور. */
@Serializable
data class ReceiptRequest(
    val receivedQty: String? = null,
    val notes: String? = null,
)

/** جسمُ إغلاق الوردية — **بلا idempotencyKey** كذلك. */
@Serializable
data class ClosingRequest(
    val returnedQty: String? = null,
    val damagedQty: String? = null,
    val damageReason: String? = null,
    val collectedCash: String? = null,
    val actualRemainingQty: String? = null,
    val vehicleCountQty: String? = null,
    val closingNotes: String? = null,
)
