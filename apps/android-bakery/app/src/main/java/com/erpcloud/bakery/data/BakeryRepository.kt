package com.erpcloud.bakery.data

import com.erpcloud.bakery.data.api.ApiEnvelope
import com.erpcloud.bakery.data.api.ApiException
import com.erpcloud.bakery.data.api.AppJson
import com.erpcloud.bakery.data.api.BakeryApi
import com.erpcloud.bakery.data.api.ChangePasswordRequest
import com.erpcloud.bakery.data.api.DashboardDto
import com.erpcloud.bakery.data.api.ItemOptionDto
import com.erpcloud.bakery.data.api.LinkAccountReceiptDto
import com.erpcloud.bakery.data.api.LoginRequest
import com.erpcloud.bakery.data.api.LoginResponse
import com.erpcloud.bakery.data.api.MeResponse
import com.erpcloud.bakery.data.api.NotificationListResponse
import com.erpcloud.bakery.data.api.PartyDto
import com.erpcloud.bakery.data.api.PrintViewDto
import com.erpcloud.bakery.data.api.ProblemDto
import com.erpcloud.bakery.data.api.ReportsPayloadDto
import com.erpcloud.bakery.data.api.SalesmanCardDto
import com.erpcloud.bakery.data.api.ShortagePolicyDto
import com.erpcloud.bakery.data.api.WarehouseOptionDto
import com.erpcloud.bakery.data.api.AccountDto
import com.erpcloud.bakery.data.api.AdjustmentDto
import com.erpcloud.bakery.data.api.AdjustmentTypeDto
import com.erpcloud.bakery.data.api.BomDto
import com.erpcloud.bakery.data.api.BranchDto
import com.erpcloud.bakery.data.api.CashLocationDto
import com.erpcloud.bakery.data.api.CatalogItemDto
import com.erpcloud.bakery.data.api.CategoryDto
import com.erpcloud.bakery.data.api.CatalogItemDto
import com.erpcloud.bakery.data.api.DepartmentDto
import com.erpcloud.bakery.data.api.EmployeeDto
import com.erpcloud.bakery.data.api.EmployeeStatementDto
import com.erpcloud.bakery.data.api.ItemCardDto
import com.erpcloud.bakery.data.api.ItemUnitDto
import com.erpcloud.bakery.data.api.JobDto
import com.erpcloud.bakery.data.api.MembershipDto
import com.erpcloud.bakery.data.api.PayrollRunDto
import com.erpcloud.bakery.data.api.PermissionDto
import com.erpcloud.bakery.data.api.PosCheckoutReceiptDto
import com.erpcloud.bakery.data.api.PosOfflineDataDto
import com.erpcloud.bakery.data.api.PartyBalanceDto
import com.erpcloud.bakery.data.api.PurchaseInvoiceDto
import com.erpcloud.bakery.data.api.ReportCatalogEntryDto
import com.erpcloud.bakery.data.api.ReportResultDto
import com.erpcloud.bakery.data.api.RoleDto
import com.erpcloud.bakery.data.api.SalaryPaymentDto
import com.erpcloud.bakery.data.api.SalesRegistryDto
import com.erpcloud.bakery.data.api.StockAdjustmentDto
import com.erpcloud.bakery.data.api.StockLevelDto
import com.erpcloud.bakery.data.api.StockMovementDto
import com.erpcloud.bakery.data.api.StockVoucherDto
import com.erpcloud.bakery.data.api.TreasuryVoucherDto
import com.erpcloud.bakery.data.api.UnitDto
import com.erpcloud.bakery.data.offline.Idempotency
import com.erpcloud.bakery.data.offline.SessionStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import retrofit2.Response

/**
 * نتيجةُ إجراءٍ إداريّ — تطبيقُ الإدارة **متصلٌ دائمًا**: الإجراءُ إمّا وصل
 * (Synced) أو رُفض برسالة الخادم (Refused) أو لم يصل للشبكة (Offline — ليست رفضًا؛
 * تُعاد المحاولة يدويًّا والقرارُ يبقى بيد المستخدم لا طابورَ يخفيه).
 */
sealed class ActionResult {
    data class Synced(val messageAr: String) : ActionResult()
    data class Refused(val messageAr: String) : ActionResult()
    data class Offline(val messageAr: String) : ActionResult()
}

/**
 * مستودعُ تطبيق إدارة المخابز — كلُّ نداءٍ يمرّ من هنا.
 *
 * القواعدُ الثلاث الحاكمة (كما في شاشة الويب نفسها):
 * 1. **لا اختراع**: ما لم يقله الخادم لا يُعرض، والحقلُ الغائب `null` لا صفر.
 * 2. رسائلُ الرفض (٤xx) تُقال حرفيًّا — تفاصيلُ الخادم العربية هي الواجهة.
 * 3. الإجراءاتُ التي يقبلها الخادم مع `idempotencyKey` (دفعة/تحميل/تحصيل) تحمل
 *    مفتاحًا واحدًا لكلّ نيّة: يُبنى مرّةً عند أوّل إرسال ويبقى في الشاشة حتى
 *    النجاح، فإعادةُ المحاولة بعد مهلةٍ لا تخلق مستندًا مكرّرًا.
 */
class BakeryRepository(
    private val api: BakeryApi,
    private val sessionStore: SessionStore,
) {

    // ------------------------------------------------------------ نداءات عامّة

    suspend fun login(server: String, email: String, password: String, tenantCode: String, mfaCode: String?): LoginResponse =
        withContext(Dispatchers.IO) {
            sessionStore.setServerUrl(server)
            val response = api.login(
                LoginRequest(email, password, tenantCode, mfaCode?.trim()?.takeIf { it.isNotEmpty() })
            )
            val data = unwrapEnvelope(response) ?: throw ApiException(
                ProblemDto(title = "Empty login response"), response.code(),
            )
            sessionStore.saveLogin(data, tenantCode)
            data
        }

    suspend fun logout() {
        withContext(Dispatchers.IO) {
            try {
                api.logout()
            } catch (_: Exception) {
                // الجلسةُ المحليّة تُحذف في كلّ حال.
            }
            sessionStore.clearSession()
        }
    }

    suspend fun me(): MeResponse = withContext(Dispatchers.IO) {
        val response = api.me()
        unwrapEnvelope(response) ?: throw ApiException(ProblemDto(title = "Empty /me response"), response.code())
    }

    /** تغييرُ كلمة المرور — نجاحُه 204 **ويُبطل الخادمُ كلَّ الجلسات**. */
    suspend fun changePassword(current: String, new: String): ActionResult =
        submitDirect("تغيير كلمة المرور") { api.changePassword(ChangePasswordRequest(current, new)) }

    // ------------------------------------------------------------- القراءات

    suspend fun dashboard(): DashboardDto = withContext(Dispatchers.IO) {
        val response = api.dashboard()
        unwrapEnvelope(response) ?: throw ApiException(ProblemDto(title = "Empty dashboard response"), response.code())
    }

    suspend fun salesmen(): List<SalesmanCardDto> = withContext(Dispatchers.IO) {
        val response = api.salesmen()
        unwrapEnvelope(response) ?: emptyList()
    }

    suspend fun policy(salesmanId: String? = null): ShortagePolicyDto = withContext(Dispatchers.IO) {
        val response = api.policy(salesmanId?.trim()?.takeIf { it.isNotEmpty() })
        unwrapEnvelope(response) ?: throw ApiException(ProblemDto(title = "Empty policy response"), response.code())
    }

    suspend fun reports(salesmanId: String?, fromDate: String?, toDate: String?): ReportsPayloadDto =
        withContext(Dispatchers.IO) {
            val response = api.reports(
                salesmanId = salesmanId?.trim()?.takeIf { it.isNotEmpty() },
                fromDate = fromDate?.trim()?.takeIf { it.isNotEmpty() },
                toDate = toDate?.trim()?.takeIf { it.isNotEmpty() },
            )
            unwrapEnvelope(response) ?: throw ApiException(ProblemDto(title = "Empty reports response"), response.code())
        }

    suspend fun warehouses(): List<WarehouseOptionDto> = withContext(Dispatchers.IO) {
        val response = api.warehouses()
        if (!response.isSuccessful) throw response.toApiException()
        response.body()?.data ?: emptyList()
    }

    suspend fun catalogItems(): List<ItemOptionDto> = withContext(Dispatchers.IO) {
        val response = api.catalogItems()
        if (!response.isSuccessful) throw response.toApiException()
        response.body() ?: emptyList()
    }

    /** أصنافُ الكتالوج كاملةً (شاشةُ الكتالوج) — نفس المسار برؤيةٍ أوسع. */
    suspend fun catalogItemsFull(): List<CatalogItemDto> = withContext(Dispatchers.IO) {
        val response = api.catalogItemsFull()
        if (!response.isSuccessful) throw response.toApiException()
        response.body() ?: emptyList()
    }

    suspend fun parties(kind: String = "customer"): List<PartyDto> = withContext(Dispatchers.IO) {
        val response = api.parties(kind = kind)
        if (!response.isSuccessful) throw response.toApiException()
        response.body() ?: emptyList()
    }

    /** إنشاءُ طرفٍ — مورّدٌ أو عميل (إذن parties.manage). */
    suspend fun createParty(body: JsonObject): ActionResult =
        submitDirect("حفظ الطرف") { api.createParty(body) }

    suspend fun printView(documentId: String): PrintViewDto = withContext(Dispatchers.IO) {
        val response = api.printView(documentId, copies = 2)
        unwrapEnvelope(response) ?: throw ApiException(ProblemDto(title = "Empty print-view response"), response.code())
    }

    // -------------------------------------------------------------- الإشعارات

    suspend fun notifications(unreadOnly: Boolean = false): NotificationListResponse =
        withContext(Dispatchers.IO) {
            val response = api.notifications(
                limit = 50,
                offset = 0,
                read = if (unreadOnly) "false" else null,
            )
            if (!response.isSuccessful) throw response.toApiException()
            response.body() ?: NotificationListResponse()
        }

    suspend fun markNotificationRead(id: String): ActionResult =
        submitDirect("تعليم الإشعار كمقروء") { api.markNotificationRead(id) }

    // -------------------------------------------------------------- الإجراءات

    /** دفعةُ إنتاجٍ — الجسمُ يحمل مفتاحَ النيّة (أُلحق عبر [ensureIdempotencyKey]). */
    suspend fun createProductionBatch(body: JsonObject): ActionResult =
        submitDirect("تسجيل دفعة الإنتاج") { api.createProductionBatch(body) }

    /** أمرُ تحميلٍ — كذلك بمفتاح النيّة في جسمه. */
    suspend fun createLoadOrder(body: JsonObject): ActionResult =
        submitDirect("إنشاء أمر التحميل") { api.createLoadOrder(body) }

    /** تحصيلُ ذمّة عميل — كذلك بمفتاح النيّة في جسمه. */
    suspend fun collectCustomerDebt(body: JsonObject): ActionResult =
        submitDirect("تسجيل التحصيل") { api.collectCustomerDebt(body) }

    /** تحديثُ سعر عميل — upsert بلا مفتاح: المسارُ يوحّد السجلّ لا يُنشئ مستندًا. */
    suspend fun upsertCustomerPrice(body: JsonObject): ActionResult =
        submitDirect("حفظ سعر العميل") { api.upsertCustomerPrice(body) }

    suspend fun confirmReceipt(loadOrderId: String, body: JsonObject): ActionResult =
        submitDirect("تأكيد استلام التوريد") { api.confirmReceipt(loadOrderId, body) }

    suspend fun rejectReceipt(loadOrderId: String, body: JsonObject): ActionResult =
        submitDirect("رفض استلام التوريد") { api.rejectReceipt(loadOrderId, body) }

    suspend fun cancelLoadOrder(loadOrderId: String, body: JsonObject): ActionResult =
        submitDirect("إلغاء أمر التحميل") { api.cancelLoadOrder(loadOrderId, body) }

    suspend fun closeTransitDifference(loadOrderId: String, body: JsonObject): ActionResult =
        submitDirect("قرار فرق العبور") { api.closeTransitDifference(loadOrderId, body) }

    suspend fun submitClosing(loadOrderId: String, body: JsonObject): ActionResult =
        submitDirect("إقفال الوردية") { api.submitClosing(loadOrderId, body) }

    suspend fun approveClosing(loadOrderId: String, body: JsonObject): ActionResult =
        submitDirect("اعتماد الإقفال") { api.approveClosing(loadOrderId, body) }

    suspend fun settleStock(loadOrderId: String, body: JsonObject): ActionResult =
        submitDirect("استكمال تسوية المخزون") { api.settleStock(loadOrderId, body) }

    /** كتابةُ سياسة العجز — إذنُ van_sales.override.approve (قرارٌ ماليّ). */
    suspend fun updatePolicy(body: JsonObject): ActionResult =
        submitDirect("حفظ سياسة العجز") { api.updatePolicy(body) }

    suspend fun linkSalesmanAccount(salesmanId: String, body: JsonObject): LinkAccountReceiptDto =
        withContext(Dispatchers.IO) {
            val response = api.linkSalesmanAccount(salesmanId, body)
            unwrapEnvelope(response) ?: throw ApiException(
                ProblemDto(title = "Empty link-account response"), response.code(),
            )
        }

    // ------------------------------------------------------------ أدوات داخلية

    /**
     * مفتاحُ النيّة — **النيّةُ الواحدةُ مفتاحٌ واحد** (نمطُ تطبيق المندوب نفسه):
     * يُبنى مرّةً عند أوّل إرسال (أو يُستعمل الموجود في الجسم/المُمرَّر من الشاشة)،
     * والشاشةُ تحفظه نصًّا (`rememberSaveable`) وتعيد إلحاقه عند كلّ محاولة، فلا
     * دفعةَ إنتاجٍ ولا أمرَ تحميلٍ ولا تحصيلًا مكرّرًا ولو انقطعت الشبكة بعد الإرسال.
     */
    fun ensureIdempotencyKey(prefix: String, body: JsonObject, existingKey: String?): JsonObject {
        val present = (body["idempotencyKey"] as? JsonPrimitive)?.content?.takeIf { it.isNotBlank() }
        val key = present ?: existingKey?.takeIf { it.isNotBlank() } ?: Idempotency.buildKey(prefix, body)
        return Idempotency.withKey(body, key)
    }

    /** إرسالُ إجراءٍ مباشر — التطبيقُ متصلٌ دائمًا: 2xx أو رفضُ الخادم أو لا شبكة. */
    suspend fun submitDirect(
        labelAr: String,
        call: suspend () -> Response<*>,
    ): ActionResult = withContext(Dispatchers.IO) {
        try {
            val response = call()
            if (response.isSuccessful) {
                ActionResult.Synced("تمّت العمليّة بنجاح — $labelAr.")
            } else {
                ActionResult.Refused(response.toApiException().userMessage)
            }
        } catch (error: java.io.IOException) {
            ActionResult.Offline(
                "لم تصل العمليّةُ إلى الخادم — تطبيقُ الإدارة يعمل متصلًا: " +
                    "تحقّق من الشبكة ثم أعد المحاولة."
            )
        } catch (error: Exception) {
            ActionResult.Refused(error.message ?: "تعذّر إكمال الطلب")
        }
    }

    private fun <T : Any> unwrapEnvelope(response: Response<ApiEnvelope<T>>): T? {
        if (!response.isSuccessful) throw response.toApiException()
        return response.body()?.data
    }

    private fun <T> Response<T>.toApiException(): ApiException {
        val raw = try {
            errorBody()?.string().orEmpty()
        } catch (_: Exception) {
            ""
        }
        val problem = if (raw.isNotEmpty()) {
            try {
                AppJson.decodeFromString(ProblemDto.serializer(), raw)
            } catch (_: Exception) {
                ProblemDto(title = message(), detail = raw.take(200))
            }
        } else {
            ProblemDto(title = message())
        }
        return ApiException(problem, code())
    }

    // ============================================================ وحدات «الطاقم»

    /** قائمةٌ خام تُفكّ تسلسلها من الاستجابة — الغلافُ إن وُجد يُتجاوز. */
    private suspend inline fun <reified T> rawList(crossinline call: () -> Response<List<T>>): List<T> =
        withContext(Dispatchers.IO) {
            val response = call()
            if (!response.isSuccessful) throw response.toApiException()
            response.body() ?: emptyList()
        }

    // ------------------------------------------------------------ الكتالوج

    suspend fun catalogCategories(): List<CategoryDto> = rawList { api.catalogCategories() }

    suspend fun catalogUnits(): List<UnitDto> = rawList { api.catalogUnits() }

    suspend fun createCategory(body: JsonObject): ActionResult =
        submitDirect("إنشاء المجموعة") { api.createCategory(body) }

    suspend fun createUnit(body: JsonObject): ActionResult =
        submitDirect("إنشاء وحدة القياس") { api.createUnit(body) }

    suspend fun createCatalogItem(body: JsonObject): ActionResult =
        submitDirect("إنشاء الصنف") { api.createCatalogItem(body) }

    suspend fun itemUnits(itemId: String): List<ItemUnitDto> = rawList { api.itemUnits(itemId) }

    suspend fun setItemUnit(itemId: String, body: JsonObject): ActionResult =
        submitDirect("إضافة وحدة إلى الصنف") { api.setItemUnit(itemId, body) }

    // ------------------------------------------------------- الفروع والخزائن

    suspend fun branches(): List<BranchDto> = withContext(Dispatchers.IO) {
        val response = api.branches()
        if (!response.isSuccessful) throw response.toApiException()
        response.body()?.data ?: emptyList()
    }

    suspend fun cashLocations(): List<CashLocationDto> = withContext(Dispatchers.IO) {
        val response = api.cashLocations()
        if (!response.isSuccessful) throw response.toApiException()
        response.body()?.data ?: emptyList()
    }

    // ------------------------------------------------------------- المشتريات

    suspend fun purchaseInvoices(): List<PurchaseInvoiceDto> = rawList { api.purchaseInvoices() }

    suspend fun createPurchaseInvoice(body: JsonObject): ActionResult =
        submitDirect("إنشاء فاتورة المشتريات") { api.createPurchaseInvoice(body) }

    suspend fun postPurchaseInvoice(id: String, body: JsonObject): ActionResult =
        submitDirect("ترحيل فاتورة المشتريات") { api.postPurchaseInvoice(id, body) }

    // --------------------------------------------------------- سندات المخزون

    suspend fun stockVouchers(kind: String? = null, status: String? = null): List<StockVoucherDto> = rawList {
        api.stockVouchers(kind, status)
    }

    suspend fun createStockVoucher(body: JsonObject): ActionResult =
        submitDirect("إنشاء السند المخزنيّ") { api.createStockVoucher(body) }

    suspend fun postStockVoucher(id: String, body: JsonObject): ActionResult =
        submitDirect("ترحيل السند المخزنيّ") { api.postStockVoucher(id, body) }

    // ------------------------------------------------------------ نقطة البيع

    /** قوائمُ الموادّ (BOM) — مصدرُ الإنتاج البديل عن الإدخال اليدويّ للمكوّنات. */
    suspend fun boms(): List<BomDto> = withContext(Dispatchers.IO) {
        val response = api.boms()
        unwrapEnvelope(response) ?: emptyList()
    }

    suspend fun posOfflineData(): PosOfflineDataDto = withContext(Dispatchers.IO) {
        val response = api.posOfflineData()
        unwrapEnvelope(response) ?: throw ApiException(ProblemDto(title = "Empty POS data"), response.code())
    }

    /** إتمامُ بيعة نقطة البيع — الإيصالُ كما أعاده الخادم (رقمُ الفاتورة لا يُخترع). */
    suspend fun posCheckout(body: JsonObject): PosCheckoutReceiptDto = withContext(Dispatchers.IO) {
        val response = api.posCheckout(body)
        unwrapEnvelope(response) ?: throw ApiException(ProblemDto(title = "Empty checkout response"), response.code())
    }

    // ------------------------------------------------------ الموارد البشريّة

    suspend fun departments(): List<DepartmentDto> = rawList { api.departments() }

    suspend fun jobs(): List<JobDto> = rawList { api.jobs() }

    suspend fun employees(): List<EmployeeDto> = rawList { api.employees() }

    suspend fun createEmployee(body: JsonObject): ActionResult =
        submitDirect("إنشاء الموظف") { api.createEmployee(body) }

    suspend fun adjustmentTypes(): List<AdjustmentTypeDto> = rawList { api.adjustmentTypes() }

    suspend fun adjustments(employeeId: String? = null, status: String? = null): List<AdjustmentDto> =
        withContext(Dispatchers.IO) {
            val response = api.adjustments(employeeId, status)
            unwrapEnvelope(response) ?: emptyList()
        }

    suspend fun createAdjustment(body: JsonObject): ActionResult =
        submitDirect("تسجيل المنصرف") { api.createAdjustment(body) }

    suspend fun approveAdjustment(id: String): ActionResult =
        submitDirect("اعتماد المنصرف") { api.approveAdjustment(id) }

    suspend fun payrollRuns(): List<PayrollRunDto> = withContext(Dispatchers.IO) {
        val response = api.payrollRuns()
        unwrapEnvelope(response) ?: emptyList()
    }

    suspend fun createPayrollRun(body: JsonObject): PayrollRunDto = withContext(Dispatchers.IO) {
        val response = api.createPayrollRun(body)
        unwrapEnvelope(response) ?: throw ApiException(ProblemDto(title = "Empty payroll run"), response.code())
    }

    suspend fun postPayrollRun(id: String, body: JsonObject): ActionResult =
        submitDirect("ترحيل مسيّر الرواتب") { api.postPayrollRun(id, body) }

    suspend fun payPayrollRun(id: String, body: JsonObject): ActionResult =
        submitDirect("دفع مسيّر الرواتب") { api.payPayrollRun(id, body) }

    suspend fun employeeStatement(
        employeeId: String,
        from: String?,
        to: String?,
        fullPeriod: Boolean = false,
    ): EmployeeStatementDto =
        withContext(Dispatchers.IO) {
            val response = api.employeeStatement(
                employeeId = employeeId,
                from = if (fullPeriod) null else from?.trim()?.takeIf { it.isNotEmpty() },
                to = if (fullPeriod) null else to?.trim()?.takeIf { it.isNotEmpty() },
                fullPeriod = if (fullPeriod) "true" else null,
            )
            if (!response.isSuccessful) throw response.toApiException()
            val element = response.body() ?: throw ApiException(
                ProblemDto(title = "Empty statement response"), response.code(),
            )
            // الردُّ `{data: {...}}` — يُفكّ يدويًّا لأن الخدمة تعيد كائنًا مركّبًا.
            val payload = (element as? JsonObject)?.get("data") ?: element
            AppJson.decodeFromJsonElement(EmployeeStatementDto.serializer(), payload)
        }

    suspend fun salaryPayments(employeeId: String? = null): List<SalaryPaymentDto> =
        withContext(Dispatchers.IO) {
            val response = api.salaryPayments(employeeId)
            unwrapEnvelope(response) ?: emptyList()
        }

    suspend fun createSalaryPayment(body: JsonObject): ActionResult =
        submitDirect("تسجيل إذن صرف الراتب") { api.createSalaryPayment(body) }

    // ------------------------------------------------------ الخزينة والمصروفات

    suspend fun treasuryVouchers(from: String? = null, to: String? = null): List<TreasuryVoucherDto> =
        rawList { api.treasuryVouchers(from, to) }

    suspend fun createTreasuryVoucher(body: JsonObject): ActionResult =
        submitDirect("إنشاء السند") { api.createTreasuryVoucher(body) }

    suspend fun postTreasuryVoucher(id: String, body: JsonObject): ActionResult =
        submitDirect("ترحيل السند") { api.postTreasuryVoucher(id, body) }

    /** دليلُ الحسابات — للحسابِ المقابلِ في السند (اختياريٌّ). */
    suspend fun accounts(): List<AccountDto> = withContext(Dispatchers.IO) {
        val response = api.accounts()
        unwrapEnvelope(response) ?: emptyList()
    }

    // ------------------------------------------------------ المخزون والأرصدة

    suspend fun stockLevels(warehouseId: String? = null): List<StockLevelDto> =
        rawList { api.stockLevels(warehouseId = warehouseId) }

    suspend fun stockMovements(
        itemId: String? = null,
        warehouseId: String? = null,
        from: String? = null,
        to: String? = null,
    ): List<StockMovementDto> = rawList { api.stockMovements(itemId, warehouseId, from, to) }

    suspend fun itemCard(
        itemId: String,
        warehouseId: String? = null,
        from: String? = null,
        to: String? = null,
    ): ItemCardDto = withContext(Dispatchers.IO) {
        val response = api.itemCard(itemId, warehouseId, from, to)
        if (!response.isSuccessful) throw response.toApiException()
        response.body() ?: throw ApiException(ProblemDto(title = "Empty item card"), response.code())
    }

    suspend fun stockAdjustments(status: String? = null): List<StockAdjustmentDto> =
        rawList { api.stockAdjustments(status) }

    suspend fun createStockAdjustment(body: JsonObject): ActionResult =
        submitDirect("إنشاء تسوية الجرد") { api.createStockAdjustment(body) }

    suspend fun postStockAdjustment(id: String, body: JsonObject): ActionResult =
        submitDirect("ترحيل تسوية الجرد") { api.postStockAdjustment(id, body) }

    // ------------------------------------------------------------ الأطراف

    suspend fun partyBalance(partyId: String): PartyBalanceDto = withContext(Dispatchers.IO) {
        val response = api.partyBalance(partyId)
        if (!response.isSuccessful) throw response.toApiException()
        response.body() ?: throw ApiException(ProblemDto(title = "Empty party balance"), response.code())
    }

    // ---------------------------------------------------- المنظّمة والأدوار

    suspend fun salesRegistry(): List<SalesRegistryDto> = rawList { api.salesRegistry() }

    suspend fun createSalesRegistry(body: JsonObject): ActionResult =
        submitDirect("إنشاء مندوب المبيعات") { api.createSalesRegistry(body) }

    suspend fun memberships(): List<MembershipDto> = withContext(Dispatchers.IO) {
        val response = api.memberships()
        if (!response.isSuccessful) throw response.toApiException()
        response.body()?.data ?: emptyList()
    }

    suspend fun assignableRoles(): List<RoleDto> = withContext(Dispatchers.IO) {
        val response = api.assignableRoles()
        unwrapEnvelope(response) ?: emptyList()
    }

    suspend fun inviteMembership(body: JsonObject): ActionResult =
        submitDirect("دعوة المستخدم") { api.inviteMembership(body) }

    suspend fun roles(): List<RoleDto> = withContext(Dispatchers.IO) {
        val response = api.roles()
        if (!response.isSuccessful) throw response.toApiException()
        response.body()?.data ?: emptyList()
    }

    suspend fun createRole(body: JsonObject): ActionResult =
        submitDirect("إنشاء الدور") { api.createRole(body) }

    suspend fun permissions(): List<PermissionDto> = withContext(Dispatchers.IO) {
        val response = api.permissions()
        unwrapEnvelope(response) ?: emptyList()
    }

    // -------------------------------------------------------------- التقارير

    suspend fun reportCatalog(): List<ReportCatalogEntryDto> = rawList { api.reportCatalog() }

    suspend fun runReport(key: String, params: JsonObject): ReportResultDto =
        withContext(Dispatchers.IO) {
            val query = params.entries
                .mapNotNull { (name, value) ->
                    (value as? kotlinx.serialization.json.JsonPrimitive)
                        ?.takeIf { it.content.isNotBlank() }
                        ?.let { name to it.content }
                }
                .toMap()
            val response = api.runReport(key, query)
            if (!response.isSuccessful) throw response.toApiException()
            response.body() ?: throw ApiException(ProblemDto(title = "Empty report response"), response.code())
        }
}
