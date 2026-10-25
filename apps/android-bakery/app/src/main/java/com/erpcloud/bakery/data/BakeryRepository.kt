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
import com.erpcloud.bakery.data.api.CategoryDto
import com.erpcloud.bakery.data.api.CatalogItemDto
import com.erpcloud.bakery.data.api.DepartmentDto
import com.erpcloud.bakery.data.api.EmployeeDto
import com.erpcloud.bakery.data.api.EmployeeStatementDto
import com.erpcloud.bakery.data.api.ItemCardDto
import com.erpcloud.bakery.data.api.JobDto
import com.erpcloud.bakery.data.api.MembershipDto
import com.erpcloud.bakery.data.api.PayrollRunDto
import com.erpcloud.bakery.data.api.PermissionDto
import com.erpcloud.bakery.data.api.PosCheckoutReceiptDto
import com.erpcloud.bakery.data.api.PosOfflineDataDto
import com.erpcloud.bakery.data.api.PartyBalanceDto
import com.erpcloud.bakery.data.api.PurchaseInvoiceDto
import com.erpcloud.bakery.data.api.PurchaseInvoiceDetailDto
import com.erpcloud.bakery.data.api.ReportCatalogEntryDto
import com.erpcloud.bakery.data.api.ReportResultDto
import com.erpcloud.bakery.data.api.RoleDto
import com.erpcloud.bakery.data.api.SalaryPaymentDto
import com.erpcloud.bakery.data.api.SalesInvoiceDto
import com.erpcloud.bakery.data.api.SalesInvoiceDetailDto
import com.erpcloud.bakery.data.api.SalesRegistryDto
import com.erpcloud.bakery.data.api.StockAdjustmentDto
import com.erpcloud.bakery.data.api.StockLevelDto
import com.erpcloud.bakery.data.api.StockMovementDto
import com.erpcloud.bakery.data.api.StockVoucherDto
import com.erpcloud.bakery.data.api.TaxGroupDto
import com.erpcloud.bakery.data.api.TreasuryVoucherDto
import com.erpcloud.bakery.data.api.UnitDto
import com.erpcloud.bakery.data.offline.Idempotency
import com.erpcloud.bakery.data.offline.SessionStore
import com.erpcloud.bakery.data.offline.SnapshotCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.put
import retrofit2.Response

/**
 * نتيجةُ إجراءٍ إداريّ — تطبيقُ الإدارة **متصلٌ دائمًا**: الإجراءُ إمّا وصل
 * (Synced) أو رُفض برسالة الخادم (Refused) أو لم يصل للشبكة (Offline — ليست رفضًا؛
 * تُعاد المحاولة يدويًّا والقرارُ يبقى بيد المستخدم لا طابورَ يخفيه).
 */
sealed class ActionResult {
    /** رسالةُ الخادمِ العربيّةُ الموحّدةُ — تُقرأُ من أيّ نتيجةٍ دون تفكيك النوع. */
    abstract val messageAr: String

    data class Synced(override val messageAr: String) : ActionResult()
    data class Refused(override val messageAr: String) : ActionResult()
    data class Offline(override val messageAr: String) : ActionResult()
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
    private val snapshotCache: SnapshotCache? = null,
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
            snapshotCache?.clear()
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

    suspend fun warehouses(): List<WarehouseOptionDto> = rawList { api.warehouses() }

    suspend fun catalogItems(q: String? = null): List<ItemOptionDto> =
        rawList { api.catalogItems(q?.trim()?.takeIf { it.isNotEmpty() }) }

    /** أصنافُ الكتالوج كاملةً (شاشةُ الكتالوج والفواتير) — نفس المسار برؤيةٍ أوسع وبحثٍ اختياريّ. */
    suspend fun catalogItemsFull(q: String? = null): List<CatalogItemDto> =
        rawList { api.catalogItemsFull(q?.trim()?.takeIf { it.isNotEmpty() }) }

    suspend fun parties(kind: String = "customer"): List<PartyDto> =
        rawList { api.parties(kind = kind) }

    /** إنشاءُ طرفٍ — مورّدٌ أو عميل (إذن parties.manage). */
    suspend fun createParty(body: JsonObject): ActionResult =
        submitDirect("حفظ الطرف") { api.createParty(body) }

    /** طلبُ استعادة كلمة المرور بالبريد — عامٌّ بلا جلسة (شاشة الدخول قبل الدخول). */
    suspend fun forgotPassword(email: String, tenantCode: String): ActionResult =
        submitDirect("إرسال رابط استعادة كلمة المرور") {
            api.forgotPassword(
                JsonObject(
                    mapOf(
                        "email" to JsonPrimitive(email.trim()),
                        "tenantCode" to JsonPrimitive(tenantCode.trim()),
                    )
                )
            )
        }

    suspend fun printView(documentId: String): PrintViewDto = withContext(Dispatchers.IO) {
        val response = api.printView(documentId, copies = 2)
        unwrapEnvelope(response) ?: throw ApiException(ProblemDto(title = "Empty print-view response"), response.code())
    }

    // -------------------------------------------------------------- الإشعارات

    suspend fun notifications(limit: Int = 50, unreadOnly: Boolean = false): NotificationListResponse =
        withContext(Dispatchers.IO) {
            val response = api.notifications(
                limit = limit,
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

    // ------------------------------------------------------ فواتير المبيعات

    /** فواتيرُ المبيعات — `GET /sales/invoices` (إذن `sales.view`). */
    suspend fun salesInvoices(): List<SalesInvoiceDto> = rawList { api.salesInvoices() }

    /** إنشاءُ فاتورة مبيعات (مسودّة) — `POST /sales/invoices`. */
    suspend fun createSalesInvoice(body: JsonObject): ActionResult =
        submitDirect("إنشاء فاتورة المبيعات") { api.createSalesInvoice(body) }

    /** ترحيلُ فاتورة مبيعات — `POST /sales/invoices/{id}/post`. */
    suspend fun postSalesInvoice(id: String, body: JsonObject): ActionResult =
        submitDirect("ترحيل فاتورة المبيعات") { api.postSalesInvoice(id, body) }

    /** مردودُ مبيعات من فاتورةٍ مرحّلة — `POST /sales/invoices/{id}/return`. */
    suspend fun returnSalesInvoice(id: String, body: JsonObject): ActionResult =
        submitDirect("إنشاء مردود المبيعات") { api.returnSalesInvoice(id, body) }

    /** تفاصيلُ فاتورة المبيعات بسطورها ودفعاتها — `GET /sales/invoices/{id}`. */
    suspend fun salesInvoice(id: String): SalesInvoiceDetailDto = rawObject { api.salesInvoice(id) }

    /** تعديلُ مسودّة فاتورة المبيعات — `PATCH /sales/invoices/{id}`. */
    suspend fun updateSalesInvoice(id: String, body: JsonObject): ActionResult =
        submitDirect("تعديل فاتورة المبيعات") { api.updateSalesInvoice(id, body) }

    /** إبطالُ فاتورة مبيعات — `POST /sales/invoices/{id}/void`. */
    suspend fun voidSalesInvoice(id: String, body: JsonObject): ActionResult =
        submitDirect("إبطال فاتورة المبيعات") { api.voidSalesInvoice(id, body) }

    // ---------------------------------------------------- الفروع والمستودعات

    /** إنشاءُ فرع — `POST /branches` (zod صارم: مفاتيحُ معروفةٍ فقط). */
    suspend fun createBranch(body: JsonObject): ActionResult =
        submitDirect("إنشاء الفرع") { api.createBranch(body) }

    /** تعديلُ فرع — `PATCH /branches/{id}`. */
    suspend fun updateBranch(id: String, body: JsonObject): ActionResult =
        submitDirect("تعديل الفرع") { api.updateBranch(id, body) }

    /** إنشاءُ مستودع — `POST /warehouses`. */
    suspend fun createWarehouse(body: JsonObject): ActionResult =
        submitDirect("إنشاء المستودع") { api.createWarehouse(body) }

    /** تعديلُ مستودع — `PATCH /warehouses/{id}` (المرحلة 2). */
    suspend fun updateWarehouse(id: String, body: JsonObject): ActionResult =
        submitDirect("تعديل المستودع") { api.updateWarehouse(id, body) }

    /** إنشاءُ خزينة — `POST /cash-locations`. */
    suspend fun createCashLocation(body: JsonObject): ActionResult =
        submitDirect("إنشاء الخزينة") { api.createCashLocation(body) }

    /** تعديلُ خزينة — `PATCH /cash-locations/{id}` (المرحلة 2). */
    suspend fun updateCashLocation(id: String, body: JsonObject): ActionResult =
        submitDirect("تعديل الخزينة") { api.updateCashLocation(id, body) }

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
                "لم تصل العمليّةُ إلى الخادم — أعد المحاولة عند عودة الاتصال " +
                    "(البياناتُ المعروضةُ آخرُ ما حُفِظ)."
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

    /**
     * قائمةٌ خام تُفكّ تسلسلها من الاستجابة — **بفكّ غلافٍ مزدوج** كقاعدة
     * `web-core/api.ts` نفسها: مصفوفةٌ خام، أو `{data: [...]}`، أو `{items: [...]}`.
     * المتحكماتُ غيرُ موحّدةٍ في هذا (بعضها يلفّ وبعضها لا)، فتقبُّلُ الشكلين
     * هو ما يمنع انهيارَ شاشةٍ كاملةٍ لأنّ متحكمًا غيّر رأيه.
     */
    private suspend inline fun <reified T> rawList(crossinline call: suspend () -> Response<JsonElement>): List<T> =
        withContext(Dispatchers.IO) {
            val response = call()
            if (!response.isSuccessful) throw response.toApiException()
            var payload: JsonElement = response.body() ?: return@withContext emptyList()
            repeat(3) {
                if (payload is JsonObject) {
                    val obj = payload as JsonObject
                    val next = obj["data"] ?: obj["items"] ?: obj["rows"]
                    if (next != null) {
                        payload = next
                    }
                }
            }
            if (payload !is kotlinx.serialization.json.JsonArray) {
                emptyList()
            } else {
                AppJson.decodeFromJsonElement(
                    kotlinx.serialization.builtins.ListSerializer(kotlinx.serialization.serializer<T>()),
                    payload,
                )
            }
        }

    // ------------------------------------------------------------ الكتالوج

    suspend fun catalogCategories(): List<CategoryDto> = rawList { api.catalogCategories() }

    suspend fun catalogUnits(): List<UnitDto> = rawList { api.catalogUnits() }

    suspend fun catalogTaxGroups(): List<TaxGroupDto> = rawList { api.catalogTaxGroups() }

    suspend fun createCategory(body: JsonObject): ActionResult =
        submitDirect("إنشاء المجموعة") { api.createCategory(body) }

    suspend fun createUnit(body: JsonObject): ActionResult =
        submitDirect("إنشاء وحدة القياس") { api.createUnit(body) }

    suspend fun createCatalogItem(body: JsonObject): ActionResult =
        submitDirect("إنشاء الصنف") { api.createCatalogItem(body) }

    /**
     * إنشاءُ صنفٍ وإرجاعُ معرّفه — مخططُ إنشاءِ الخادمِ لا يعرفُ `showInPos`
     * (zod يحذفها بصمت) بينما مخططُ التعديلِ يعرفُها؛ فيُنشأ الصنفُ ثم
     * يُرسَلُ الظهورُ في نقطة البيع بتعديلٍ لاحقٍ بنفس المعرّف.
     */
    suspend fun createCatalogItemReturningId(body: JsonObject): String = withContext(Dispatchers.IO) {
        val created = rawObject<kotlinx.serialization.json.JsonObject> { api.createCatalogItem(body) }
        val id = (created["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content
            ?: throw ApiException(ProblemDto(title = "لم يُرجع الخادمُ معرّف الصنف"), 200)
        id
    }

    /** تعديلُ صنف — `PATCH /organization/catalog/items/{id}` (المرحلة 2). */
    suspend fun updateCatalogItem(id: String, body: JsonObject): ActionResult =
        submitDirect("تعديل الصنف") { api.updateCatalogItem(id, body) }

    /** تعديلُ مجموعة — `PATCH /organization/catalog/categories/{id}`. */
    suspend fun updateCategory(id: String, body: JsonObject): ActionResult =
        submitDirect("تعديل المجموعة") { api.updateCategory(id, body) }

    /** تعديلُ وحدة قياس — `PATCH /organization/catalog/units/{id}`. */
    suspend fun updateUnit(id: String, body: JsonObject): ActionResult =
        submitDirect("تعديل وحدة القياس") { api.updateUnit(id, body) }

    // ------------------------------------------------------- الفروع والخزائن

    suspend fun branches(): List<BranchDto> = withContext(Dispatchers.IO) {
        val response = api.branches()
        if (!response.isSuccessful) throw response.toApiException()
        response.body()?.data ?: emptyList()
    }

    /**
     * كائنٌ خام واحد بفكٍّ مزدوج — كما `rawList`: كائنٌ مباشر أو `{data: {...}}`.
     * للبطاقات التفصيليّة (`GET /purchase-invoices/{id}` وأخواتها).
     */
    private suspend inline fun <reified T> rawObject(crossinline call: suspend () -> Response<JsonElement>): T =
        withContext(Dispatchers.IO) {
            val response = call()
            if (!response.isSuccessful) throw response.toApiException()
            val element = response.body() ?: throw ApiException(ProblemDto(title = "Empty detail response"), response.code())
            val payload = (element as? JsonObject)?.get("data")?.takeIf { it !is JsonNull } ?: element
            AppJson.decodeFromJsonElement(kotlinx.serialization.serializer<T>(), payload)
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

    /** تفاصيلُ فاتورة المشتريات بسطورها — `GET /purchase-invoices/{id}`. */
    suspend fun purchaseInvoice(id: String): PurchaseInvoiceDetailDto = rawObject { api.purchaseInvoice(id) }

    /** تعديلُ مسودّة فاتورة المشتريات — `PATCH /purchase-invoices/{id}`. */
    suspend fun updatePurchaseInvoice(id: String, body: JsonObject): ActionResult =
        submitDirect("تعديل فاتورة المشتريات") { api.updatePurchaseInvoice(id, body) }

    /** إبطالُ فاتورة مشتريات — `POST /purchase-invoices/{id}/void`. */
    suspend fun voidPurchaseInvoice(id: String, body: JsonObject): ActionResult =
        submitDirect("إبطال فاتورة المشتريات") { api.voidPurchaseInvoice(id, body) }

    // --------------------------------------------------------- سندات المخزون

    suspend fun stockVouchers(kind: String? = null, status: String? = null): List<StockVoucherDto> = rawList {
        api.stockVouchers(kind, status)
    }

    suspend fun createStockVoucher(body: JsonObject): ActionResult =
        submitDirect("إنشاء السند المخزنيّ") { api.createStockVoucher(body) }

    suspend fun postStockVoucher(id: String, body: JsonObject): ActionResult =
        submitDirect("ترحيل السند المخزنيّ") { api.postStockVoucher(id, body) }

    /** إبطالُ سندٍ مخزنيّ — `POST /inventory/vouchers/{id}/void`. */
    suspend fun voidStockVoucher(id: String, body: JsonObject): ActionResult =
        submitDirect("إبطال السند المخزنيّ") { api.voidStockVoucher(id, body) }

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

    /**
     * فتحُ ورديةِ الكاشير — `POST /treasury/shift-closes/open {branchId}`.
     * الردُّ كائنُ الوردية (id/status/…)؛ الخادمُ يرفضُ فتحًا فوق ورديةٍ مفتوحة
     * برمزٍ واضحٍ يُترجَمُ في ErrorsAr.
     */
    suspend fun openShift(branchId: String): JsonObject = withContext(Dispatchers.IO) {
        val body = kotlinx.serialization.json.buildJsonObject {
            put("branchId", branchId)
        }
        rawObject { api.openShift(body) }
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

    /** تعديلُ موظف — `PATCH /hrm/employees/{id}` (المرحلة 2). */
    suspend fun updateEmployee(id: String, body: JsonObject): ActionResult =
        submitDirect("تعديل الموظف") { api.updateEmployee(id, body) }

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

    // ------------------------------------------------------ الخزينة والمصروفات

    suspend fun treasuryVouchers(from: String? = null, to: String? = null): List<TreasuryVoucherDto> =
        rawList { api.treasuryVouchers(from, to) }

    suspend fun createTreasuryVoucher(body: JsonObject): ActionResult =
        submitDirect("إنشاء السند") { api.createTreasuryVoucher(body) }

    suspend fun postTreasuryVoucher(id: String, body: JsonObject): ActionResult =
        submitDirect("ترحيل السند") { api.postTreasuryVoucher(id, body) }

    /** تفاصيلُ السند — `GET /vouchers/{id}` (البطاقة التفصيليّة، المرحلة 2). */
    suspend fun treasuryVoucher(id: String): TreasuryVoucherDto = rawObject { api.treasuryVoucher(id) }

    /** تعديلُ مسودّة السند قبل الترحيل — `PATCH /vouchers/{id}`. */
    suspend fun updateTreasuryVoucher(id: String, body: JsonObject): ActionResult =
        submitDirect("تعديل السند") { api.updateTreasuryVoucher(id, body) }

    /** إبطالُ السند — `POST /vouchers/{id}/void`. */
    suspend fun voidTreasuryVoucher(id: String, body: JsonObject): ActionResult =
        submitDirect("إبطال السند") { api.voidTreasuryVoucher(id, body) }

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

    /** تعديلُ طرفٍ — `PUT /parties/{id}` (المرحلة 2). */
    suspend fun updateParty(id: String, body: JsonObject): ActionResult =
        submitDirect("تعديل الطرف") { api.updateParty(id, body) }


    // ---------------------------------------------------- المنظّمة والأدوار

    suspend fun salesRegistry(): List<SalesRegistryDto> = rawList { api.salesRegistry() }

    suspend fun createSalesRegistry(body: JsonObject): ActionResult =
        submitDirect("إنشاء مندوب المبيعات") { api.createSalesRegistry(body) }

    /** تعديلُ مندوب (العمولات/الجوال/المستودع) — `PATCH /sales/salesmen/{id}`. */
    suspend fun updateSalesRegistry(id: String, body: JsonObject): ActionResult =
        submitDirect("تعديل المندوب") { api.updateSalesRegistry(id, body) }

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

    suspend fun updateRolePermissions(id: String, body: JsonObject): ActionResult =
        submitDirect("تحديث أذونات الدور") { api.updateRolePermissions(id, body) }

    suspend fun updateMembership(id: String, body: JsonObject): ActionResult =
        submitDirect("تحديث العضويّة") { api.updateMembership(id, body) }

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

    // -------------------------------------------------- طباعة الخادم الاحترافية

    /**
     * قلبُ مسارِ الطباعةِ الاحترافيّة: يجلبُ الصفحةَ `{html}` من الخادمِ ويُعرّيها من
     * شريطِ أدواتِ المتصفّحِ (`<div class="toolbar">`) كما تفعلُ نافذةُ الطباعةِ في
     * الويب — فلا يظهرُ زرُّ «طباعة» الويبِ داخلَ ورقةِ الطباعةِ على الجهاز.
     */
    private suspend fun printHtml(call: suspend () -> Response<com.erpcloud.bakery.data.api.PrintHtmlDto>): String =
        withContext(Dispatchers.IO) {
            val response = call()
            if (!response.isSuccessful) throw response.toApiException()
            val html = response.body()?.html.orEmpty()
            if (html.isBlank()) throw ApiException(ProblemDto(title = "Empty print response"), response.code())
            html.replace(Regex("<div class=\"toolbar\">[\\s\\S]*?</div>\\s*(?=<div class=\"sheet)"), "")
        }

    /** صفحةُ طباعةِ فاتورةِ مبيعات — `paper=small` تُخرجُها إيصالَ كاشيرٍ 80mm. */
    suspend fun salesInvoicePrintHtml(id: String, paper: String? = null): String =
        printHtml { api.salesInvoicePrintHtml(id, paper) }

    /** صفحةُ طباعةِ فاتورةِ مشتريات A4. */
    suspend fun purchaseInvoicePrintHtml(id: String): String =
        printHtml { api.purchaseInvoicePrintHtml(id) }

    /** صفحةُ طباعةِ سندِ خزينة A4. */
    suspend fun treasuryVoucherPrintHtml(id: String): String =
        printHtml { api.treasuryVoucherPrintHtml(id) }

    /** صفحةُ طباعةِ إقفالِ ورديةٍ A4 (تقرير Z للكاشير). */
    suspend fun shiftPrintHtml(id: String): String =
        printHtml { api.shiftPrintHtml(id) }

    /** صفحةُ طباعةِ تقريرٍ A4 بنفسِ مدخلاتِ تشغيله. */
    suspend fun reportPrintHtml(key: String, params: JsonObject): String =
        withContext(Dispatchers.IO) {
            val query = params.entries
                .mapNotNull { (name, value) ->
                    (value as? kotlinx.serialization.json.JsonPrimitive)
                        ?.takeIf { it.content.isNotBlank() }
                        ?.let { name to it.content }
                }
                .toMap()
            printHtml { api.reportPrintHtml(key, query) }
        }

    /** ملفُ المنشأة — اسمُ البائعِ ورقمُهُ الضريبيّ (وسما QR ١ و٢). */
    suspend fun companyProfile(): com.erpcloud.bakery.data.api.CompanyProfileDto =
        withContext(Dispatchers.IO) {
            val response = api.companyProfile()
            if (!response.isSuccessful) throw response.toApiException()
            response.body()?.data ?: throw ApiException(ProblemDto(title = "Empty company profile"), response.code())
        }

    // --------------------------------------------------- الهوية العامة والدعم الفني

    suspend fun fetchPublicSite(): com.erpcloud.bakery.data.api.PublicSiteDto? =
        withContext(Dispatchers.IO) {
            runCatching {
                val resp = api.publicSite()
                if (resp.isSuccessful) {
                    val site = resp.body()?.data
                    if (site != null && site.brandName.isNotBlank()) {
                        sessionStore.setBranding(site.brandName, site.taglineAr)
                    }
                    site
                } else null
            }.getOrNull()
        }

    suspend fun publicHelp(q: String? = null): List<com.erpcloud.bakery.data.api.PublicHelpPostDto> =
        rawList { api.publicHelp(q?.trim()?.takeIf { it.isNotEmpty() }) }

    suspend fun publicFaq(): List<com.erpcloud.bakery.data.api.PublicFaqDto> =
        rawList { api.publicFaq() }

    suspend fun supportTickets(): List<com.erpcloud.bakery.data.api.SupportTicketDto> =
        rawList { api.supportTickets() }

    suspend fun supportTicketDetail(id: String): com.erpcloud.bakery.data.api.SupportTicketDto =
        withContext(Dispatchers.IO) {
            val resp = api.supportTicketDetail(id)
            unwrapEnvelope(resp) ?: throw ApiException(ProblemDto(title = "Empty support ticket"), resp.code())
        }

    suspend fun createSupportTicket(body: JsonObject): com.erpcloud.bakery.data.api.SupportTicketDto =
        withContext(Dispatchers.IO) {
            val resp = api.createSupportTicket(body)
            unwrapEnvelope(resp) ?: throw ApiException(ProblemDto(title = "Empty support ticket response"), resp.code())
        }

    suspend fun replySupportTicket(id: String, body: JsonObject): com.erpcloud.bakery.data.api.SupportTicketDto =
        withContext(Dispatchers.IO) {
            val resp = api.replySupportTicket(id, body)
            unwrapEnvelope(resp) ?: throw ApiException(ProblemDto(title = "Empty support reply response"), resp.code())
        }

    // ------------------------------------------ الفواتير الضريبية المرفوعة (ZATCA)

    suspend fun einvoiceFilings(
        status: String? = null,
        from: String? = null,
        to: String? = null,
        pageNo: Int = 1,
        pageSize: Int = 50,
    ): com.erpcloud.bakery.data.api.EinvoiceFilingPageDto = withContext(Dispatchers.IO) {
        val resp = api.einvoiceFilings(
            status = status?.takeIf { it.isNotBlank() },
            from = from?.takeIf { it.isNotBlank() },
            to = to?.takeIf { it.isNotBlank() },
            pageNo = pageNo,
            pageSize = pageSize,
        )
        unwrapEnvelope(resp) ?: com.erpcloud.bakery.data.api.EinvoiceFilingPageDto()
    }

    suspend fun einvoiceFilingDetail(id: String): com.erpcloud.bakery.data.api.EinvoiceFilingDetailDto =
        withContext(Dispatchers.IO) {
            val resp = api.einvoiceFilingDetail(id)
            unwrapEnvelope(resp) ?: throw ApiException(ProblemDto(title = "Empty filing detail"), resp.code())
        }

    suspend fun einvoiceChain(): com.erpcloud.bakery.data.api.EinvoiceChainStateDto? =
        withContext(Dispatchers.IO) {
            runCatching { unwrapEnvelope(api.einvoiceChain()) }.getOrNull()
        }

    suspend fun syncEinvoices(): com.erpcloud.bakery.data.api.EinvoiceSyncReportDto =
        withContext(Dispatchers.IO) {
            val resp = api.syncEinvoices(kotlinx.serialization.json.buildJsonObject {})
            unwrapEnvelope(resp) ?: com.erpcloud.bakery.data.api.EinvoiceSyncReportDto()
        }

    suspend fun retryEinvoice(id: String): ActionResult =
        submitDirect("إعادة إرسال الفاتورة الضريبية") {
            api.retryEinvoice(id, kotlinx.serialization.json.buildJsonObject {})
        }

    // ------------------------------------------------ المساعد الذكي (AI) وإعداداته

    suspend fun aiSettings(): com.erpcloud.bakery.data.api.AiSettingsDto = withContext(Dispatchers.IO) {
        val resp = api.aiSettings()
        unwrapEnvelope(resp) ?: com.erpcloud.bakery.data.api.AiSettingsDto()
    }

    suspend fun updateAiSettings(body: JsonObject): ActionResult =
        submitDirect("حفظ إعدادات المساعد الذكي") { api.updateAiSettings(body) }

    suspend fun testAiSettings(): com.erpcloud.bakery.data.api.AiTestResultDto = withContext(Dispatchers.IO) {
        val resp = api.testAiSettings(kotlinx.serialization.json.buildJsonObject {})
        unwrapEnvelope(resp) ?: throw ApiException(ProblemDto(title = "Empty AI test response"), resp.code())
    }

    suspend fun aiSuggestions(): List<com.erpcloud.bakery.data.api.AiSuggestionDto> {
        val existing: List<com.erpcloud.bakery.data.api.AiSuggestionDto> = rawList { api.aiSuggestions() }
        if (existing.isNotEmpty()) return existing
        return runCatching {
            rawList<com.erpcloud.bakery.data.api.AiSuggestionDto> {
                api.generateAiSuggestions(kotlinx.serialization.json.buildJsonObject {})
            }
        }.getOrDefault(emptyList())
    }

    suspend fun aiConversations(): List<com.erpcloud.bakery.data.api.AiConversationRowDto> =
        rawList { api.aiConversations() }

    suspend fun aiConversation(id: String): com.erpcloud.bakery.data.api.AiStoredConversationDto =
        withContext(Dispatchers.IO) {
            val resp = api.aiConversation(id)
            unwrapEnvelope(resp) ?: com.erpcloud.bakery.data.api.AiStoredConversationDto(id = id)
        }

    suspend fun aiChat(message: String, conversationId: String?): com.erpcloud.bakery.data.api.AiChatResultDto =
        withContext(Dispatchers.IO) {
            val payload = kotlinx.serialization.json.buildJsonObject {
                put("message", kotlinx.serialization.json.JsonPrimitive(message))
                if (!conversationId.isNullOrBlank()) {
                    put("conversationId", kotlinx.serialization.json.JsonPrimitive(conversationId))
                }
                put("stream", kotlinx.serialization.json.JsonPrimitive(false))
            }
            val resp = api.aiChat(payload)
            unwrapEnvelope(resp) ?: throw ApiException(ProblemDto(title = "Empty AI chat response"), resp.code())
        }

    // ----------------------------------------- الصناديق والبنوك والأرصدة وحركة الصندوق

    suspend fun cashLocationDetail(id: String): CashLocationDto = withContext(Dispatchers.IO) {
        val resp = api.cashLocationDetail(id)
        if (!resp.isSuccessful) throw resp.toApiException()
        val body = resp.body() ?: throw ApiException(ProblemDto(title = "Empty cash location"), resp.code())
        val inner = (body as? JsonObject)?.get("data") ?: body
        AppJson.decodeFromJsonElement(CashLocationDto.serializer(), inner)
    }

    suspend fun cashLocationBalances(id: String): List<com.erpcloud.bakery.data.api.CashLocationBalanceDto> =
        rawList { api.cashLocationBalances(id) }

    suspend fun cashLocationMovements(
        id: String,
        all: Boolean = true,
        from: String? = null,
        to: String? = null,
    ): com.erpcloud.bakery.data.api.CashMovementStatementDto = withContext(Dispatchers.IO) {
        val resp = api.cashLocationMovements(
            id = id,
            all = if (all) "1" else null,
            from = if (all) null else from?.takeIf { it.isNotBlank() },
            to = if (all) null else to?.takeIf { it.isNotBlank() },
        )
        if (!resp.isSuccessful) throw resp.toApiException()
        val body = resp.body() ?: throw ApiException(ProblemDto(title = "Empty movement statement"), resp.code())
        val inner = (body as? JsonObject)?.get("data") ?: body
        AppJson.decodeFromJsonElement(com.erpcloud.bakery.data.api.CashMovementStatementDto.serializer(), inner)
    }

    suspend fun recalcCashLocationBalance(id: String): ActionResult =
        submitDirect("مطابقة رصيد الصندوق") {
            api.recalcCashLocationBalance(id, kotlinx.serialization.json.buildJsonObject {})
        }

    suspend fun deleteCashLocation(id: String): ActionResult = withContext(Dispatchers.IO) {
        try {
            val resp = api.deleteCashLocation(id)
            if (resp.isSuccessful) ActionResult.Synced("تم حذف الخزينة بنجاح.")
            else ActionResult.Refused(resp.toApiException().userMessage)
        } catch (e: ApiException) {
            ActionResult.Refused(e.userMessage)
        } catch (e: java.io.IOException) {
            ActionResult.Offline("تعذّر الاتصال بالخدمة السحابية — تحقّق من اتصال الإنترنت.")
        }
    }

    suspend fun cashTransfers(
        status: String? = null,
        from: String? = null,
        to: String? = null,
    ): List<com.erpcloud.bakery.data.api.CashTransferDto> =
        rawList {
            api.cashTransfers(
                status = status?.takeIf { it.isNotBlank() },
                from = from?.takeIf { it.isNotBlank() },
                to = to?.takeIf { it.isNotBlank() },
            )
        }

    suspend fun createCashTransfer(body: JsonObject): com.erpcloud.bakery.data.api.CashTransferDto =
        withContext(Dispatchers.IO) {
            val resp = api.createCashTransfer(body)
            if (!resp.isSuccessful) throw resp.toApiException()
            val elem = resp.body() ?: return@withContext com.erpcloud.bakery.data.api.CashTransferDto()
            val inner = (elem as? JsonObject)?.get("data") ?: elem
            runCatching {
                AppJson.decodeFromJsonElement(com.erpcloud.bakery.data.api.CashTransferDto.serializer(), inner)
            }.getOrDefault(com.erpcloud.bakery.data.api.CashTransferDto())
        }

    suspend fun sendCashTransfer(id: String): ActionResult =
        submitDirect("اعتماد إرسال المناقلة") {
            api.sendCashTransfer(id, kotlinx.serialization.json.buildJsonObject {})
        }

    suspend fun receiveCashTransfer(id: String): ActionResult =
        submitDirect("تأكيد استلام المناقلة") {
            api.receiveCashTransfer(id, kotlinx.serialization.json.buildJsonObject {})
        }

    suspend fun cancelCashTransfer(id: String): ActionResult =
        submitDirect("إلغاء المناقلة") {
            api.cancelCashTransfer(id, kotlinx.serialization.json.buildJsonObject {})
        }
}
