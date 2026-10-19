package com.erpcloud.bakery.data.api

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.QueryMap

/**
 * واجهةُ الخادم لتطبيق إدارة المخابز — كلُّ مسارٍ هنا موقّعٌ على المتحكّم الرسميّ
 * (apps/api/src/modules/van-sales/van-sales.controller.ts) وما حوله:
 * المصادقةُ (platform/auth)، البحثُ (المنظّمة/المخزون/الأطراف)، والإشعاراتُ
 * (platform-services/notifications). **لا مسارَ هنا بلا موقّعٍ في الخادم.**
 *
 * الغلافُ: أغلبُ الردود `{ data: ... }` (ApiEnvelope)؛ والاستثناءان الحرفيّان:
 * ‏`/parties` مصفوفةٌ خام، و`/notifications` بلا غلاف بمعامِلاتها الخاصّة.
 * والاستجاباتُ الرقميّةُ نصوصٌ دائمًا (numeric من PostgreSQL) — انظر Dec.
 */
interface BakeryApi {

    // ---------------------------------------------------------- المصادقة

    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): Response<ApiEnvelope<LoginResponse>>

    @POST("auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): Response<ApiEnvelope<LoginResponse>>

    @POST("auth/logout")
    suspend fun logout(): Response<Unit>

    @POST("auth/change-password")
    suspend fun changePassword(@Body body: ChangePasswordRequest): Response<Unit>

    @GET("me")
    suspend fun me(): Response<ApiEnvelope<MeResponse>>

    // ------------------------------------------------------- لوحة القيادة

    /** كلُّ شيءٍ في شاشةٍ واحدة: الدفعاتُ والأحمالُ والمستنداتُ والحركاتُ والمجاميع. */
    @GET("van-sales/dashboard")
    suspend fun dashboard(): Response<ApiEnvelope<DashboardDto>>

    // --------------------------------------------------------- المناديب

    @GET("van-sales/salesmen")
    suspend fun salesmen(): Response<ApiEnvelope<List<SalesmanCardDto>>>

    /** ربطُ المندوب بحساب دخول — إذن `sales.salesman.manage`. */
    @POST("van-sales/salesmen/{id}/account")
    suspend fun linkSalesmanAccount(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<ApiEnvelope<LinkAccountReceiptDto>>

    // ------------------------------------------------------------ الإنتاج

    /** دفعةُ إنتاجٍ جديدة — إذن `van_sales.production.manage`. */
    @POST("van-sales/production-batches")
    suspend fun createProductionBatch(@Body body: JsonObject): Response<JsonElement>

    // ------------------------------------------------------ التوزيع/التحميل

    @POST("van-sales/load-orders")
    suspend fun createLoadOrder(@Body body: JsonObject): Response<JsonElement>

    /** تأكيدُ استلام التوريد — للمندوب صاحب العهدة أو لمن يحمل إدارة التحميل. */
    @POST("van-sales/load-orders/{id}/confirm-receipt")
    suspend fun confirmReceipt(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    /** رفضُ الاستلام — تُعاد الكميّةُ رسميًّا إلى المصدر بمناقلة إرجاع. */
    @POST("van-sales/load-orders/{id}/reject-receipt")
    suspend fun rejectReceipt(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    /** إلغاءُ أمرٍ قبل الاستلام — إلغاءُ المناقلة الرسميّة نفسها. */
    @POST("van-sales/load-orders/{id}/cancel")
    suspend fun cancelLoadOrder(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    /** قرارُ فرق العبور: `return` (إرجاع للمصدر) أو `shortage` (عجز تحويل). */
    @POST("van-sales/load-orders/{id}/close-transit-difference")
    suspend fun closeTransitDifference(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    // --------------------------------------------------------- العهدة/الإقفال

    /** إقفالٌ من المندوب/المشرف — إذن `van_sales.closing.submit`. */
    @POST("van-sales/load-orders/{id}/submit-closing")
    suspend fun submitClosing(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    /** اعتمادُ المحاسب للإقفال — إذن `van_sales.closing.approve`. */
    @POST("van-sales/load-orders/{id}/approve-closing")
    suspend fun approveClosing(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    /** استكمالُ تسوية مخزون ورديةٍ معلّقة — تكرارُها لا يحرّك كيلوغرامًا مرّتين. */
    @POST("van-sales/load-orders/{id}/settle-stock")
    suspend fun settleStock(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    // ----------------------------------------------------------- التسعير

    @POST("van-sales/customer-prices")
    suspend fun upsertCustomerPrice(@Body body: JsonObject): Response<JsonElement>

    // ------------------------------------------------------------ التحصيل

    @POST("van-sales/collections")
    suspend fun collectCustomerDebt(@Body body: JsonObject): Response<JsonElement>

    // ------------------------------------------------------- السياسة والتقارير

    @GET("van-sales/policy")
    suspend fun policy(@Query("salesmanId") salesmanId: String? = null): Response<ApiEnvelope<ShortagePolicyDto>>

    @PUT("van-sales/policy")
    suspend fun updatePolicy(@Body body: JsonObject): Response<JsonElement>

    @GET("van-sales/reports")
    suspend fun reports(
        @Query("salesmanId") salesmanId: String? = null,
        @Query("fromDate") fromDate: String? = null,
        @Query("toDate") toDate: String? = null,
    ): Response<ApiEnvelope<ReportsPayloadDto>>

    // ----------------------------------------------------------- المستندات

    @GET("van-sales/documents/{id}/print-view")
    suspend fun printView(
        @Path("id") id: String,
        @Query("copies") copies: Int = 2,
    ): Response<ApiEnvelope<PrintViewDto>>

    // ------------------------------------------------------------- البحث

    /** مستودعاتُ المنشأة — غلافُ صفحةٍ `{ data: [...], meta }`. */
    @GET("warehouses")
    suspend fun warehouses(): Response<WarehousesPageDto>

    /** أصنافُ الكتالوج — مصفوفةٌ خام (صفوف drizzle ⇒ camelCase). */
    @GET("organization/catalog/items")
    suspend fun catalogItems(): Response<List<ItemOptionDto>>

    /** العملاء — مصفوفةٌ خام بلا غلاف (كما في تطبيق المندوب). */
    @GET("parties")
    suspend fun parties(@Query("kind") kind: String = "customer"): Response<List<PartyDto>>

    /** إنشاءُ طرفٍ (مورّد/عميل) — إذن `parties.manage`. */
    @POST("parties")
    suspend fun createParty(@Body body: JsonObject): Response<JsonElement>

    // ----------------------------------------------------------- الإشعارات

    @GET("notifications")
    suspend fun notifications(
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
        @Query("filter[read]") read: String? = null,
    ): Response<NotificationListResponse>

    @POST("notifications/{id}/read")
    suspend fun markNotificationRead(@Path("id") id: String): Response<JsonElement>

    // ============================================================ وحدات «الطاقم»

    // ------------------------------------------------------------ الكتالوج

    /** المجموعات — إذن `catalog.category.view` (مصفوفةٌ خام). */
    @GET("organization/catalog/categories")
    suspend fun catalogCategories(): Response<List<CategoryDto>>

    /** إنشاء مجموعة — إذن `catalog.category.manage`. */
    @POST("organization/catalog/categories")
    suspend fun createCategory(@Body body: JsonObject): Response<JsonElement>

    /** وحدات القياس — إذن `catalog.unit.view`. */
    @GET("organization/catalog/units")
    suspend fun catalogUnits(): Response<List<UnitDto>>

    /** إنشاء وحدة — إذن `catalog.unit.manage`. */
    @POST("organization/catalog/units")
    suspend fun createUnit(@Body body: JsonObject): Response<JsonElement>

    /** إنشاء صنف — إذن `catalog.item.manage`. */
    @POST("organization/catalog/items")
    suspend fun createCatalogItem(@Body body: JsonObject): Response<JsonElement>

    /** وحداتُ صنفٍ — إذن `catalog.item.view`. */
    @GET("organization/catalog/items/{id}/units")
    suspend fun itemUnits(@Path("id") itemId: String): Response<List<ItemUnitDto>>

    /** إضافةُ وحدةٍ إلى صنف — إذن `catalog.item.manage`. */
    @POST("organization/catalog/items/{id}/units")
    suspend fun setItemUnit(
        @Path("id") itemId: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    // ------------------------------------------------------------ الفروع والخزائن

    /** الفروع — إذن `organization.branch.view` (غلافُ صفحةٍ). */
    @GET("branches")
    suspend fun branches(): Response<BranchPageDto>

    /** الخزائن — إذنُ قراءة الخزائن (غلافُ صفحةٍ). */
    @GET("cash-locations")
    suspend fun cashLocations(): Response<CashLocationPageDto>

    // ------------------------------------------------------------- المشتريات

    /** فواتيرُ المشتريات — إذن `purchase.view` (مصفوفةٌ خام). */
    @GET("purchase-invoices")
    suspend fun purchaseInvoices(): Response<List<PurchaseInvoiceDto>>

    /** إنشاءُ فاتورة مشتريات (مسودة) — إذن `purchase.invoice.create`. */
    @POST("purchase-invoices")
    suspend fun createPurchaseInvoice(@Body body: JsonObject): Response<JsonElement>

    /** ترحيلُ الفاتورة — إذن `purchase.invoice.post`. */
    @POST("purchase-invoices/{id}/post")
    suspend fun postPurchaseInvoice(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    // --------------------------------------------------------- سندات المخزون

    /** السنداتُ المخزنيّة (أول المدة/إدخال/إخراج) — إذن `inventory.view`. */
    @GET("inventory/vouchers")
    suspend fun stockVouchers(
        @Query("kind") kind: String? = null,
        @Query("status") status: String? = null,
    ): Response<List<StockVoucherDto>>

    /** إنشاءُ سندٍ — إذن `inventory.adjust`. */
    @POST("inventory/vouchers")
    suspend fun createStockVoucher(@Body body: JsonObject): Response<JsonElement>

    /** ترحيلُ السند — إذن `inventory.adjust`. */
    @POST("inventory/vouchers/{id}/post")
    suspend fun postStockVoucher(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    // ------------------------------------------------------------ نقطة البيع

    /** قوائمُ الموادّ — إذن `manufacturing.view` (`{data}`). */
    @GET("manufacturing/boms")
    suspend fun boms(): Response<ApiEnvelope<List<BomDto>>>

    /** حزمةُ بيانات نقطة البيع — إذن `pos.view` (`{data}`). */
    @GET("pos/offline-data")
    suspend fun posOfflineData(): Response<ApiEnvelope<PosOfflineDataDto>>

    /** إتمامُ بيعة — إذنَا `pos.operate` + `sales.invoice.post` (`{data}`). */
    @POST("pos/checkout")
    suspend fun posCheckout(@Body body: JsonObject): Response<ApiEnvelope<PosCheckoutReceiptDto>>

    // ------------------------------------------------------ الموارد البشريّة

    /** الأقسام — إذن `hrm.view`. */
    @GET("hrm/departments")
    suspend fun departments(): Response<List<DepartmentDto>>

    /** الوظائف — إذن `hrm.view`. */
    @GET("hrm/jobs")
    suspend fun jobs(): Response<List<JobDto>>

    /** الموظفون — إذن `hrm.view` (بطاقات drizzle خام). */
    @GET("hrm/employees")
    suspend fun employees(
        @Query("q") q: String? = null,
        @Query("status") status: String? = null,
    ): Response<List<EmployeeDto>>

    /** إنشاءُ موظف — إذن `hrm.manage`. */
    @POST("hrm/employees")
    suspend fun createEmployee(@Body body: JsonObject): Response<JsonElement>

    /** أنواعُ المنصرفات — إذن `hrm.view`. */
    @GET("hrm/adjustment-types")
    suspend fun adjustmentTypes(): Response<List<AdjustmentTypeDto>>

    /** المنصرفاتُ والاستقطاعات — إذن `hrm.view` (`{data}`). */
    @GET("hrm/adjustments")
    suspend fun adjustments(
        @Query("employee_id") employeeId: String? = null,
        @Query("status") status: String? = null,
    ): Response<ApiEnvelope<List<AdjustmentDto>>>

    /** تسجيلُ منصرف/استقطاع — إذن `hrm.manage`. */
    @POST("hrm/adjustments")
    suspend fun createAdjustment(@Body body: JsonObject): Response<JsonElement>

    /** اعتمادُ المنصرف — إذن `hrm.adjust.approve`. */
    @POST("hrm/adjustments/{id}/approve")
    suspend fun approveAdjustment(@Path("id") id: String): Response<JsonElement>

    /** مسيّراتُ الرواتب — إذن `hrm.view` (`{data}`). */
    @GET("hrm/payroll/runs")
    suspend fun payrollRuns(): Response<ApiEnvelope<List<PayrollRunDto>>>

    /** إنشاءُ مسيّر رواتب لشهر — إذن `hrm.manage` (`{data}`). */
    @POST("hrm/payroll/runs")
    suspend fun createPayrollRun(@Body body: JsonObject): Response<ApiEnvelope<PayrollRunDto>>

    /** ترحيلُ المسيّر — إذن `hrm.payroll.post`. */
    @POST("hrm/payroll/runs/{id}/post")
    suspend fun postPayrollRun(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    /** دفعُ المسيّر — إذن `hrm.payroll.post`. */
    @POST("hrm/payroll/runs/{id}/pay")
    suspend fun payPayrollRun(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    /** كشفُ حساب موظف — إذن `hrm.view` (معامِلاتٌ snake_case كما في المتحكّم). */
    @GET("hrm/employee-statement")
    suspend fun employeeStatement(
        @Query("employee_id") employeeId: String,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("full_period") fullPeriod: String? = null,
    ): Response<JsonElement>

    /** أذونُ صرف الرواتب — إذن `hrm.view` (`{data}`). */
    @GET("hrm/salary-payments")
    suspend fun salaryPayments(
        @Query("employee_id") employeeId: String? = null,
    ): Response<ApiEnvelope<List<SalaryPaymentDto>>>

    /** إذنُ صرف راتب — إذن `hrm.payroll.post`. */
    @POST("hrm/salary-payments")
    suspend fun createSalaryPayment(@Body body: JsonObject): Response<JsonElement>

    // ------------------------------------------------------ الخزينة والمصروفات

    /** سنداتُ القبض والصرف — إذن `treasury.view` (مصفوفةٌ خام، آخر 500). */
    @GET("vouchers")
    suspend fun treasuryVouchers(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
    ): Response<List<TreasuryVoucherDto>>

    /** إنشاءُ سند قبض/صرف (مسودّة) — إذن `treasury.voucher.create`. */
    @POST("vouchers")
    suspend fun createTreasuryVoucher(@Body body: JsonObject): Response<JsonElement>

    /** ترحيلُ السند — إذن `treasury.voucher.post`. */
    @POST("vouchers/{id}/post")
    suspend fun postTreasuryVoucher(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    /** دليلُ الحسابات — إذن `accounting.account.view` (`{data}`؛ للحساب المقابل اختياريًّا). */
    @GET("accounts")
    suspend fun accounts(): Response<ApiEnvelope<List<AccountDto>>>

    // ------------------------------------------------------ المخزون والأرصدة

    /** أرصدةُ المخزون — إذن `inventory.view` (مصفوفة stock_balances خام). */
    @GET("inventory/levels")
    suspend fun stockLevels(
        @Query("warehouse_id") warehouseId: String? = null,
        @Query("item_id") itemId: String? = null,
    ): Response<List<StockLevelDto>>

    /** حركةُ المخزون — إذن `inventory.view` (مصفوفةٌ خام). */
    @GET("inventory/movements")
    suspend fun stockMovements(
        @Query("item_id") itemId: String? = null,
        @Query("warehouse_id") warehouseId: String? = null,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
    ): Response<List<StockMovementDto>>

    /** بطاقةُ صنفٍ — إذن `inventory.view` (كائنٌ خام بمجاميعٍ ورصيدٍ جارٍ). */
    @GET("inventory/item-card")
    suspend fun itemCard(
        @Query("item_id") itemId: String,
        @Query("warehouse_id") warehouseId: String? = null,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
    ): Response<ItemCardDto>

    /** تسوياتُ الجرد — إذن `inventory.view` (مصفوفةٌ خام مع السطور). */
    @GET("inventory/adjustments")
    suspend fun stockAdjustments(@Query("status") status: String? = null): Response<List<StockAdjustmentDto>>

    /** إنشاءُ تسوية جرد (مسودّة) — إذن `inventory.adjust`. */
    @POST("inventory/adjustments")
    suspend fun createStockAdjustment(@Body body: JsonObject): Response<JsonElement>

    /** ترحيلُ التسوية — إذن `inventory.adjust` (الفرقُ يُقيَّد على حساب الفرق). */
    @POST("inventory/adjustments/{id}/post")
    suspend fun postStockAdjustment(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    // ------------------------------------------------------------ الأطراف

    /** رصيدُ طرفٍ وقيودُه المفتوحة — إذن `parties.view` (كائنٌ خام). */
    @GET("parties/{id}/balance")
    suspend fun partyBalance(@Path("id") id: String): Response<PartyBalanceDto>

    // ---------------------------------------------------- المنظّمة والأدوار

    /** سجلُّ مناديب المبيعات — إذن `sales.view` (مصفوفةٌ خام). */
    @GET("sales/salesmen")
    suspend fun salesRegistry(): Response<List<SalesRegistryDto>>

    /** إنشاءُ مندوب مبيعات — إذن `sales.salesman.manage`. */
    @POST("sales/salesmen")
    suspend fun createSalesRegistry(@Body body: JsonObject): Response<JsonElement>

    /** العضويّات — إذن `tenant.membership.manage` (غلافُ صفحةٍ). */
    @GET("memberships")
    suspend fun memberships(): Response<MembershipPageDto>

    /** الأدوارُ القابلة للإسناد — إذن `tenant.membership.manage` (`{data}`). */
    @GET("memberships/assignable-roles")
    suspend fun assignableRoles(): Response<ApiEnvelope<List<RoleDto>>>

    /** دعوةُ مستخدمٍ إلى المنشأة — إذن `tenant.membership.manage`. */
    @POST("memberships")
    suspend fun inviteMembership(@Body body: JsonObject): Response<JsonElement>

    /** الأدوار — إذن `tenant.role.manage` (غلافُ صفحةٍ). */
    @GET("roles")
    suspend fun roles(): Response<RolePageDto>

    /** إنشاءُ دور — إذن `tenant.role.manage`. */
    @POST("roles")
    suspend fun createRole(@Body body: JsonObject): Response<JsonElement>

    /** سجلُّ الأذونات — عامٌّ للهويّة (`{data}`). */
    @GET("permissions")
    suspend fun permissions(): Response<ApiEnvelope<List<PermissionDto>>>

    // -------------------------------------------------------------- التقارير

    /** فهرسُ التقارير — إذن `reporting.view` (مصفوفةٌ خام). */
    @GET("reports")
    suspend fun reportCatalog(): Response<List<ReportCatalogEntryDto>>

    /** تشغيلُ تقريرٍ بمدخلاته — إذن `reporting.view` (كائنٌ خام). */
    @GET("reports/{key}")
    suspend fun runReport(
        @Path("key") key: String,
        @QueryMap params: Map<String, String>,
    ): Response<ReportResultDto>
}
