package com.erpcloud.bakery.data.api

import kotlinx.serialization.Serializable

/**
 * عقدُ `GET /van-sales/dashboard` — مرجعُ شاشات الإنتاج والتوزيع والعهدة والتحصيل
 * والتسعير في تطبيقٍ واحد. كلُّ حقلٍ هنا مأخوذٌ حرفيًّا من `van-sales.service.ts`
 * (‏`dashboard()` — التخطيط النهائي بعد `mapProductionBatchRow` وتخطيط الأحمال)،
 * والأرقامُ نصوصٌ لأنّ الخادم يرسل `numeric` نصًّا، والحقلُ الغائب يبقى غائبًا
 * (null) فتقول الشاشة «—» ولا تُخترع قيمة.
 */

// ---------------------------------------------------------- نوافذُ الخادم

/** إعلانُ نافذةٍ: ما رجع من القائمة وما في الجدول كلّه وسقفُ النافذة. */
@Serializable
data class WindowDto(
    val returned: Int = 0,
    val total: Int = 0,
    val limit: Int = 0,
)

@Serializable
data class DashboardWindowsDto(
    val productionBatches: WindowDto? = null,
    val loadOrders: WindowDto? = null,
    val documents: WindowDto? = null,
    val movements: WindowDto? = null,
    val customerPriceHistory: WindowDto? = null,
)

// ------------------------------------------------------------- السياسة

@Serializable
data class ZatcaSellerDto(
    val ready: Boolean = false,
    val missingFields: List<String> = emptyList(),
    val refusalDetail: String? = null,
)

@Serializable
data class DashboardPolicyDto(
    val allowInternalDeliveryWithoutTax: Boolean = false,
    val preventSelfApproval: Boolean = false,
    /** `unconfigured` | `unit_cost` | `selling_price` */
    val shortageValuationBasis: String = "unconfigured",
    val zatcaSeller: ZatcaSellerDto? = null,
)

// -------------------------------------------------------- جاهزية الترحيل

@Serializable
data class PostingReadinessDto(
    val branchId: String? = null,
    val salesInvoice: Boolean = false,
    val stockTransfer: Boolean = false,
    val receiptVoucher: Boolean = false,
    val message: String? = null,
)

// -------------------------------------------------------------- المجاميع

@Serializable
data class DashboardSummaryDto(
    val totalProducedKg: String = "0",
    val totalScrapKg: String = "0",
    val mainWarehouseBalanceKg: String = "0",
    val vanWarehousesBalanceKg: String = "0",
    val derivedMainWarehouseBalanceKg: String = "0",
    val stockLedgerAgrees: Boolean = true,
    val inTransitKg: String = "0",
    val inTransitValueSar: String = "0",
    val inTransitTransfersCount: Int = 0,
    val totalProductionCostSar: String = "0",
    val totalLoadedKg: String = "0",
    val totalSoldKg: String = "0",
    val totalBonusKg: String = "0",
    val totalReturnedKg: String = "0",
    val totalDamagedKg: String = "0",
    val totalShortageKg: String = "0",
    val totalShortageSar: String = "0",
    val remainingInVansKg: String = "0",
    val totalZatcaSalesSar: String = "0",
    val totalInternalSalesSar: String = "0",
    val totalRevenueSar: String = "0",
    val totalSalesGrossSar: String = "0",
    val totalReturnsSar: String = "0",
    val totalReturnsVatSar: String = "0",
    val returnDocumentCount: Int = 0,
    val returnsWithoutCostCount: Int = 0,
    val totalCollectedCashSar: String = "0",
    val totalCreditReceivablesSar: String = "0",
    val totalNetProfitSar: String = "0",
    val anomalyCount: Int = 0,
    val pendingClosingsCount: Int = 0,
    val pendingReceiptsCount: Int = 0,
    val pendingStockSettlementsCount: Int = 0,
    val pendingTransitDecisionsCount: Int = 0,
)

// --------------------------------------------------------------- الأرصدة

/** صفُّ رصيدٍ رسمي كما يعود في `officialStock`. */
@Serializable
data class OfficialStockRowDto(
    val itemId: String? = null,
    val itemName: String? = null,
    val warehouseId: String? = null,
    val warehouseName: String? = null,
    val quantity: String? = null,
    val averageCost: String? = null,
)

// ---------------------------------------------------------- دفعات الإنتاج

@Serializable
data class ProductionBatchDto(
    val id: String = "",
    val batchNo: String = "",
    val productionDate: String = "",
    val itemId: String? = null,
    val warehouseId: String? = null,
    val productionOrderId: String? = null,
    val manufacturingOrderId: String? = null,
    val lotId: String? = null,
    val inventoryTransactionId: String? = null,
    val itemName: String = "",
    val producedQty: String = "0",
    val scrapQty: String = "0",
    val issuedQty: String = "0",
    val returnedGoodQty: String = "0",
    val damagedQty: String = "0",
    /** المتاحُ بالمستودع = المنتج − المُصدَر + المرتجع الصالح − التالف. */
    val availableWarehouseQty: String = "0",
    val unitCost: String = "0",
    val totalCost: String = "0",
    /** `manufacturing_order` | `manual_input_or_item_cost` — كما كُتب ساعة الإنشاء. */
    val costBasis: String = "",
    val scrapValue: String = "0",
    val scrapCostLoaded: Boolean = false,
    /** `active` | `exhausted` | `closed` */
    val status: String = "active",
    val supervisorName: String = "",
    val notes: String = "",
)

// ---------------------------------------------------- أوامرُ التحميل

/**
 * أمرُ تحميلٍ كما يُخطَّطه الخادم للّوحة — الحقولُ الكاملة التي تقرؤها شاشات
 * التوزيع والعهدة. كميّاتُه نصوصٌ عشرية، و`null` يعني «لم يُقل» لا صفر.
 */
@Serializable
data class LoadOrderDto(
    val id: String = "",
    val number: String = "",
    val loadDate: String = "",
    val productionBatchNo: String = "",
    val vehiclePlate: String = "",
    /** `pending_receipt` | `loaded` | `in_route` | `pending_closing` |
     *  `pending_stock_settlement` | `settled` | `cancelled` | … */
    val status: String = "",
    val salesmanId: String = "",
    val salesmanName: String = "",
    val warehouseId: String? = null,
    val vanWarehouseId: String? = null,
    val stockTransferId: String? = null,
    val returnTransferId: String? = null,
    val damageVoucherId: String? = null,
    val approvalRequestId: String? = null,
    val shortagePolicyStatus: String = "pending_policy_approval",
    val itemId: String? = null,
    val itemName: String = "",
    val loadedQty: String = "0",
    val receivedQty: String = "0",
    val discrepancyQty: String = "0",
    val discrepancyNotes: String = "",
    val receivedAt: String? = null,
    val awaitingReceipt: Boolean = false,
    val soldQty: String = "0",
    val bonusQty: String = "0",
    val returnedQty: String = "0",
    val damagedQty: String = "0",
    val shortageQty: String = "0",
    val shortageValue: String = "0",
    /** المتبقّي تحت يد المندوب من هذا الأمر (صفرٌ بعد التسوية). */
    val remainingQty: String = "0",
    val actualRemainingQty: String = "0",
    val vehicleCountQty: String? = null,
    val otherCustodyQty: String? = null,
    /** ما يجب أن يبقى للجرد: العهدة − مبيع − مجاني − مرتجع − تالف. */
    val expectedRemainingQty: String = "0",
    /** موجب = عجزٌ بالجرد، سالب = فائض يُعرض للمراجعة. */
    val countVarianceQty: String = "0",
    val stockAdjustmentId: String? = null,
    /** `return_to_main` | `carry_over` — مصيرُ المتبقّي الفعلي. */
    val remainingAction: String? = null,
    val remainingInventoryTxId: String? = null,
    val countVarianceCostValue: String = "0",
    val countDocumentVarianceValue: String? = null,
    val countDocumentVarianceQty: String? = null,
    val countDocumentExpectedQty: String? = null,
    val vanOfficialQty: String? = null,
    val otherCustodyInVanQty: String? = null,
    val vanStockShortOfCustodyQty: String? = null,
    val stockSettlementStatus: String = "not_required",
    val stockSettlementNote: String = "",
    val damageJournalEntryId: String? = null,
    val shortageJournalEntryId: String? = null,
    val shortageChargeBasis: String? = null,
    val shortageChargeAmount: String? = null,
    val awaitingStockSettlement: Boolean = false,
    val awaitingTransitDecision: Boolean = false,
    val maxBonusQty: String = "0",
    val maxBonusPct: String = "0",
    val expectedCash: String = "0",
    val collectedCash: String = "0",
    val cashVariance: String = "0",
    val damageReason: String = "",
    val damageInspected: Boolean = false,
    val salaryDeductionApproved: Boolean = false,
    val closingNotes: String = "",
    val closingSubmittedAt: String? = null,
    val approvedAt: String? = null,
    val approvedByLabel: String = "",
    val notes: String = "",
)

// ----------------------------------------------------------- التسعير

@Serializable
data class CustomerPriceDto(
    val id: String = "",
    val partyId: String = "",
    val partyName: String = "",
    val partyCode: String = "",
    val partyTaxNo: String = "",
    val itemId: String? = null,
    val itemName: String = "",
    val priceTierLabel: String = "",
    val unitPrice: String = "0",
    val maxBonusPct: String = "0",
    val maxBonusKgPerInvoice: String = "0",
    /** `zatca_tax` | `internal_delivery` */
    val preferredInvoiceMode: String = "",
    val creditLimit: String = "0",
    val paymentTermsDays: Int = 15,
    val lockPrice: Boolean = true,
    val maxDiscountPct: String = "0",
    val effectiveFrom: String = "",
    val effectiveTo: String? = null,
    val changeReason: String = "",
    val notes: String = "",
)

@Serializable
data class PriceHistoryDto(
    val id: String = "",
    val customerPriceId: String = "",
    val partyId: String = "",
    val partyName: String = "",
    val itemId: String? = null,
    val itemName: String = "",
    val previousUnitPrice: String? = null,
    val newUnitPrice: String = "0",
    val maxBonusPct: String = "0",
    val maxBonusKgPerInvoice: String = "0",
    val maxDiscountPct: String = "0",
    val lockPrice: Boolean = true,
    val effectiveFrom: String = "",
    val effectiveTo: String? = null,
    val changeReason: String = "",
    val changedByLabel: String = "",
    val createdAt: String = "",
)

// ------------------------------------------------------------ المستندات

@Serializable
data class DocumentDto(
    val id: String = "",
    val number: String = "",
    val docDate: String = "",
    /** `zatca_tax` | `internal_delivery` */
    val invoiceMode: String = "",
    val taxPolicyStatus: String = "standard_vat",
    /** `cash` | `card` | `credit` */
    val paymentMethod: String = "",
    /** `sale` | `sale_return` */
    val documentKind: String = "sale",
    val referenceDocumentId: String? = null,
    val invoiceNumber: String? = null,
    val invoiceStatus: String? = null,
    val productionBatchNo: String = "",
    val loadOrderId: String? = null,
    val salesInvoiceId: String? = null,
    val receiptVoucherId: String? = null,
    val stockDeliveryId: String? = null,
    val salesmanId: String? = null,
    val salesmanName: String = "",
    val partyId: String? = null,
    val customerName: String = "",
    val customerTaxNo: String = "",
    val itemId: String? = null,
    val itemName: String = "",
    val soldQty: String = "0",
    val bonusQty: String = "0",
    val bonusReason: String = "",
    val unitPrice: String = "0",
    val discountAmount: String = "0",
    val discountReason: String = "",
    val subtotal: String = "0",
    val taxRate: String = "0",
    val taxTotal: String = "0",
    val total: String = "0",
    val paidAmount: String = "0",
    val unitCost: String = "0",
    val netProfit: String = "0",
    val customerBonusConfirmed: Boolean = false,
    val customerConfirmationCode: String = "",
    val bonusAnomaly: Boolean = false,
    val anomalyReason: String = "",
    val qrPayload: String = "",
    val notes: String = "",
    val voidedAt: String? = null,
    val createdAt: String = "",
)

// -------------------------------------------------------------- الحركات

@Serializable
data class MovementDto(
    val id: String = "",
    val movementType: String = "",
    val batchNo: String = "",
    val qty: String = "0",
    val unitPrice: String = "0",
    val amount: String = "0",
    val reason: String = "",
    val inventoryTransactionId: String? = null,
    val voucherId: String? = null,
    val salesmanName: String = "",
    val customerName: String = "",
    val actorLabel: String = "",
    val approvedByLabel: String = "",
    val createdAt: String = "",
)

// ------------------------------------------------- أداءُ المناديب (اللوحة)

@Serializable
data class RepPerformanceDto(
    val salesmanId: String = "",
    val salesmanName: String = "",
    val loadedKg: String = "0",
    val soldKg: String = "0",
    val bonusKg: String = "0",
    val returnedKg: String = "0",
    val damagedKg: String = "0",
    val shortageKg: String = "0",
    val shortageSar: String = "0",
    val custodyRemainingKg: String = "0",
    val revenueSar: String = "0",
    val salesGrossSar: String = "0",
    val returnsSar: String = "0",
    val returnsVatSar: String = "0",
    val collectedSar: String = "0",
    val creditDebtSar: String = "0",
    val netProfitSar: String = "0",
    val pendingClosings: Int = 0,
)

// ----------------------------------------------------------- اللوحة كلّها

@Serializable
data class DashboardDto(
    val policy: DashboardPolicyDto? = null,
    val officialStock: List<OfficialStockRowDto> = emptyList(),
    val mainWarehouseId: String? = null,
    val postingReadiness: PostingReadinessDto? = null,
    val windows: DashboardWindowsDto? = null,
    val summary: DashboardSummaryDto = DashboardSummaryDto(),
    val productionBatches: List<ProductionBatchDto> = emptyList(),
    val repPerformance: List<RepPerformanceDto> = emptyList(),
    val loadOrders: List<LoadOrderDto> = emptyList(),
    val customerPrices: List<CustomerPriceDto> = emptyList(),
    val customerPriceHistory: List<PriceHistoryDto> = emptyList(),
    val documents: List<DocumentDto> = emptyList(),
    val movements: List<MovementDto> = emptyList(),
)
