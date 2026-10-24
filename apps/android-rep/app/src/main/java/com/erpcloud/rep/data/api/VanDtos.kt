package com.erpcloud.rep.data.api

import kotlinx.serialization.json.JsonObject
import com.erpcloud.rep.util.Dec
import kotlinx.serialization.Serializable

/**
 * عقدُ مساحة عمل المندوب `GET /van-sales/me` وقائمة العملاء `GET /parties`
 * ونسختا الطباعة `GET /van-sales/documents/{id}/print-view` —
 * مطابقٌ لما يكتبه VanSalesService.repWorkspace حرفيًّا
 * (docs/ANDROID_REP_APP_API_RESPONSES.json → endpoints[van-sales-me]).
 *
 * قاعدتان:
 * 1. كل الكميات والقيم نصوص (string) — لا تُحوَّل إلى double.
 * 2. حقول فرع «لستَ مندوبًا» (isRep=false) غائبةٌ أصلًا من الاستجابة — لذلك كلُّ
 *    الحقول اختياريةٌ هنا والغيابُ معنًى لا نقص.
 */

@Serializable
data class RepBalanceRow(
    val itemId: String,
    val itemName: String = "",
    val sku: String = "",
    val warehouseId: String = "",
    val warehouseName: String = "",
    val warehouseCode: String = "",
    val branchId: String? = null,
    val quantity: String = "0",
    val value: String = "0",
    val averageCost: String = "0",
)

@Serializable
data class RepPendingReceipt(
    val id: String,
    val number: String = "",
    val loadDate: String = "",
    val status: String = "pending_receipt",
    val loadedQty: String = "0",
    val receivedQty: String = "0",
    val productionBatchNo: String = "",
    val stockTransferId: String? = null,
    val itemName: String = "",
    val fromWarehouseName: String = "",
)

@Serializable
data class RepLoadOrderRow(
    val id: String,
    val number: String = "",
    val loadDate: String = "",
    val status: String = "",
    val itemName: String = "",
    val productionBatchNo: String = "",
    val loadedQty: String = "0",
    val receivedQty: String = "0",
    val soldQty: String = "0",
    val bonusQty: String = "0",
    val returnedQty: String = "0",
    val damagedQty: String = "0",
    val shortageQty: String = "0",
    val shortageValue: String = "0",
    val expectedCash: String = "0",
    val collectedCash: String = "0",
    val outstandingCash: String = "0",
    val expectedRemainingQty: String = "0",
    val actualRemainingQty: String = "0",
    val discrepancyQty: String = "0",
    val discrepancyNotes: String = "",
    val stockSettlementStatus: String = "not_required",
    val stockSettlementNote: String = "",
    val remainingAction: String? = null,
    val closingSubmittedAt: String? = null,
    val approvedAt: String? = null,
) {
    /** حالةُ الإقفال المعلَّقة — يُعاد إرسال الإقفال إليها ما لم تُصفَّ. */
    val isPendingClosing: Boolean get() = status == "pending_closing"
}

@Serializable
data class RepDocumentRow(
    val id: String,
    val number: String = "",
    val docDate: String = "",
    val documentKind: String = "sale",
    val invoiceMode: String = "",
    val paymentMethod: String = "",
    val customerName: String = "",
    val itemName: String = "",
    val soldQty: String = "0",
    val bonusQty: String = "0",
    val unitPrice: String = "0",
    val subtotal: String = "0",
    val taxTotal: String = "0",
    val total: String = "0",
    val paidAmount: String = "0",
    val outstanding: String = "0",
    val salesInvoiceId: String? = null,
    val invoiceNumber: String? = null,
    val invoiceStatus: String? = null,
) {
    val isSale: Boolean get() = documentKind == "sale"
}

@Serializable
data class RepCollectionRow(
    val id: String,
    val collectedAt: String = "",
    val amount: String = "0",
    val reason: String = "",
    val voucherId: String? = null,
    val voucherNumber: String? = null,
    val voucherStatus: String? = null,
)

@Serializable
data class RepNotificationRow(
    val id: String,
    val type: String = "",
    val read: Boolean = false,
    val createdAt: String = "",
    val payload: JsonObject? = null,
)

@Serializable
data class RepTotals(
    val revenue: String = "0",
    val salesGross: String = "0",
    val cashSales: String = "0",
    val creditSales: String = "0",
    val collected: String = "0",
    val outstanding: String = "0",
    val returns: String = "0",
    val returnsVat: String = "0",
    val returnCount: Int = 0,
    val returnsWithoutCostCount: Int = 0,
)

@Serializable
data class RepCustody(
    val expectedKg: String = "0",
    val officialKg: String = "0",
    val pendingClosings: Int = 0,
)

@Serializable
data class RepWindowRow(
    val returned: Int = 0,
    val total: Int = 0,
    val limit: Int = 0,
)

@Serializable
data class RepWindows(
    val loadOrders: RepWindowRow = RepWindowRow(),
    val documents: RepWindowRow = RepWindowRow(),
    val collections: RepWindowRow = RepWindowRow(),
    val notifications: RepWindowRow = RepWindowRow(),
)

@Serializable
data class RepWorkspace(
    val isRep: Boolean = false,
    val salesmanId: String? = null,
    val salesmanName: String? = null,
    val employeeId: String? = null,
    val warehouseId: String? = null,
    val vehiclePlate: String? = null,
    val active: Boolean = true,
    val custodyKg: String? = null,
    val custodyValue: String? = null,
    val balances: List<RepBalanceRow> = emptyList(),
    val pendingReceipts: List<RepPendingReceipt> = emptyList(),
    val loadOrders: List<RepLoadOrderRow> = emptyList(),
    val documents: List<RepDocumentRow> = emptyList(),
    val collections: List<RepCollectionRow> = emptyList(),
    val totals: RepTotals? = null,
    val custody: RepCustody? = null,
    val windows: RepWindows? = null,
    val notifications: List<RepNotificationRow> = emptyList(),
    val message: String? = null,
) {
    /** أوامرُ يُباع منها الآن: `loaded` وفيها متبقٍّ بحسب الخادم (expectedRemainingQty). */
    val saleableLoadOrders: List<RepLoadOrderRow>
        get() = loadOrders.filter {
            it.status == "loaded" && Dec.isPositive(it.expectedRemainingQty)
        }

    /** مستنداتٌ يُرجَع منها: صفوف البيع وحدها (فالخادمُ يرفض مرتجعَ مرتجع). */
    val returnableDocuments: List<RepDocumentRow> get() = documents.filter { it.isSale }

    /** فواتيرُ آجلةٌ غير مسدَّدة — هدفُ شاشة التحصيل. */
    val unpaidSaleDocuments: List<RepDocumentRow>
        get() = documents.filter { it.isSale && Dec.isPositive(it.outstanding) }
}

/**
 * صفُّ بطاقة عميل من `GET /parties?kind=customer` — مصفوفةٌ خامٌ بلا غلاف data،
 * والحقول camelCase (name لا nameAr).
 */
@Serializable
data class PartyDto(
    val id: String,
    val code: String = "",
    val kind: String = "customer",
    val name: String = "",
    val legalName: String? = null,
    val taxNo: String? = null,
    val phone: String? = null,
    val creditLimit: String? = null,
    val address: JsonObject? = null,
    val customFields: JsonObject? = null,
) {
    val displayName: String get() = if (code.isNotBlank()) "$name ($code)" else name
}
