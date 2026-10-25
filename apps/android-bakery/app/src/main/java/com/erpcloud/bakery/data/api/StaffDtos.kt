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
    val taxGroupId: String? = null,
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
) {
    fun toItemOption(): ItemOptionDto = ItemOptionDto(
        id = id,
        sku = sku.takeIf { it.isNotBlank() },
        barcode = barcode,
        nameAr = nameAr.takeIf { it.isNotBlank() },
        nameEn = nameEn,
        kind = kind,
        salePrice = salePrice,
        purchasePrice = purchasePrice,
        trackLot = trackLot,
        trackSerial = trackSerial,
        taxGroupId = taxGroupId,
        active = active,
        deletedAt = deletedAt,
    )
}

/** مجموعةُ ضريبةٍ — `GET /organization/catalog/tax-groups`. */
typealias TaxGroupDto = PosTaxGroupDto

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

/** بياناتُ البنك داخل الصندوق البنكي — `CashLocationDto.bank`. */
@Serializable
data class CashBankDetailsDto(
    val bankName: String? = null,
    val iban: String? = null,
    val swift: String? = null,
    val accountNo: String? = null,
    val country: String? = null,
    val city: String? = null,
    val region: String? = null,
    val phone: String? = null,
    val mobile: String? = null,
    val deductionPct: String? = null,
)

/** صفُّ خزينة / صندوق / حساب بنكي — `GET /cash-locations`. */
@Serializable
data class CashLocationDto(
    val id: String = "",
    val name: String = "",
    val kind: String = "safe",
    val branchId: String? = null,
    val accountId: String? = null,
    val currencyCode: String? = null,
    val bank: CashBankDetailsDto? = null,
    val notes: String? = null,
    val custodianIds: List<String> = emptyList(),
    val version: Int? = null,
    val isActive: Boolean = true,
    val isDefault: Boolean = false,
    val changeInPos: Boolean = false,
) {
    /** اسمٌ مقروءٌ بالعربية — يترجمُ الاسم الافتراضيّ المبدئيّ عند التجهيز إن بقي بالإنجليزية. */
    val displayName: String
        get() = when (name.trim().lowercase()) {
            "main safe" -> "الصندوق الرئيسي"
            "main bank", "main bank account" -> "الحساب البنكي الرئيسي"
            else -> name.ifBlank { if (kind == "bank") "حساب بنكي" else "صندوق نقدي" }
        }
}

/** رصيدُ موضع نقديّ بعملةٍ محدّدة — `GET /cash-locations/{id}/balances`. */
@Serializable
data class CashLocationBalanceDto(
    val cashLocationId: String = "",
    val currencyCode: String = "SAR",
    val balance: String = "0",
    val updatedAt: String? = null,
)

/** سطرٌ من كشف حركة الصندوق — `GET /cash-locations/{id}/movements`. */
@Serializable
data class CashMovementRowDto(
    val seq: Int = 0,
    val processType: String = "",
    val number: String = "",
    val date: String = "",
    val income: String = "0",
    val outcome: String = "0",
    val balance: String = "0",
    val note: String = "",
    val isOpening: Boolean = false,
)

/** كشفُ حركة الصندوق من دفتر الأستاذ — `GET /cash-locations/{id}/movements`. */
@Serializable
data class CashMovementStatementDto(
    val cashLocationId: String = "",
    val cashLocation: String = "",
    val currencyCode: String = "SAR",
    val accountId: String? = null,
    val from: String? = null,
    val to: String? = null,
    val fromTime: String? = null,
    val toTime: String? = null,
    val all: Boolean = true,
    val openingBalance: String = "0",
    val totalAll: String = "0",
    val totalPeriod: String = "0",
    val rows: List<CashMovementRowDto> = emptyList(),
)

/** مناقلةٌ نقديّةٌ بين الصناديق والبنوك — `GET /cash-transfers`. */
@Serializable
data class CashTransferDto(
    val id: String = "",
    val branchId: String? = null,
    val fromCashLocationId: String = "",
    val toCashLocationId: String = "",
    val fromName: String? = null,
    val toName: String? = null,
    val number: String? = null,
    val amount: String = "0",
    val currency: String = "SAR",
    val status: String = "draft",
    val sentJournalEntryId: String? = null,
    val receivedJournalEntryId: String? = null,
    val sentAt: String? = null,
    val receivedAt: String? = null,
    val createdAt: String? = null,
)

// ------------------------------------------------------------ المشتريات

/** صفُّ فاتورة مبيعات — `GET /sales/invoices` (مصفوفة drizzle خام؛ الحقول كلها متسامحة). */
@Serializable
data class SalesInvoiceDto(
    val id: String = "",
    val number: String = "",
    val invoiceDate: String? = null,
    val dueDate: String? = null,
    val partyId: String? = null,
    val partyName: String? = null,
    val cashCustomerName: String? = null,
    val salesmanId: String? = null,
    val branchId: String? = null,
    val warehouseId: String? = null,
    val kind: String = "sale",
    val status: String = "draft",
    val orderType: String? = null,
    val subtotal: String? = null,
    val discountTotal: String? = null,
    val taxTotal: String? = null,
    val total: String? = null,
    val paidTotal: String? = null,
    val paymentStatus: String? = null,
    val referenceInvoiceId: String? = null,
    val createdAt: String? = null,
    val notes: String? = null,
)

/** صفُّ فاتورة مشتريات — `GET /purchase-invoices` (مصفوفة drizzle خام). */
@Serializable
data class PurchaseInvoiceDto(
    val id: String = "",
    val number: String = "",
    val invoiceDate: String? = null,
    val dueDate: String? = null,
    val partyId: String? = null,
    val partyName: String? = null,
    val branchId: String? = null,
    val warehouseId: String? = null,
    val kind: String = "purchase",
    val status: String = "draft",
    val referenceInvoiceId: String? = null,
    val supplierReferenceNo: String? = null,
    val currency: String? = null,
    val subtotal: String? = null,
    val discountTotal: String? = null,
    val taxTotal: String? = null,
    val total: String? = null,
    val paidTotal: String? = null,
    val paymentStatus: String? = null,
    val createdAt: String? = null,
    val notes: String? = null,
)

/** سطرُ فاتورةٍ (مبيعات أو مشتريات) — من عرض التفاصيل `GET .../{id}`. */
@Serializable
data class InvoiceLineDto(
    val id: String = "",
    val lineNo: Int = 0,
    val itemId: String = "",
    val description: String? = null,
    val quantity: String = "0",
    val unitPrice: String? = null,
    val discountRate: String? = null,
    val discountAmount: String? = null,
    val taxRate: String? = null,
    val taxGroupId: String? = null,
    val net: String? = null,
    val tax: String? = null,
    val total: String? = null,
    val batchNo: String? = null,
    val expiryDate: String? = null,
)

/** دفعةٌ على فاتورة — من عرض التفاصيل (المسار نفسه يردُ التخصيصات). */
@Serializable
data class InvoicePaymentDto(
    val id: String = "",
    val method: String? = null,
    val amount: String? = null,
    val reference: String? = null,
    val createdAt: String? = null,
)

/** كلفةُ رأسٍ على فاتورة مشتريات (شحن/تأمين…) — من عرض التفاصيل. */
@Serializable
data class PurchaseCostDto(
    val id: String = "",
    val costName: String? = null,
    val amount: String? = null,
)

/** تفاصيلُ فاتورة مشتريات بسطورها ودفعاتها — `GET /purchase-invoices/{id}` (كائنٌ خام). */
@Serializable
data class PurchaseInvoiceDetailDto(
    val id: String = "",
    val number: String = "",
    val invoiceDate: String? = null,
    val dueDate: String? = null,
    val partyId: String? = null,
    val partyName: String? = null,
    val branchId: String? = null,
    val warehouseId: String? = null,
    val kind: String = "purchase",
    val status: String = "draft",
    val referenceInvoiceId: String? = null,
    val priceIncludesVat: Boolean? = null,
    val supplierReferenceNo: String? = null,
    val supplierReferenceDate: String? = null,
    val currency: String? = null,
    val subtotal: String? = null,
    val discountTotal: String? = null,
    val taxTotal: String? = null,
    val total: String? = null,
    val paidTotal: String? = null,
    val paymentStatus: String? = null,
    val notes: String? = null,
    val createdAt: String? = null,
    val lines: List<InvoiceLineDto> = emptyList(),
    val payments: List<InvoicePaymentDto> = emptyList(),
    val costs: List<PurchaseCostDto> = emptyList(),
)

/** تفاصيلُ فاتورة مبيعات بسطورها ودفعاتها — `GET /sales/invoices/{id}` (كائنٌ خام). */
@Serializable
data class SalesInvoiceDetailDto(
    val id: String = "",
    val number: String = "",
    val invoiceDate: String? = null,
    val dueDate: String? = null,
    val partyId: String? = null,
    val partyName: String? = null,
    val partyTaxNo: String? = null,
    val cashCustomerName: String? = null,
    val salesmanId: String? = null,
    val branchId: String? = null,
    val warehouseId: String? = null,
    val kind: String = "sale",
    val status: String = "draft",
    val orderType: String? = null,
    val priceIncludesVat: Boolean? = null,
    val subtotal: String? = null,
    val discountTotal: String? = null,
    val taxTotal: String? = null,
    val total: String? = null,
    val paidTotal: String? = null,
    val paymentStatus: String? = null,
    val referenceInvoiceId: String? = null,
    val taxInvoiceTypeLabelAr: String? = null,
    /** حمولةُ QR الزكاة كما أصدرتها وحدةُ الفوترةِ الإلكترونيّة (`zatca_qr`) — أو null. */
    val qrCode: String? = null,
    val zatcaQr: String? = null,
    val notes: String? = null,
    val createdAt: String? = null,
    val lines: List<InvoiceLineDto> = emptyList(),
    val payments: List<InvoicePaymentDto> = emptyList(),
) {
    val effectiveQr: String? get() = qrCode?.takeIf { it.isNotBlank() } ?: zatcaQr?.takeIf { it.isNotBlank() }
}

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
) {
    fun toItemOption(): ItemOptionDto = ItemOptionDto(
        id = id,
        sku = sku.takeIf { it.isNotBlank() },
        barcode = barcode,
        nameAr = nameAr.takeIf { it.isNotBlank() },
        nameEn = nameEn,
        kind = kind,
        salePrice = salePrice,
        trackLot = trackLot,
        trackSerial = trackSerial,
        taxGroupId = taxGroupId,
    )
}

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

/**
 * مجموعةُ ضريبةٍ من `pos/offline-data` (`taxes`) — نسبةُ الضريبةِ ونمطُها
 * الافتراضيّ (`isInclusiveDefault`) يحدّدانِ كيف يُقرأُ سعرُ البيع: شاملًا أم
 * قبلَ الضريبة، فيعرضُ الكاشيرُ الإجماليّ الحقيقيّ قبل إتمامِ البيعة.
 */
@Serializable
data class PosTaxGroupDto(
    val id: String = "",
    val code: String? = null,
    val nameAr: String? = null,
    val nameEn: String? = null,
    val rate: String = "0",
    val isDefault: Boolean = false,
    val isInclusiveDefault: Boolean = false,
)

/** حزمةُ بيانات نقطة البيع دون اتصال — `GET /pos/offline-data` (`{data}`). */
@Serializable
data class PosOfflineDataDto(
    val schemaVersion: Int = 1,
    val generatedAt: String? = null,
    val items: List<PosItemDto> = emptyList(),
    val categories: List<PosCategoryDto> = emptyList(),
    val customers: List<PosCustomerDto> = emptyList(),
    val taxes: List<PosTaxGroupDto> = emptyList(),
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
    val id: String? = null,
    val number: String = "",
    val subtotal: String? = null,
    val taxTotal: String? = null,
    val total: String? = null,
    val tendered: String? = null,
    val paidTotal: String? = null,
    val paymentStatus: String? = null,
    val method: String? = null,
    val change: String? = null,
    val shiftId: String? = null,
) {
    val resolvedId: String get() = invoiceId.ifBlank { id.orEmpty() }
}

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
    val sourceType: String? = null,
    val sourceId: String? = null,
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

// ------------------------------------------------------------ ملف المنشأة

/**
 * ملفُ المنشأة — `GET /company-profile` (`{data}`): اسمُ البائعِ ورقمُهُ الضريبيّ
 * هما وسما QR الزكاة (١ و٢)، ويُستعملان في إيصالِ الكاشيرِ المحلّيِّ والمشاركة.
 */
@Serializable
data class CompanyProfileDto(
    val id: String = "",
    val nameAr: String = "",
    val nameEn: String? = null,
    /** رقمُ التسجيلِ الضريبيّ (٩–١٥ رقمًا) — أو null إن لم يُسجَّل بعد. */
    val taxNo: String? = null,
    val crNo: String? = null,
    val email: String? = null,
    val phones: List<String> = emptyList(),
)

// ------------------------------------------------------------ الهوية العامة والدعم الفني

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

@Serializable
data class PublicHelpPostDto(
    val slug: String = "",
    val titleAr: String = "",
    val summaryAr: String? = null,
    val category: String? = null,
    val publishedAt: String = "",
)

@Serializable
data class PublicFaqDto(
    val slug: String = "",
    val question: String = "",
    val answer: String = "",
)

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

@Serializable
data class SupportMessageDto(
    val id: String = "",
    val authorLabel: String? = null,
    val authorKind: String = "customer",
    val body: String = "",
    val createdAt: String = "",
)

// ------------------------------------------------------------ الفواتير الضريبية المرفوعة (ZATCA)

@Serializable
data class EinvoiceInvoiceRefDto(
    val number: String? = null,
    val kind: String? = null,
    val total: String? = null,
    val issuedAt: String? = null,
    val partyName: String? = null,
    val branchName: String? = null,
    val createdByName: String? = null,
)

@Serializable
data class EinvoiceResponseMetaDto(
    val submitted: Boolean? = null,
    val reason: String? = null,
    val message: String? = null,
    val clearance: Boolean? = null,
    val profile: String? = null,
    val gateway: String? = null,
    val errorMessages: List<String> = emptyList(),
    val warningMessages: List<String> = emptyList(),
)

@Serializable
data class EinvoiceFilingRowDto(
    val id: String = "",
    val invoice: EinvoiceInvoiceRefDto? = null,
    val invoiceId: String = "",
    val authority: String = "zatca",
    val environment: String = "",
    val status: String = "",
    val authorityStatus: String? = null,
    val uuid: String? = null,
    val hash: String? = null,
    val previousHash: String? = null,
    val chainIndex: Int? = null,
    val attempts: kotlinx.serialization.json.JsonPrimitive? = null,
    val error: String? = null,
    val submittedAt: String? = null,
    val createdAt: String = "",
    val response: kotlinx.serialization.json.JsonObject? = null,
) {
    val attemptsText: String get() = attempts?.content?.ifBlank { "1" } ?: "1"
}

@Serializable
data class EinvoiceFilingPageDto(
    val items: List<EinvoiceFilingRowDto> = emptyList(),
    val total: Int = 0,
    val pageNo: Int = 1,
    val pageSize: Int = 50,
    val pages: Int = 1,
)

@Serializable
data class EinvoiceQrTagDto(
    val tag: Int = 0,
    val labelAr: String = "",
    val value: String = "",
    val bytes: Int = 0,
)

@Serializable
data class EinvoiceQrDto(
    val payload: String? = null,
    val tags: List<EinvoiceQrTagDto> = emptyList(),
)

@Serializable
data class EinvoiceInvoiceDetailDto(
    val id: String = "",
    val number: String? = null,
    val kind: String = "",
    val total: String = "0",
    val taxTotal: String = "0",
    val currency: String = "SAR",
    val issuedAt: String? = null,
)

@Serializable
data class EinvoiceChainPairDto(
    val previousHash: String? = null,
    val hash: String? = null,
)

@Serializable
data class EinvoiceAuthorityDto(
    val status: String? = null,
    val errors: List<String> = emptyList(),
    val warnings: List<String> = emptyList(),
    val error: String? = null,
)

@Serializable
data class EinvoiceFilingDetailDto(
    val submission: EinvoiceFilingRowDto = EinvoiceFilingRowDto(),
    val invoice: EinvoiceInvoiceDetailDto? = null,
    val chain: EinvoiceChainPairDto? = null,
    val qr: EinvoiceQrDto? = null,
    val authority: EinvoiceAuthorityDto? = null,
)

@Serializable
data class EinvoiceChainStateDto(
    val authority: String = "zatca",
    val environment: String = "",
    val counter: Int = 0,
    val lastHash: String = "",
    val nextCounter: Int = 1,
    val updatedAt: String? = null,
)

@Serializable
data class EinvoiceSyncReportDto(
    val requested: Int = 0,
    val sent: Int = 0,
    val failed: Int = 0,
    val skipped: Int = 0,
    val message: String = "",
)

// ------------------------------------------------------------ المساعد الذكي (AI) وإعداداته

@Serializable
data class AiUsageDto(
    val tokens: Long = 0L,
    val spent: String = "0",
    val tokenLimit: Long? = null,
    val costLimit: String? = null,
    val period: String = "",
)

@Serializable
data class AiSettingsDto(
    val enabled: Boolean = true,
    val platformSuspended: Boolean = false,
    val platformEnabled: Boolean = true,
    val provider: String? = null,
    val effectiveProvider: String = "local",
    val model: String? = null,
    val effectiveModel: String = "local-grounded",
    val baseUrl: String? = null,
    val effectiveBaseUrl: String? = null,
    val monthlyTokenLimit: Long? = null,
    val monthlyCostLimit: String? = null,
    val hasPlatformKey: Boolean = false,
    val hasTenantApiKey: Boolean = false,
    val apiKeyMasked: String? = null,
    val usage: AiUsageDto = AiUsageDto(),
)

@Serializable
data class AiTestResultDto(
    val ok: Boolean = false,
    val provider: String = "",
    val model: String = "",
    val latencyMs: Long = 0L,
    val reply: String = "",
)

@Serializable
data class AiSuggestionDto(
    val kind: String? = null,
    val title: String = "",
    val body: String = "",
)

@Serializable
data class AiConversationRowDto(
    val id: String = "",
    val title: String = "",
    val updated_at: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class AiStoredMessageDto(
    val role: String = "assistant",
    val content: String = "",
    val at: String? = null,
)

@Serializable
data class AiStoredConversationDto(
    val id: String = "",
    val messages: List<AiStoredMessageDto> = emptyList(),
)

@Serializable
data class AiChatUsageDto(
    val tokensIn: Int = 0,
    val tokensOut: Int = 0,
    val spent: String = "0",
)

@Serializable
data class AiChatResultDto(
    val conversationId: String = "",
    val intent: String = "",
    val text: String = "",
    val hrefs: List<String> = emptyList(),
    val tools: List<String> = emptyList(),
    val provider: String = "",
    val degraded: Boolean = false,
    val usage: AiChatUsageDto = AiChatUsageDto(),
)

