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

    suspend fun parties(): List<PartyDto> = withContext(Dispatchers.IO) {
        val response = api.parties()
        if (!response.isSuccessful) throw response.toApiException()
        response.body() ?: emptyList()
    }

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
                filterRead = if (unreadOnly) "false" else null,
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
}
