package com.erpcloud.bakery.data.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * عقدُ `GET /van-sales/documents/{id}/print-view?copies=2` — مستندٌ واحدٌ بعدد نسخ.
 * كلُّ نسخةٍ تحمل حقولَ المستند نفسها + خانات النسخة (الرقم والإجماليات وخانة التوقيع).
 */
@Serializable
data class PrintLineDto(
    val kind: String = "sale",
    val itemName: String = "",
    val sku: String = "",
    val quantity: String = "0",
    val unitPrice: String = "0",
    val discount: String = "0",
    val lineTotal: String = "0",
    val reason: String? = null,
)

@Serializable
data class SignatureBlockDto(
    val customerSignatureLabel: String = "توقيع العميل / المستلم",
    val repSignatureLabel: String = "توقيع المندوب",
    val accountantNote: String = "",
)

@Serializable
data class PrintCopyDto(
    val copyIndex: Int = 1,
    val kind: String = "customer",
    val copyLabel: String = "",
    val requiresCustomerSignature: Boolean = false,
    val signatureBlock: SignatureBlockDto? = null,
    val documentNumber: String = "",
    val grandTotal: String = "0",
    val vatTotal: String = "0",
    val paidAmount: String = "0",
)

@Serializable
data class PrintViewDto(
    val documentId: String,
    val documentNumber: String = "",
    val invoiceNumber: String? = null,
    val invoiceStatus: String? = null,
    val saleDate: String = "",
    val companyName: String = "",
    val companyNameEn: String = "",
    val companyTaxNo: String = "",
    val companyCrNo: String = "",
    val companyEmail: String = "",
    val companyPhones: List<String> = emptyList(),
    val companyAddress: JsonObject? = null,
    val customerName: String = "",
    val customerTaxNo: String = "",
    val customerPhone: String = "",
    val customerMobile: String = "",
    val salesmanName: String = "",
    val salesmanMobile: String = "",
    val vanWarehouseName: String = "",
    val loadOrderNumber: String = "",
    val productionBatchNo: String = "",
    val invoiceMode: String = "",
    val taxPolicyStatus: String = "",
    val paymentMethod: String = "",
    val lines: List<PrintLineDto> = emptyList(),
    val subtotal: String = "0",
    val discountTotal: String = "0",
    val vatRate: String = "0",
    val vatTotal: String = "0",
    val grandTotal: String = "0",
    val paidAmount: String = "0",
    val outstandingAmount: String = "0",
    val bonusQtyTotal: String = "0",
    val qrPayload: String = "",
    val notes: String = "",
    val printedAt: String = "",
    val copies: List<PrintCopyDto> = emptyList(),
    val copiesCount: Int = 1,
) {
    val isZatca: Boolean get() = invoiceMode == "zatca_tax"
    val repCopy: PrintCopyDto? get() = copies.firstOrNull { it.kind == "rep" }
}

/**
 * غلافُ صفحاتِ الطباعةِ الاحترافيّةِ عند الخادم — `GET /reports/print/…` يعيد
 * `{ html }`: صفحةً واحدةً مكتفيةً (A4 أو ورقٌ صغيرٌ 80mm بـ`?paper=small`)
 * بترويسةِ الويبِ الرسميّةِ وQR الزكاة مضمَّنًا داخلَها.
 */
@Serializable
data class PrintHtmlDto(
    val html: String = "",
)
