package com.erpcloud.bakery.data.api

import kotlinx.serialization.Serializable

/**
 * عقودُ وحدات «الطاقم» المنقولة إلى تطبيق المخابز — كلُّ حقلٍ هنا موقّعٌ على
 * المتحكّمات الرسميّة في `apps/api`:
 *
 * - الكتالوج: `organization/catalog` (أصناف/وحدات/مجموعات/وحدات الصنف).
 * - المشتريات: `purchase-invoices` + `parties?kind=supplier`.
 * - المخزون: `inventory/vouchers` (بضاعة أول المدة والإدخال/الإخراج) + `branches` + `cash-locations`.
 * - نقطة البيع: `pos/offline-data` و`pos/checkout`.
 * - الموارد البشريّة: `hrm` (الموظفون/المنصرفات/الرواتب/كشف الحساب/أذون الصرف).
 * - المنظّمة: `sales/salesmen` (سجلّ المناديب) و`memberships` و`roles` و`permissions`.
 * - التقارير: `reports` (الفهرس) و`reports/:key` (تشغيل تقرير).
 *
 * القاعدةُ كما في بقية التطبيق: الردودُ الرقميّةُ نصوصٌ (numeric من PostgreSQL)،
 * والحقلُ الغائب `null`/افتراضيٌّ — لا يُخترع رقمٌ ولا يُحسب في الجهاز.
 */

// ------------------------------------------------------------ الكتالوج

/** صفُّ مجموعةٍ — `GET /organization/catalog/categories` (مصفوفة drizzle خام). */
@Serializable
data class CategoryDto(
    val id: String = "",
    val code: String = "",
    val nameAr: String = "",
    val nameEn: String? = null,
    val parentId: String? = null,
    val sortOrder: Int? = null,
)

/** صفُّ وحدة قياس — `GET /organization/catalog/units`. */
@Serializable
data class UnitDto(
    val id: String = "",
    val code: String = "",
    val nameAr: String = "",
    val nameEn: String? = null,
)

/** صفُّ صنف — `GET /organization/catalog/items` (كما في شاشة الويب نفسها). */
@Serializable
data class CatalogItemDto(
    val id: String = "",
    val sku: String = "",
    val barcode: String? = null,
    val nameAr: String = "",
    val nameEn: String? = null,
    val categoryId: String? = null,
    val baseUnitId: String? = null,
    val kind: String = "stock",
    val salePrice: String? = null,
    val purchasePrice: String? = null,
    val minQty: String? = null,
    val maxQty: String? = null,
    val trackLot: Boolean = false,
    val trackSerial: Boolean = false,
    val showInPos: Boolean = false,
    val active: Boolean? = null,
    val deletedAt: String? = null,
)

/** صفُّ وحدة صنف — `GET /organization/catalog/items/{id}/units`. */
@Serializable
data class ItemUnitDto(
    val itemId: String = "",
    val unitId: String = "",
    val unitCode: String = "",
    val unitNameAr: String = "",
    /** كم وحدةً أساسيّةً في الواحدة من هذه الوحدة (كرتون 12 ⇒ ratio = 12). */
    val ratio: String = "1",
    val barcode: String? = null,
    val salePrice: String? = null,
    val purchasePrice: String? = null,
    val isDefaultSale: Boolean = false,
    val isDefaultPurchase: Boolean = false,
)

// ------------------------------------------------------------ الفروع والخزائن

/** صفُّ فرع — `GET /branches` (غلافُ صفحةٍ `{data, meta}`). */
@Serializable
data class BranchDto(
    val id: String = "",
    val nameAr: String = "",
    val nameEn: String? = null,
    val code: String? = null,
    val isActive: Boolean = true,
    val isDefault: Boolean = false,
)

/** غلافُ صفحةٍ `{data: [...]}` — للفروع والخزائن والعضويّات والأدوار. */
@Serializable
data class BranchPageDto(val data: List<BranchDto> = emptyList())

@Serializable
data class CashLocationPageDto(val data: List<CashLocationDto> = emptyList())

@Serializable
data class MembershipPageDto(val data: List<MembershipDto> = emptyList())

@Serializable
data class RolePageDto(val data: List<RoleDto> = emptyList())

/** صفُّ خزينة — `GET /cash-locations`. */
@Serializable
data class CashLocationDto(
    val id: String = "",
    val name: String = "",
    val kind: String = "cash",
    val branchId: String? = null,
    val isActive: Boolean = true,
    val isDefault: Boolean = false,
    val changeInPos: Boolean = false,
)

// ------------------------------------------------------------ المشتريات

/** صفُّ فاتورة مشتريات — `GET /purchase-invoices` (مصفوفة drizzle خام). */
@Serializable
data class PurchaseInvoiceDto(
    val id: String = "",
    val number: String = "",
    val invoiceDate: String? = null,
    val partyId: String? = null,
    val partyName: String? = null,
    val branchId: String? = null,
    val warehouseId: String? = null,
    val kind: String = "purchase",
    val status: String = "draft",
    val supplierReferenceNo: String? = null,
    val currency: String? = null,
    val subtotal: String? = null,
    val taxTotal: String? = null,
    val total: String? = null,
    val paidTotal: String? = null,
    val paymentStatus: String? = null,
    val createdAt: String? = null,
    val notes: String? = null,
)

// ------------------------------------------------------------ سندات المخزون

/** سطرُ سندٍ مخزنيّ. */
@Serializable
data class VoucherLineDto(
    val id: String = "",
    val itemId: String = "",
    val itemName: String? = null,
    val qty: String = "0",
    val unitCost: String? = null,
    val batchNo: String? = null,
    val expiryDate: String? = null,
    val note: String? = null,
)

/** صفُّ سندٍ مخزنيّ — `GET /inventory/vouchers` (بضاعة أول المدة/إدخال/إخراج). */
@Serializable
data class StockVoucherDto(
    val id: String = "",
    val number: String = "",
    val kind: String = "opening",
    val status: String = "draft",
    val voucherDate: String? = null,
    val branchId: String? = null,
    val warehouseId: String? = null,
    val warehouseName: String? = null,
    val reason: String? = null,
    val notes: String? = null,
    val createdAt: String? = null,
    val lines: List<VoucherLineDto> = emptyList(),
)

/** صفُّ قائمة موادّ (BOM) — `GET /manufacturing/boms` (`{data}`). */
@Serializable
data class BomDto(
    val id: String = "",
    val name: String = "",
    val version: Int? = null,
    val productItemId: String? = null,
    val lines: List<BomLineDto> = emptyList(),
)

@Serializable
data class BomLineDto(
    val id: String = "",
    val componentItemId: String = "",
    val qty: String = "0",
    val unitId: String? = null,
)

// ------------------------------------------------------------ نقطة البيع

/** صنفُ كتالوج نقطة البيع — من `pos/offline-data` (`showInPos`). */
@Serializable
data class PosItemDto(
    val id: String = "",
    val sku: String = "",
    val barcode: String? = null,
    val nameAr: String = "",
    val nameEn: String? = null,
    val categoryId: String? = null,
    val baseUnitId: String? = null,
    val kind: String = "stock",
    val salePrice: String? = null,
    val taxGroupId: String? = null,
    val trackLot: Boolean = false,
    val trackSerial: Boolean = false,
)

/** مجموعةُ أصنافٍ لنقطة البيع. */
@Serializable
data class PosCategoryDto(
    val id: String = "",
    val code: String = "",
    val nameAr: String = "",
    val nameEn: String? = null,
    val sortOrder: Int? = null,
)

/** عميلٌ نقديّ/مسجّل في بيانات نقطة البيع. */
@Serializable
data class PosCustomerDto(
    val id: String = "",
    val name: String = "",
    val kind: String? = null,
    val mobile: String? = null,
)

/** حزمةُ بيانات نقطة البيع دون اتصال — `GET /pos/offline-data` (`{data}`). */
@Serializable
data class PosOfflineDataDto(
    val schemaVersion: Int = 1,
    val generatedAt: String? = null,
    val items: List<PosItemDto> = emptyList(),
    val categories: List<PosCategoryDto> = emptyList(),
    val customers: List<PosCustomerDto> = emptyList(),
    val branches: List<BranchDto> = emptyList(),
    val warehouses: List<WarehouseOptionDto> = emptyList(),
    val cashLocations: List<CashLocationDto> = emptyList(),
    val defaults: PosDefaultsDto = PosDefaultsDto(),
)

@Serializable
data class PosDefaultsDto(
    val branchId: String? = null,
    val warehouseId: String? = null,
    val cashLocationId: String? = null,
)

/** إيصالُ بيعة نقطة البيع — `POST /pos/checkout` (`{data}`). */
@Serializable
data class PosCheckoutReceiptDto(
    val invoiceId: String = "",
    val number: String = "",
    val subtotal: String? = null,
    val taxTotal: String? = null,
    val total: String? = null,
    val paidTotal: String? = null,
    val paymentStatus: String? = null,
    val method: String? = null,
    val change: String? = null,
    val shiftId: String? = null,
)

// ------------------------------------------------------------ الموارد البشريّة

/** صفُّ موظف — `GET /hrm/employees` (بطاقة drizzle camelCase). */
@Serializable
data class EmployeeDto(
    val id: String = "",
    val employeeNo: String = "",
    val name: String = "",
    val status: String = "active",
    val branchId: String? = null,
    val departmentId: String? = null,
    val departmentName: String? = null,
    val managementName: String? = null,
    val jobId: String? = null,
    val jobName: String? = null,
    val membershipId: String? = null,
    val hireDate: String? = null,
    val phone: String? = null,
    val mobile: String? = null,
    val email: String? = null,
    val nationalId: String? = null,
    val nationality: String? = null,
    val accountCode: String? = null,
    val totalSalary: String? = null,
    val salaryComponents: Map<String, String> = emptyMap(),
)

/** صفُّ قسم — `GET /hrm/departments`. */
@Serializable
data class DepartmentDto(
    val id: String = "",
    val code: String = "",
    val name: String = "",
    val parentId: String? = null,
)

/** صفُّ وظيفة — `GET /hrm/jobs`. */
@Serializable
data class JobDto(
    val id: String = "",
    val code: String = "",
    val name: String = "",
)

/** صفُّ نوع منصرف/استقطاع — `GET /hrm/adjustment-types` (صفوف drizzle خام). */
@Serializable
data class AdjustmentTypeDto(
    val id: String = "",
    val code: String = "",
    val name: String = "",
    val kind: String = "deduction",
    val sortOrder: Int? = null,
    val isActive: Boolean? = null,
)

/** صفُّ منصرف/استقطاع — `GET /hrm/adjustments`. */
@Serializable
data class AdjustmentDto(
    val id: String = "",
    val employeeId: String = "",
    val employeeName: String? = null,
    val employeeNo: String? = null,
    val typeId: String? = null,
    val typeCode: String? = null,
    val typeName: String? = null,
    val typeKind: String? = null,
    val cashLocationName: String? = null,
    val number: String? = null,
    val kind: String = "deduction",
    val componentCode: String = "",
    val valueText: String = "0",
    val startsOn: String? = null,
    val endsOn: String? = null,
    val recurring: Boolean = false,
    val subFromSalary: Boolean = false,
    val paymentMethod: String? = null,
    val reason: String? = null,
    val status: String = "draft",
    val createdAt: String? = null,
)

/** صفُّ مسيّر رواتب — `GET /hrm/payroll/runs` (`{data}`). */
@Serializable
data class PayrollRunDto(
    val id: String = "",
    val yearMonth: String = "",
    val periodId: String? = null,
    val currency: String? = null,
    val status: String = "draft",
    /** عمودُ jsonb عند الخادم: `{preview: {…}}`. */
    val summary: PayrollSummaryEnvelopeDto? = null,
    val createdAt: String? = null,
)

@Serializable
data class PayrollSummaryEnvelopeDto(
    val preview: PayrollPreviewDto? = null,
)

/** معاينةُ المسيّرة كما تحسبها `payroll/preview` — أرقامُها نصوصٌ `toFixed(4)`. */
@Serializable
data class PayrollPreviewDto(
    val yearMonth: String? = null,
    val employeeCount: Int = 0,
    val netPayable: String? = null,
    val lines: List<PayrollLineDto> = emptyList(),
)

@Serializable
data class PayrollLineDto(
    val employeeId: String = "",
    val employeeName: String = "",
    val components: Map<String, String> = emptyMap(),
    val gross: String = "0",
    val additions: String = "0",
    val deductions: String = "0",
    val net: String = "0",
    val unpaidFactor: String? = null,
)

/** كشفُ حساب موظف — `GET /hrm/employee-statement` (`{data}`). */
@Serializable
data class EmployeeStatementDto(
    val employee: EmployeeRefDto = EmployeeRefDto(),
    val branchId: String? = null,
    val from: String? = null,
    val to: String? = null,
    val fullPeriod: Boolean = false,
    val summary: EmployeeStatementSummaryDto = EmployeeStatementSummaryDto(),
    val rows: List<EmployeeStatementRowDto> = emptyList(),
)

@Serializable
data class EmployeeRefDto(
    val id: String = "",
    val employeeNo: String = "",
    val name: String = "",
    val accountCode: String? = null,
    val accountName: String? = null,
)

@Serializable
data class EmployeeStatementSummaryDto(
    val totalDebit: String? = null,
    val totalCredit: String? = null,
    val balanceDebit: String? = null,
    val balanceCredit: String? = null,
)

@Serializable
data class EmployeeStatementRowDto(
    val seq: Int = 0,
    val date: String = "",
    val entryId: String? = null,
    val entryNumber: String? = null,
    val description: String? = null,
    val debit: String = "0",
    val credit: String = "0",
    val employee: String? = null,
    val runningBalance: String? = null,
    val balanceStatus: String? = null,
    val branchName: String? = null,
    val entryType: String = "",
)

/** صفُّ إذن صرف راتب — `GET /hrm/salary-payments`. */
@Serializable
data class SalaryPaymentDto(
    val id: String = "",
    val number: String = "",
    val employeeId: String = "",
    val employeeName: String? = null,
    val employeeNo: String? = null,
    val branchId: String? = null,
    val branchName: String? = null,
    val runId: String? = null,
    val yearMonth: String = "",
    val year: String? = null,
    val month: String? = null,
    val paymentDate: String? = null,
    val method: String? = null,
    val cashLocationId: String? = null,
    val cashLocationName: String? = null,
    val responsibleName: String? = null,
    val basic: String? = null,
    val housing: String? = null,
    val transport: String? = null,
    val otherAllowances: String? = null,
    val additions: String? = null,
    val deductions: String? = null,
    val net: String? = null,
    val notes: String? = null,
    val voucherNumber: String? = null,
    val voucherStatus: String? = null,
    val createdAt: String? = null,
)

// ------------------------------------------------------------ الخزينة والمصروفات

/** صفُّ سند قبض/صرف — `GET /vouchers` (مصفوفة drizzle خام، آخر 500). */
@Serializable
data class TreasuryVoucherDto(
    val id: String = "",
    val branchId: String? = null,
    /** receipt = قبض · payment = صرف. */
    val kind: String = "receipt",
    /** customer · supplier · expense · account · salary · vat · other. */
    val subtype: String = "customer",
    val number: String = "",
    val date: String? = null,
    val partyId: String? = null,
    val counterAccountId: String? = null,
    val cashLocationId: String? = null,
    /** cash · cheque · bank_transfer · card. */
    val method: String = "cash",
    val amount: String? = null,
    val vatAmount: String? = null,
    val netAmount: String? = null,
    val currency: String? = null,
    val chequeNo: String? = null,
    val chequeDate: String? = null,
    val bankName: String? = null,
    val chequeState: String? = null,
    val referenceNo: String? = null,
    val recipient: String? = null,
    val description: String? = null,
    val voucherTime: String? = null,
    val status: String = "draft",
    val postedAt: String? = null,
    val voidedAt: String? = null,
    val createdAt: String? = null,
    val createdByName: String? = null,
)

/** صفُّ حسابٍ من دليل الحسابات — `GET /accounts` (`{data}`) للسند ذي الحساب المقابل. */
@Serializable
data class AccountDto(
    val id: String = "",
    val code: String = "",
    val nameAr: String? = null,
    val nameEn: String? = null,
    val nameArLegacy: String? = null,
    val type: String? = null,
    val accountType: String? = null,
    val isPostable: Boolean? = null,
    val isPostableLegacy: Boolean? = null,
) {
    val label: String get() = nameAr ?: nameArLegacy ?: nameEn ?: code
    val postable: Boolean get() = isPostable ?: isPostableLegacy ?: false
}

// ------------------------------------------------------------ المخزون والأرصدة

/** صفُّ رصيدٍ — `GET /inventory/levels` (مصفوفة stock_balances خام؛ الأسماء تُجلب محليًّا). */
@Serializable
data class StockLevelDto(
    val itemId: String = "",
    val warehouseId: String = "",
    val quantity: String = "0",
    val value: String = "0",
    val averageCost: String = "0",
    val updatedAt: String? = null,
)

/** صفُّ حركةٍ — `GET /inventory/movements` (مصفوفة خام). */
@Serializable
data class StockMovementDto(
    val id: String = "",
    val itemId: String = "",
    val sku: String? = null,
    val itemNameAr: String? = null,
    val warehouseId: String? = null,
    val warehouseNameAr: String? = null,
    /** in = وارد · out = صادر. */
    val direction: String = "in",
    val qty: String = "0",
    val baseQty: String = "0",
    val unitId: String? = null,
    val unitNameAr: String? = null,
    val unitCost: String? = null,
    val totalCost: String? = null,
    val docType: String? = null,
    val occurredAt: String? = null,
    /** في بطاقة الصنف فقط — الرصيدُ الجاري بعد الحركة. */
    val balanceQty: String? = null,
    val balanceValue: String? = null,
    val averageCost: String? = null,
)

/** بطاقةُ صنفٍ — `GET /inventory/item-card` (كائنٌ خام مع مجاميعٍ ورصيدٍ جارٍ). */
@Serializable
data class ItemCardDto(
    val itemId: String = "",
    val sku: String? = null,
    val nameAr: String? = null,
    val warehouseId: String? = null,
    val from: String? = null,
    val to: String? = null,
    val opening: ItemCardTotalsDto = ItemCardTotalsDto(),
    val totals: ItemCardFlowDto = ItemCardFlowDto(),
    val closing: ItemCardTotalsDto = ItemCardTotalsDto(),
    val rows: List<StockMovementDto> = emptyList(),
)

@Serializable
data class ItemCardTotalsDto(
    val quantity: String = "0",
    val value: String = "0",
)

@Serializable
data class ItemCardFlowDto(
    val inQty: String = "0",
    val inValue: String = "0",
    val outQty: String = "0",
    val outValue: String = "0",
)

/** سطرُ تسوية جرد. */
@Serializable
data class StockAdjustmentLineDto(
    val adjustmentId: String = "",
    val lineNo: Int = 0,
    val itemId: String = "",
    val expectedQty: String = "0",
    val countedQty: String = "0",
    val unitId: String? = null,
    val unitCost: String? = null,
    val varianceQty: String? = null,
    val varianceValue: String = "0",
    val note: String? = null,
)

/** صفُّ تسوية جرد — `GET /inventory/adjustments` (مصفوفةٌ خام مع السطور). */
@Serializable
data class StockAdjustmentDto(
    val id: String = "",
    val number: String = "",
    val branchId: String? = null,
    val warehouseId: String? = null,
    val reason: String = "",
    val status: String = "draft",
    val approvedAt: String? = null,
    val createdAt: String? = null,
    val lines: List<StockAdjustmentLineDto> = emptyList(),
)

// ------------------------------------------------------------ الأطراف وكشوفها

/** رصيدُ طرفٍ وقيودُه المفتوحة — `GET /parties/{id}/balance` (كائنٌ خام). */
@Serializable
data class PartyBalanceDto(
    val receivable: String = "0",
    val payable: String = "0",
    val open: List<PartyOpenRowDto> = emptyList(),
)

@Serializable
data class PartyOpenRowDto(
    val entryId: String = "",
    val accountId: String = "",
    val date: String? = null,
    val debit: String = "0",
    val credit: String = "0",
    val allocated: String = "0",
)

// ------------------------------------------------------------ المنظّمة والأدوار

/** صفُّ مندوب مبيعات — `GET /sales/salesmen` (سجلّ المندوبين الرسميّ). */
@Serializable
data class SalesRegistryDto(
    val id: String = "",
    val name: String = "",
    val active: Boolean = true,
    val employeeId: String? = null,
    val warehouseId: String? = null,
    val commissionRate: String? = null,
    val collectionCommissionRate: String? = null,
    val profitCommissionRate: String? = null,
    val tel: String? = null,
    val mobile: String? = null,
    val notes: String? = null,
)

/** صفُّ إذنٍ في السجلّ — `GET /permissions` (`{data}`): {code, module, description}. */
@Serializable
data class PermissionDto(
    val code: String = "",
    val module: String? = null,
    val description: String? = null,
)

// ------------------------------------------------------------ التقارير

/** مدخلُ فهرس التقارير — `GET /reports` (مصفوفةٌ خام). */
@Serializable
data class ReportCatalogEntryDto(
    val key: String = "",
    val titleAr: String = "",
    val group: String = "",
    val hintAr: String? = null,
)

/** نتيجةُ تشغيل تقرير — `GET /reports/{key}` (كائنٌ خام). */
@Serializable
data class ReportResultDto(
    val key: String = "",
    val titleAr: String = "",
    val group: String = "",
    val hintAr: String? = null,
    val columns: List<ReportColumnDto> = emptyList(),
    val rows: List<Map<String, String>> = emptyList(),
    val totals: Map<String, String> = emptyMap(),
    val grandTotal: List<ReportGrandTotalDto> = emptyList(),
    val rowCount: Int = 0,
    val generatedAt: String? = null,
)

@Serializable
data class ReportColumnDto(
    val key: String = "",
    val labelAr: String = "",
    /** text | money | qty | int | date | percent — كما في `ReportColumnType`. */
    val type: String? = null,
    val hidden: Boolean = false,
) {
    /** عمودٌ رقميٌّ؟ — للعرض بتنسيق المال/الكميّة. */
    val numeric: Boolean
        get() = type in setOf("money", "qty", "int", "percent")
}

@Serializable
data class ReportGrandTotalDto(
    val key: String = "",
    val labelAr: String = "",
    val amount: String = "0",
)
