package com.erpcloud.bakery.data.api

import kotlinx.serialization.Serializable

/**
 * عقودُ بطاقات المناديب والسياسة والتقارير والبحث — موقّعةٌ على الخادم:
 * ‏`listSalesmenWithCustody` و`linkSalesmanAccount` و`readShortagePolicy` و
 * `getReports`، وعلى صفحة المستودعات `ListEnvelope` وأصناف الكتالوج (drizzle ⇒
 * camelCase) والعملاء (`/parties` مصفوفةٌ خام).
 */

// --------------------------------------------------------- بطاقةُ مندوب

@Serializable
data class SalesmanCustodyItemDto(
    val itemId: String = "",
    val itemName: String = "",
    val warehouseName: String = "",
    val quantity: String = "0",
    val value: String = "0",
)

@Serializable
data class SalesmanCustodyDto(
    val openLoadOrders: Int = 0,
    val pendingReceipts: Int = 0,
    val pendingClosings: Int = 0,
    /** ما بقي تحت يده من الأوامر المفتوحة كلّها. */
    val custodyQty: String = "0",
    /** النقدُ المتوقّع ولم يُحصّل بعد. */
    val outstandingCash: String = "0",
    val items: List<SalesmanCustodyItemDto> = emptyList(),
)

/** ما ينقص البطاقة قبل أن يعمل المندوب — حسبه الخادم، ولا يُعاد حسابه هنا. */
@Serializable
data class SalesmanReadinessDto(
    val hasEmployee: Boolean = false,
    val hasLoginAccount: Boolean = false,
    val loginActive: Boolean = false,
    val hasVanWarehouse: Boolean = false,
    val hasVanSalesPermissions: Boolean = false,
)

@Serializable
data class SalesmanCardDto(
    val id: String = "",
    val name: String = "",
    val active: Boolean = true,
    val employeeRef: String? = null,
    val commissionRate: String = "0",
    val collectionCommissionRate: String = "0",
    val profitCommissionRate: String = "0",
    val tel: String? = null,
    val mobile: String? = null,
    val email: String? = null,
    val notes: String? = null,
    val employeeId: String? = null,
    val employeeNo: String? = null,
    val employeeName: String? = null,
    val employeeStatus: String? = null,
    val membershipId: String? = null,
    val membershipStatus: String? = null,
    val userEmail: String? = null,
    val userStatus: String? = null,
    val roleCount: Int = 0,
    val permissions: List<String> = emptyList(),
    val warehouseId: String? = null,
    val warehouseName: String? = null,
    val warehouseCode: String? = null,
    val vehiclePlate: String? = null,
    val custody: SalesmanCustodyDto = SalesmanCustodyDto(),
    val readiness: SalesmanReadinessDto = SalesmanReadinessDto(),
)

/** إيصالُ `POST /van-sales/salesmen/{id}/account`. */
@Serializable
data class LinkAccountReceiptDto(
    val salesmanId: String = "",
    val salesmanName: String = "",
    val membershipId: String = "",
    val email: String = "",
    val requestedEmail: String = "",
    val reusedExistingAccount: Boolean = false,
    val status: String = "",
    val roleId: String = "",
    val roleName: String = "",
    val employeeLinked: Boolean = false,
    val scopedToVanWarehouse: Boolean = false,
    /** الحسابُ الجديدُ بلا كلمة مرور — يُرسل رابطَ التفعيل الرسميّ. */
    val activationRequired: Boolean = false,
)

// ------------------------------------------------------------ السياسة

@Serializable
data class PolicyReadinessDto(
    val salesmanId: String = "",
    val employeeLinked: Boolean = false,
    val employeeAccountReady: Boolean = false,
    val employeeAccountId: String? = null,
    val employeeAccountName: String? = null,
    val creditAccountMapped: Boolean = false,
    val creditAccountName: String? = null,
    val ready: Boolean = false,
    val blockingReason: String? = null,
)

@Serializable
data class PolicyChargeAccountDto(
    val id: String = "",
    val name: String = "",
    val code: String = "",
)

@Serializable
data class ShortagePolicyDto(
    /** `unconfigured` | `unit_cost` | `selling_price` */
    val shortageValuationBasis: String = "unconfigured",
    val shortageUnitPrice: String? = null,
    val preventSelfApproval: Boolean = false,
    val allowInternalDeliveryWithoutTax: Boolean = false,
    val zatcaSeller: ZatcaSellerDto? = null,
    /** الحقيقةُ لا `shortageValuationBasis` وحده: سعرٌ صريحٌ يتقدّم على الأساس. */
    val valuationSource: String = "",
    val configured: Boolean = false,
    val writableKeys: List<String> = emptyList(),
    val chargeCreditAccount: PolicyChargeAccountDto? = null,
    val salesmanReadiness: PolicyReadinessDto? = null,
)

// ------------------------------------------------------------ التقارير

@Serializable
data class RepCustodyRowDto(
    val salesmanId: String? = null,
    val salesmanName: String? = null,
    val loadedKg: String? = null,
    val soldKg: String? = null,
    val bonusKg: String? = null,
    val returnedKg: String? = null,
    val damagedKg: String? = null,
    val shortageKg: String? = null,
    val shortageSar: String? = null,
    val custodyRemainingKg: String? = null,
    val revenueSar: String? = null,
    val collectedSar: String? = null,
    val creditDebtSar: String? = null,
    val netProfitSar: String? = null,
    val pendingClosings: Int? = null,
)

/**
 * حمولةُ `GET /van-sales/reports` — الجداولُ العامّة (`transfersReport` وما معها)
 * صفوفٌ حرّةُ المفاتيح، فيُعرض منها على الجوال ما نُمِّطَ (`repCustodyReport`)
 * وتظلُّ البقيّةُ في النصّ الكامل على الويب، والمجاميعُ هنا بلا اختراع.
 */
@Serializable
data class ReportsPayloadDto(
    val generatedAt: String? = null,
    val rowCap: Int? = null,
    val policy: kotlinx.serialization.json.JsonObject? = null,
    val summary: kotlinx.serialization.json.JsonObject? = null,
    val periodTotals: kotlinx.serialization.json.JsonObject? = null,
    val repCustodyReport: List<RepCustodyRowDto> = emptyList(),
)

// --------------------------------------------------------------- البحث

/** صنفُ كتالوج — صفوف drizzle ⇒ camelCase، والاسم من أيّ تهجئةٍ يقولها الخادم. */
@Serializable
data class ItemOptionDto(
    val id: String = "",
    val sku: String? = null,
    val nameAr: String? = null,
    val name: String? = null,
    val nameEn: String? = null,
    val trackLot: Boolean? = null,
) {
    val label: String
        get() = listOfNotNull(nameAr, name, nameEn, sku).firstOrNull { it.isNotBlank() }
            ?: id
}

@Serializable
data class WarehouseOptionDto(
    val id: String = "",
    val code: String? = null,
    val name: String? = null,
    val nameAr: String? = null,
    val isDefault: Boolean? = null,
    val isActive: Boolean? = null,
    val branchId: String? = null,
) {
    val label: String
        get() = listOfNotNull(nameAr, name, code).firstOrNull { it.isNotBlank() } ?: id
}

/** صفحةُ مستودعات `{ data: [...], meta }` — نقرأ `data` وحدها. */
@Serializable
data class WarehousesPageDto(
    val data: List<WarehouseOptionDto> = emptyList(),
)

@Serializable
data class PartyDto(
    val id: String = "",
    val code: String = "",
    val kind: String = "customer",
    val name: String = "",
    val legalName: String? = null,
    val taxNo: String? = null,
    val phone: String? = null,
    val creditLimit: String? = null,
    val address: kotlinx.serialization.json.JsonObject? = null,
) {
    val displayName: String get() = if (code.isNotBlank()) "$name ($code)" else name
}
