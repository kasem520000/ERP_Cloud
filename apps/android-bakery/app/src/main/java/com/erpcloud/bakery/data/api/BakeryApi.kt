package com.erpcloud.bakery.data.api

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
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

    /** طلبُ استعادة كلمة المرور بالبريد — عامٌّ بلا جلسة (شاشة الدخول). */
    @POST("auth/forgot-password")
    suspend fun forgotPassword(@Body body: JsonObject): Response<JsonElement>

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

    /** مستودعاتُ المنشأة — يقبل غلافَ صفحةٍ `{ data: [...], meta }` أو مصفوفةً خام. */
    @GET("warehouses")
    suspend fun warehouses(): Response<JsonElement>

    /** أصنافُ الكتالوج — مصفوفةٌ خام (صفوف drizzle ⇒ camelCase) مع دعم البحث النصيّ. */
    @GET("organization/catalog/items")
    suspend fun catalogItems(@Query("q") q: String? = null): Response<JsonElement>

    /** أصنافُ الكتالوج كاملةً — لشاشةِ الكتالوج والفواتير (أعمدةُ الأسعار والتتبّع). */
    @GET("organization/catalog/items")
    suspend fun catalogItemsFull(@Query("q") q: String? = null): Response<JsonElement>

    /** العملاء — مصفوفةٌ خام بلا غلاف (كما في تطبيق المندوب). */
    @GET("parties")
    suspend fun parties(@Query("kind") kind: String = "customer"): Response<JsonElement>

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
    suspend fun catalogCategories(): Response<JsonElement>

    /** إنشاء مجموعة — إذن `catalog.category.manage`. */
    @POST("organization/catalog/categories")
    suspend fun createCategory(@Body body: JsonObject): Response<JsonElement>

    /** وحدات القياس — إذن `catalog.unit.view`. */
    @GET("organization/catalog/units")
    suspend fun catalogUnits(): Response<JsonElement>

    /** مجموعاتُ الضريبة — إذن `catalog.taxgroup.view` (نسبُ ضريبة القيمة المضافة للأصناف). */
    @GET("organization/catalog/tax-groups")
    suspend fun catalogTaxGroups(): Response<JsonElement>

    /** إنشاء وحدة — إذن `catalog.unit.manage`. */
    @POST("organization/catalog/units")
    suspend fun createUnit(@Body body: JsonObject): Response<JsonElement>

    /** إنشاء صنف — إذن `catalog.item.manage`. */
    @POST("organization/catalog/items")
    suspend fun createCatalogItem(@Body body: JsonObject): Response<JsonElement>

    /** تعديلُ صنف — إذن `catalog.item.manage` (المرحلة 2). */
    @PATCH("organization/catalog/items/{id}")
    suspend fun updateCatalogItem(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** تعديلُ مجموعة — إذن `catalog.category.manage`. */
    @PATCH("organization/catalog/categories/{id}")
    suspend fun updateCategory(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** تعديلُ وحدة قياس — إذن `catalog.unit.manage`. */
    @PATCH("organization/catalog/units/{id}")
    suspend fun updateUnit(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    // ------------------------------------------------------------ الفروع والخزائن

    /** الفروع — إذن `organization.branch.view` (غلافُ صفحةٍ). */
    @GET("branches")
    suspend fun branches(): Response<BranchPageDto>

    /** الخزائن والصناديق والحسابات البنكية — إذن `organization.cashlocation.view` (غلافُ صفحةٍ). */
    @GET("cash-locations")
    suspend fun cashLocations(@Query("limit") limit: Int = 200): Response<CashLocationPageDto>

    /** قراءةُ خزينة/حساب بنكي بكامل بيانات البنك والآيبان — إذن `organization.cashlocation.view`. */
    @GET("cash-locations/{id}")
    suspend fun cashLocationDetail(@Path("id") id: String): Response<JsonElement>

    /** أرصدةُ الصندوق/البنك حسب العملة — إذن `organization.cashlocation.view`. */
    @GET("cash-locations/{id}/balances")
    suspend fun cashLocationBalances(@Path("id") id: String): Response<JsonElement>

    /** كشفُ حركة الصندوق/البنك والرصيد المتحرّك من دفتر الأستاذ — إذن `treasury.view`. */
    @GET("cash-locations/{id}/movements")
    suspend fun cashLocationMovements(
        @Path("id") id: String,
        @Query("all") all: String? = null,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
    ): Response<JsonElement>

    /** مطابقةُ الرصيد الفرعي للصندوق/البنك مع دفتر الأستاذ — إذن `treasury.transfer.manage`. */
    @POST("cash-locations/{id}/recalc-balance")
    suspend fun recalcCashLocationBalance(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    /** المناقلاتُ النقديّة بين الصناديق والبنوك — إذن `treasury.view`. */
    @GET("cash-transfers")
    suspend fun cashTransfers(
        @Query("status") status: String? = null,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
    ): Response<JsonElement>

    /** إنشاءُ مناقلةٍ نقديّة (مسودّة) — إذن `treasury.transfer.manage`. */
    @POST("cash-transfers")
    suspend fun createCashTransfer(@Body body: JsonObject): Response<JsonElement>

    /** اعتمادُ إرسال المناقلة من الصندوق المصدر — إذن `treasury.transfer.manage`. */
    @POST("cash-transfers/{id}/send")
    suspend fun sendCashTransfer(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** تأكيدُ استلام المناقلة في الصندوق المستلم — إذن `treasury.transfer.manage`. */
    @POST("cash-transfers/{id}/receive")
    suspend fun receiveCashTransfer(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** إلغاءُ مناقلة — إذن `treasury.transfer.manage`. */
    @POST("cash-transfers/{id}/cancel")
    suspend fun cancelCashTransfer(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    // ------------------------------------------------------------- المشتريات

    /** فواتيرُ المشتريات — إذن `purchase.view` (مصفوفةٌ خام). */
    @GET("purchase-invoices")
    suspend fun purchaseInvoices(): Response<JsonElement>

    /** إنشاءُ فاتورة مشتريات (مسودة) — إذن `purchase.invoice.create`. */
    @POST("purchase-invoices")
    suspend fun createPurchaseInvoice(@Body body: JsonObject): Response<JsonElement>

    /** ترحيلُ الفاتورة — إذن `purchase.invoice.post`. */
    @POST("purchase-invoices/{id}/post")
    suspend fun postPurchaseInvoice(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    /** تفاصيلُ الفاتورة بسطورها ودفعاتها — للبطاقة التفصيليّة (المرحلة 2). */
    @GET("purchase-invoices/{id}")
    suspend fun purchaseInvoice(@Path("id") id: String): Response<JsonElement>

    /** تعديلُ مسودّة الفاتورة قبل الترحيل — إذن `purchase.invoice.create`. */
    @PATCH("purchase-invoices/{id}")
    suspend fun updatePurchaseInvoice(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** إبطالُ فاتورة — إذن `purchase.invoice.void` (يسببُ سببًا). */
    @POST("purchase-invoices/{id}/void")
    suspend fun voidPurchaseInvoice(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    // --------------------------------------------------------- سندات المخزون

    /** السنداتُ المخزنيّة (أول المدة/إدخال/إخراج) — إذن `inventory.view`. */
    @GET("inventory/vouchers")
    suspend fun stockVouchers(
        @Query("kind") kind: String? = null,
        @Query("status") status: String? = null,
    ): Response<JsonElement>

    /** إنشاءُ سندٍ — إذن `inventory.adjust`. */
    @POST("inventory/vouchers")
    suspend fun createStockVoucher(@Body body: JsonObject): Response<JsonElement>

    /** ترحيلُ السند — إذن `inventory.adjust`. */
    @POST("inventory/vouchers/{id}/post")
    suspend fun postStockVoucher(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** إبطالُ سندٍ مخزنيّ — إذن `inventory.adjust` (يسببُ سببًا). */
    @POST("inventory/vouchers/{id}/void")
    suspend fun voidStockVoucher(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

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

    /**
     * فتحُ ورديةِ الكاشير لفرعٍ — `POST /shift-closes/open`
     * (إذنُ `treasury.shift.close`). يُعرضُ الزرُّ في حوار الدفع عند
     * POS_SHIFT_REQUIRED فلا يعلقُ الكاشيرُ بلا مخرج.
     */
    @POST("shift-closes/open")
    suspend fun openShift(@Body body: JsonObject): Response<JsonElement>

    // ------------------------------------------------------ الموارد البشريّة

    /** الأقسام — إذن `hrm.view`. */
    @GET("hrm/departments")
    suspend fun departments(): Response<JsonElement>

    /** الوظائف — إذن `hrm.view`. */
    @GET("hrm/jobs")
    suspend fun jobs(): Response<JsonElement>

    /** الموظفون — إذن `hrm.view` (بطاقات drizzle خام). */
    @GET("hrm/employees")
    suspend fun employees(
        @Query("q") q: String? = null,
        @Query("status") status: String? = null,
    ): Response<JsonElement>

    /** إنشاءُ موظف — إذن `hrm.manage`. */
    @POST("hrm/employees")
    suspend fun createEmployee(@Body body: JsonObject): Response<JsonElement>

    /** تعديلُ موظف — إذن `hrm.manage` (المرحلة 2). */
    @PATCH("hrm/employees/{id}")
    suspend fun updateEmployee(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** أنواعُ المنصرفات — إذن `hrm.view`. */
    @GET("hrm/adjustment-types")
    suspend fun adjustmentTypes(): Response<JsonElement>

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

    // ------------------------------------------------------ الخزينة والمصروفات

    /** سنداتُ القبض والصرف — إذن `treasury.view` (مصفوفةٌ خام، آخر 500). */
    @GET("vouchers")
    suspend fun treasuryVouchers(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
    ): Response<JsonElement>

    /** إنشاءُ سند قبض/صرف (مسودّة) — إذن `treasury.voucher.create`. */
    @POST("vouchers")
    suspend fun createTreasuryVoucher(@Body body: JsonObject): Response<JsonElement>

    /** ترحيلُ السند — إذن `treasury.voucher.post`. */
    @POST("vouchers/{id}/post")
    suspend fun postTreasuryVoucher(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    /** تفاصيلُ السند — `GET /vouchers/{id}` (البطاقة التفصيليّة، المرحلة 2). */
    @GET("vouchers/{id}")
    suspend fun treasuryVoucher(@Path("id") id: String): Response<JsonElement>

    /** تعديلُ مسودّة السند قبل الترحيل — إذن `treasury.voucher.create`. */
    @PATCH("vouchers/{id}")
    suspend fun updateTreasuryVoucher(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** إبطالُ السند — إذن `treasury.voucher.void` (يسببُ سببًا). */
    @POST("vouchers/{id}/void")
    suspend fun voidTreasuryVoucher(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** دليلُ الحسابات — إذن `accounting.account.view` (`{data}`؛ للحساب المقابل اختياريًّا). */
    @GET("accounts")
    suspend fun accounts(): Response<ApiEnvelope<List<AccountDto>>>

    // ------------------------------------------------------ المخزون والأرصدة

    /** أرصدةُ المخزون — إذن `inventory.view` (مصفوفة stock_balances خام). */
    @GET("inventory/levels")
    suspend fun stockLevels(
        @Query("warehouse_id") warehouseId: String? = null,
        @Query("item_id") itemId: String? = null,
    ): Response<JsonElement>

    /** حركةُ المخزون — إذن `inventory.view` (مصفوفةٌ خام). */
    @GET("inventory/movements")
    suspend fun stockMovements(
        @Query("item_id") itemId: String? = null,
        @Query("warehouse_id") warehouseId: String? = null,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
    ): Response<JsonElement>

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
    suspend fun stockAdjustments(@Query("status") status: String? = null): Response<JsonElement>

    /** إنشاءُ تسوية جرد (مسودّة) — إذن `inventory.adjust`. */
    @POST("inventory/adjustments")
    suspend fun createStockAdjustment(@Body body: JsonObject): Response<JsonElement>

    /** ترحيلُ التسوية — إذن `inventory.adjust` (الفرقُ يُقيَّد على حساب الفرق). */
    @POST("inventory/adjustments/{id}/post")
    suspend fun postStockAdjustment(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    // ------------------------------------------------------ فواتير المبيعات

    /** فواتيرُ المبيعات — إذن `sales.view` (مصفوفةٌ خام أو `{data}`). */
    @GET("sales/invoices")
    suspend fun salesInvoices(): Response<JsonElement>

    /** إنشاءُ فاتورة مبيعات (مسودّة) — إذن `sales.invoice.create`. */
    @POST("sales/invoices")
    suspend fun createSalesInvoice(@Body body: JsonObject): Response<JsonElement>

    /** ترحيلُ الفاتورة — إذن `sales.invoice.post` (`settlement: credit` آجل أو نقديّ بحساب). */
    @POST("sales/invoices/{id}/post")
    suspend fun postSalesInvoice(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** مردودُ مبيعات من فاتورةٍ مرحّلة — إذن `sales.return.create`. */
    @POST("sales/invoices/{id}/return")
    suspend fun returnSalesInvoice(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** تفاصيلُ فاتورة المبيعات بسطورها ودفعاتها — للبطاقة التفصيليّة (المرحلة 2). */
    @GET("sales/invoices/{id}")
    suspend fun salesInvoice(@Path("id") id: String): Response<JsonElement>

    /** تعديلُ مسودّة فاتورة المبيعات — إذن `sales.invoice.create`. */
    @PATCH("sales/invoices/{id}")
    suspend fun updateSalesInvoice(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** إبطالُ فاتورة مبيعات — إذن `sales.invoice.void` (يسببُ سببًا). */
    @POST("sales/invoices/{id}/void")
    suspend fun voidSalesInvoice(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    // ---------------------------------------------------- الفروع والمستودعات

    /** إنشاءُ فرع — إذن `organization.branch.manage` (zod صارم: بلا مفاتيح زائدة). */
    @POST("branches")
    suspend fun createBranch(@Body body: JsonObject): Response<JsonElement>

    /** تعديلُ فرع — إذن `organization.branch.manage`. */
    @PATCH("branches/{id}")
    suspend fun updateBranch(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** إنشاءُ مستودع — إذن `organization.warehouse.manage`. */
    @POST("warehouses")
    suspend fun createWarehouse(@Body body: JsonObject): Response<JsonElement>

    /** تعديلُ مستودع — إذن `organization.warehouse.manage` (المرحلة 2). */
    @PATCH("warehouses/{id}")
    suspend fun updateWarehouse(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** إنشاءُ خزينة/صندوق — إذن `organization.cashlocation.manage`. */
    @POST("cash-locations")
    suspend fun createCashLocation(@Body body: JsonObject): Response<JsonElement>

    /** تعديلُ خزينة — إذن `organization.cashlocation.manage` (المرحلة 2). */
    @PATCH("cash-locations/{id}")
    suspend fun updateCashLocation(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** حذفُ خزينة غير افتراضيّة — إذن `organization.cashlocation.manage`. */
    @retrofit2.http.DELETE("cash-locations/{id}")
    suspend fun deleteCashLocation(@Path("id") id: String): Response<Unit>

    // ------------------------------------------------------------ الأطراف

    /** رصيدُ طرفٍ وقيودُه المفتوحة — إذن `parties.view` (كائنٌ خام). */
    @GET("parties/{id}/balance")
    suspend fun partyBalance(@Path("id") id: String): Response<PartyBalanceDto>

    /** تعديلُ طرفٍ — إذن `parties.manage` (PUT كما في المتحكّم، المرحلة 2). */
    @PUT("parties/{id}")
    suspend fun updateParty(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    // ---------------------------------------------------- المنظّمة والأدوار

    /** سجلُّ مناديب المبيعات — إذن `sales.view` (مصفوفةٌ خام). */
    @GET("sales/salesmen")
    suspend fun salesRegistry(): Response<JsonElement>

    /** إنشاءُ مندوب مبيعات — إذن `sales.salesman.manage`. */
    @POST("sales/salesmen")
    suspend fun createSalesRegistry(@Body body: JsonObject): Response<JsonElement>

    /** تعديلُ مندوب (العمولات/الجوال/المستودع) — إذن `sales.salesman.manage`. */
    @PATCH("sales/salesmen/{id}")
    suspend fun updateSalesRegistry(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

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

    /** استبدالُ أذونات دورٍ قائم — إذن `tenant.role.manage`. */
    @POST("roles/{id}/permissions")
    suspend fun updateRolePermissions(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** تعديلُ عضويّة (الحالة/الأدوار/النطاق) — إذن `tenant.membership.manage`. */
    @PATCH("memberships/{id}")
    suspend fun updateMembership(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    /** سجلُّ الأذونات — عامٌّ للهويّة (`{data}`). */
    @GET("permissions")
    suspend fun permissions(): Response<ApiEnvelope<List<PermissionDto>>>

    // -------------------------------------------------------------- التقارير

    /** فهرسُ التقارير — إذن `reporting.view` (مصفوفةٌ خام). */
    @GET("reports")
    suspend fun reportCatalog(): Response<JsonElement>

    /** تشغيلُ تقريرٍ بمدخلاته — إذن `reporting.view` (كائنٌ خام). */
    @GET("reports/{key}")
    suspend fun runReport(
        @Path("key") key: String,
        @QueryMap params: Map<String, String>,
    ): Response<ReportResultDto>

    // ------------------------------------------------- طباعة الخادم الاحترافية

    /** غلافُ صفحاتِ الطباعةِ عند الخادم — `{ html }` (HTML كاملٌ بقالبِ الويبِ الرسميّ). */

    /**
     * صفحةُ طباعةِ فاتورةِ مبيعاتٍ A4 جاهزةٌ (ترويسةٌ + سطورٌ + QR الزكاة) —
     * `GET /reports/print/invoices/{id}?paper=small` يُخرجُها إيصالَ كاشيرٍ 80mm.
     * إذن `reporting.view`، والردُّ `{ html }`.
     */
    @GET("reports/print/invoices/{id}")
    suspend fun salesInvoicePrintHtml(
        @Path("id") id: String,
        @Query("paper") paper: String? = null,
    ): Response<PrintHtmlDto>

    /** صفحةُ طباعةِ فاتورةِ مشتريات A4 — `GET /reports/print/purchase-invoices/{id}`. */
    @GET("reports/print/purchase-invoices/{id}")
    suspend fun purchaseInvoicePrintHtml(@Path("id") id: String): Response<PrintHtmlDto>

    /** صفحةُ طباعةِ سندِ خزينة A4 (قبض/صرف) — `GET /reports/print/vouchers/{id}`. */
    @GET("reports/print/vouchers/{id}")
    suspend fun treasuryVoucherPrintHtml(@Path("id") id: String): Response<PrintHtmlDto>

    /** صفحةُ طباعةِ إقفالِ ورديةٍ A4 (تقرير Z) — `GET /reports/print/shifts/{id}`. */
    @GET("reports/print/shifts/{id}")
    suspend fun shiftPrintHtml(@Path("id") id: String): Response<PrintHtmlDto>

    /**
     * صفحةُ طباعةِ تقريرٍ A4 بنفسِ مدخلاتِ تشغيله — `GET /reports/print/{key}`:
     * الأعمدةُ والرأسُ والتذييلُ والتوقيعُ بأسلوبِ الويبِ الرسميّ.
     */
    @GET("reports/print/{key}")
    suspend fun reportPrintHtml(
        @Path("key") key: String,
        @QueryMap params: Map<String, String>,
    ): Response<PrintHtmlDto>

    /** ملفُ المنشأة — `GET /company-profile` (`{data}`): الاسمُ والرقمُ الضريبيّ لوسوم QR. */
    @GET("company-profile")
    suspend fun companyProfile(): Response<ApiEnvelope<CompanyProfileDto>>

    // --------------------------------------------------- الهوية العامة والدعم الفني

    /** هويةُ النظام من الخادم (بلا جلسة) — `GET /public/site`. */
    @GET("public/site")
    suspend fun publicSite(): Response<ApiEnvelope<PublicSiteDto>>

    /** مقالاتُ مركز المساعدة — `GET /public/help`. */
    @GET("public/help")
    suspend fun publicHelp(@Query("q") q: String? = null): Response<JsonElement>

    /** الأسئلةُ الشائعة — `GET /public/faq`. */
    @GET("public/faq")
    suspend fun publicFaq(): Response<JsonElement>

    /** تذاكرُ الدعم الفنيّ للمنشأة — `GET /support/tickets`. */
    @GET("support/tickets")
    suspend fun supportTickets(): Response<JsonElement>

    /** تفاصيلُ تذكرة دعمٍ مع محادثاتها — `GET /support/tickets/{id}`. */
    @GET("support/tickets/{id}")
    suspend fun supportTicketDetail(@Path("id") id: String): Response<ApiEnvelope<SupportTicketDto>>

    /** رفعُ طلب مساعدةٍ جديد — `POST /support/tickets`. */
    @POST("support/tickets")
    suspend fun createSupportTicket(@Body body: JsonObject): Response<ApiEnvelope<SupportTicketDto>>

    /** الردُّ على تذكرة دعم — `POST /support/tickets/{id}/reply`. */
    @POST("support/tickets/{id}/reply")
    suspend fun replySupportTicket(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<ApiEnvelope<SupportTicketDto>>

    // ------------------------------------------ الفواتير الضريبية المرفوعة (ZATCA)

    /** سجلُّ الفواتير المرفوعة على بوابة الضرائب — إذن `einvoice.view`. */
    @GET("einvoice/filings")
    suspend fun einvoiceFilings(
        @Query("status") status: String? = null,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("pageNo") pageNo: Int = 1,
        @Query("pageSize") pageSize: Int = 50,
    ): Response<ApiEnvelope<EinvoiceFilingPageDto>>

    /** تفاصيلُ فاتورةٍ مرفوعةٍ واحدةٍ مع وسم QR والسلسلة — إذن `einvoice.view`. */
    @GET("einvoice/filings/{id}")
    suspend fun einvoiceFilingDetail(@Path("id") id: String): Response<ApiEnvelope<EinvoiceFilingDetailDto>>

    /** حالةُ سلسلة التشفير الضريبيّة — إذن `einvoice.view`. */
    @GET("einvoice/chain")
    suspend fun einvoiceChain(): Response<ApiEnvelope<EinvoiceChainStateDto>>

    /** مزامنةُ الفواتير المرحّلة ورفعُها للضرائب — إذن `einvoice.submit`. */
    @POST("einvoice/sync")
    suspend fun syncEinvoices(@Body body: JsonObject): Response<ApiEnvelope<EinvoiceSyncReportDto>>

    /** إعادةُ إرسال فاتورةٍ مرفوضة/متعثّرة — إذن `einvoice.submit`. */
    @POST("einvoice/submissions/{id}/retry")
    suspend fun retryEinvoice(@Path("id") id: String, @Body body: JsonObject): Response<JsonElement>

    // ------------------------------------------------ المساعد الذكي (AI) وإعداداته

    /** إعداداتُ المساعد الذكيّ للمنشأة — إذن `ai.assistant.use`. */
    @GET("ai/settings")
    suspend fun aiSettings(): Response<ApiEnvelope<AiSettingsDto>>

    /** حفظُ إعدادات المساعد الذكيّ ومفتاح API — إذن `ai.settings.manage`. */
    @PUT("ai/settings")
    suspend fun updateAiSettings(@Body body: JsonObject): Response<JsonElement>

    /** فحصُ اتّصال مزوّد الذكاء الاصطناعيّ — إذن `ai.settings.manage`. */
    @POST("ai/settings/test")
    suspend fun testAiSettings(@Body body: JsonObject): Response<ApiEnvelope<AiTestResultDto>>

    /** التنبيهاتُ والاقتراحاتُ الذكيّة — إذن `ai.assistant.use`. */
    @GET("ai/suggestions")
    suspend fun aiSuggestions(): Response<JsonElement>

    /** توليدُ تنبيهات اليوم الذكيّة — إذن `ai.assistant.use`. */
    @POST("ai/suggest")
    suspend fun generateAiSuggestions(@Body body: JsonObject): Response<JsonElement>

    /** سجلُّ المحادثات السابقة — إذن `ai.assistant.use`. */
    @GET("ai/conversations")
    suspend fun aiConversations(): Response<JsonElement>

    /** قراءةُ محادثةٍ سابقة — إذن `ai.assistant.use`. */
    @GET("ai/conversations/{id}")
    suspend fun aiConversation(@Path("id") id: String): Response<ApiEnvelope<AiStoredConversationDto>>

    /** إرسالُ سؤالٍ إلى المساعد الذكيّ (JSON مباشر مع `stream: false`) — إذن `ai.assistant.use`. */
    @POST("ai/chat")
    suspend fun aiChat(@Body body: JsonObject): Response<ApiEnvelope<AiChatResultDto>>
}
