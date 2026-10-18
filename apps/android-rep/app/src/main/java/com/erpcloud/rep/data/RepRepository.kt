package com.erpcloud.rep.data

import com.erpcloud.rep.data.api.ApiEnvelope
import com.erpcloud.rep.data.api.ApiException
import com.erpcloud.rep.data.api.AppJson
import com.erpcloud.rep.data.api.ChangePasswordRequest
import com.erpcloud.rep.data.api.ClosingRequest
import com.erpcloud.rep.data.api.CollectionRequest
import com.erpcloud.rep.data.api.LoginRequest
import com.erpcloud.rep.data.api.LoginResponse
import com.erpcloud.rep.data.api.MeResponse
import com.erpcloud.rep.data.api.NotificationListResponse
import com.erpcloud.rep.data.api.PartyDto
import com.erpcloud.rep.data.api.PrintViewDto
import com.erpcloud.rep.data.api.ProblemDto
import com.erpcloud.rep.data.api.ReceiptRequest
import com.erpcloud.rep.data.api.RepApi
import com.erpcloud.rep.data.api.RepWorkspace
import com.erpcloud.rep.data.api.ReturnRequest
import com.erpcloud.rep.data.api.SaleRequest
import com.erpcloud.rep.data.offline.Idempotency
import com.erpcloud.rep.data.offline.QueueOperation
import com.erpcloud.rep.data.offline.QueueRecord
import com.erpcloud.rep.data.offline.QueueStatus
import com.erpcloud.rep.data.offline.QueueStore
import com.erpcloud.rep.data.offline.SessionStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import retrofit2.Response

/**
 * نتيجةُ إجراءٍ واحد — كما تصنّفها شاشةُ الويب (`classifyReplay` في rep-queue.ts):
 * وصلت / حُفظت في الطابور / رُفضت برسالة الخادم / محظورة قبل الإرسال.
 */
sealed class ActionResult {
    data class Synced(val messageAr: String) : ActionResult()
    data class StoredOffline(val messageAr: String) : ActionResult()
    data class Refused(val messageAr: String) : ActionResult()
    data class Blocked(val reasonsAr: List<String>) : ActionResult()
}

/**
 * المستودعُ — كلُّ نداءات الشبكة تمرّ من هنا، وكلُّ إجراءٍ يحمل حكمَ الطابور نفسه
 * الذي تحمله شاشةُ الويب:
 *
 * 1. الإجراءاتُ القابلةُ للحفظ (بيع/مرتجع/تحصيل) تحمل `idempotencyKey` في جسمها،
 *    وعند انقطاع الشبكة أو خطأ ٥xx تُحفظ النيّةُ بمفتاحها وتُعاد لمسارها الرسميّ.
 * 2. الاستلامُ والإقفالُ **لا يُحفظان** — مساراهما بلا مفتاح، وإعادةٌ عمياءٌ تعيد
 *    كتابةَ إعلان الجرد أو ترجع 409 فتظهر نيّةٌ ناجحةٌ خطأً.
 * 3. ردودُ الإجراءات (لوحة الخطّ) لا تُفكّك — يُكتفى بـ2xx ثم إعادة قراءة المساحة.
 */
class RepRepository(
    private val api: RepApi,
    private val sessionStore: SessionStore,
    private val queueStore: QueueStore,
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

    suspend fun workspace(): RepWorkspace = withContext(Dispatchers.IO) {
        val response = api.workspace()
        unwrapEnvelope(response) ?: throw ApiException(ProblemDto(title = "Empty workspace response"), response.code())
    }

    suspend fun parties(): List<PartyDto> = withContext(Dispatchers.IO) {
        val response = api.parties()
        if (!response.isSuccessful) throw response.toApiException()
        response.body() ?: emptyList()
    }

    /**
     * صندوقُ الإشعارات — يتطلّب إذنَ tenant.notification.view؛ إن لم يملكه الحسابُ
     * فخطأُ الخادم (403) يصل كما هو ليعرض لا ليُبتلع.
     */
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

    /** تعليمُ إشعارٍ كمقروء — تكرارٌ آمن في الخادم (201/200 كلاهما نجاح). */
    suspend fun markNotificationRead(id: String): ActionResult =
        submitDirect("تعليم الإشعار كمقروء") { api.markNotificationRead(id) }

    /**
     * تغييرُ كلمة المرور — نجاحُه 204 **ويُبطل الخادمُ كلَّ الجلسات**؛ لذا يُستدعى
     * بعده clearSession في الواجهة وتُحدَّث الكلمةُ المحفوظة إن كانت محفوظة.
     */
    suspend fun changePassword(current: String, new: String): ActionResult =
        submitDirect("تغيير كلمة المرور") { api.changePassword(ChangePasswordRequest(current, new)) }

    suspend fun printView(documentId: String): PrintViewDto = withContext(Dispatchers.IO) {
        val response = api.printView(documentId, copies = 2)
        unwrapEnvelope(response) ?: throw ApiException(ProblemDto(title = "Empty print-view response"), response.code())
    }

    // ------------------------------------------------------------ ترميزُ الأجسام

    /** ترميزُ جسم طلبٍ إلى JsonObject — الحقول الفارغة تُحذف (encodeDefaults=false). */
    fun encodeBody(value: Any): JsonObject = when (value) {
        is SaleRequest -> AppJson.encodeToJsonElement(SaleRequest.serializer(), value)
        is ReturnRequest -> AppJson.encodeToJsonElement(ReturnRequest.serializer(), value)
        is CollectionRequest -> AppJson.encodeToJsonElement(CollectionRequest.serializer(), value)
        is ReceiptRequest -> AppJson.encodeToJsonElement(ReceiptRequest.serializer(), value)
        is ClosingRequest -> AppJson.encodeToJsonElement(ClosingRequest.serializer(), value)
        else -> throw IllegalArgumentException("نوعُ طلبٍ غير مدعوم: ${value::class.simpleName}")
    }.jsonObject

    /**
     * إلحاقُ مفتاح عدم التكرار بالجسم — **النيّةُ الواحدةُ مفتاحٌ واحد**:
     * المفتاحُ يُبنى مرّةً عند أوّل إرسال/حفظ (أو يُستعمل المُمرَّر إن وُجد)، والجسمُ
     * المعاد هو ما يُرسل ويُخزَّن في الطابور فلا يُبنى مرّتين فيختلفا.
     */
    fun withIdempotencyKey(operation: QueueOperation, body: JsonObject, existingKey: String?): JsonObject {
        val present = (body["idempotencyKey"] as? JsonPrimitive)?.content?.takeIf { it.isNotBlank() }
        val key = present ?: existingKey?.takeIf { it.isNotBlank() } ?: Idempotency.buildKey(operation.keyPrefix, body)
        return Idempotency.withKey(body, key)
    }

    // ------------------------------------------------------------ الإجراءات

    /**
     * إرسالُ إجراءٍ **قابلٍ للحفظ** (بيع/مرتجع/تحصيل): الجسمُ يحمل مفتاح عدم التكرار
     * بالفعل، وعند الفشل غير الرفضيّ (شبكة/٥xx) يُحفظ كما هو بمفتاحه في الطابور.
     */
    suspend fun submitQueueable(
        operation: QueueOperation,
        targetId: String?,
        body: JsonObject,
        online: Boolean,
    ): ActionResult {
        val endpoint = operation.endpoint(targetId)
        if (!online) {
            enqueue(operation, endpoint, body)
            return ActionResult.StoredOffline(
                "حُفظت النيّةُ محليًّا (${operation.labelAr}) وستُرسل إلى مسارها الرسميّ لحظةَ عودة الشبكة " +
                    "بمفتاح عدم تكرارٍ واحد — فلا مستندَ مكرَّر ولو أُعيد الإرسال مرّات."
            )
        }
        return try {
            val response = api.postQueue(endpoint, body)
            if (response.isSuccessful) {
                ActionResult.Synced("تمّت العمليّة بنجاح — ${operation.labelAr}.")
            } else {
                classifyApiFailure(operation, endpoint, body, response.toApiException())
            }
        } catch (error: java.io.IOException) {
            enqueue(operation, endpoint, body)
            ActionResult.StoredOffline(
                "تعذّر الوصول إلى الخادم — حُفظت النيّةُ (${operation.labelAr}) في الطابور وستُرسل بمفتاحها نفسه."
            )
        }
    }

    /** إرسالُ إجراءٍ **غير قابلٍ للحفظ** (استلام/إقفال) — لا طابورَ ولا إعادة. */
    suspend fun submitDirect(
        labelAr: String,
        call: suspend () -> Response<JsonElement>,
    ): ActionResult = withContext(Dispatchers.IO) {
        try {
            val response = call()
            if (response.isSuccessful) {
                ActionResult.Synced("تمّت العمليّة بنجاح — $labelAr.")
            } else {
                ActionResult.Refused(response.toApiException().userMessage)
            }
        } catch (error: java.io.IOException) {
            ActionResult.Refused(
                "لم تصل العمليّةُ إلى الخادم — وهذا الإجراء لا يُحفظ دون اتصال " +
                    "(فمساره لا يحمل مفتاحَ عدم تكرار): أعد المحاولة لحظةَ عودة الشبكة وأنت تنظر إلى السيارة."
            )
        } catch (error: Exception) {
            ActionResult.Refused(error.message ?: "تعذّر إكمال الطلب")
        }
    }

    /** تأكيدُ استلام التوريد — مسارٌ مباشرٌ (المندوبُ صاحبُ العهدة أو المحاسب المخوّل). */
    suspend fun confirmReceipt(loadOrderId: String, body: JsonObject): ActionResult =
        submitDirect("تأكيد استلام التوريد") { api.confirmReceipt(loadOrderId, body) }

    /** إغلاقُ الوردية — مسارٌ مباشرٌ، لا مفتاحَ في جسمه ولا حفظَ في الطابور. */
    suspend fun submitClosing(loadOrderId: String, body: JsonObject): ActionResult =
        submitDirect("إغلاق الوردية") { api.submitClosing(loadOrderId, body) }

    // ------------------------------------------------------------ إعادة الطابور

    /**
     * خطّةُ الإعادة: النيّاتُ المعلّقة بترتيب الإدخال. تُعاد النيّةُ إلى مسارها الرسميّ
     * نفسه، والتصنيفُ كما في `classifyReplay`:
     * ‏2xx ⇒ synced · 409 IDEMPOTENCY_REPLAY ⇒ refused (تحتاج قرار المندوب) ·
     * بقيةُ 4xx ⇒ refused برسالة الخادم · ٥xx/شبكة ⇒ تبقى pending.
     */
    suspend fun replayQueue(onEach: suspend (QueueRecord, ActionResult) -> Unit): Int {
        var sent = 0
        for (record in queueStore.syncPlan()) {
            val outcome: ActionResult
            try {
                val response = api.postQueue(record.endpoint, record.body)
                outcome = if (response.isSuccessful) {
                    sent += 1
                    ActionResult.Synced("وصلت النيّةُ إلى الخادم.")
                } else {
                    val error = response.toApiException()
                    when {
                        error.httpStatus >= 500 -> ActionResult.StoredOffline(
                            "خطأُ خادمٍ (${error.httpStatus}) — النيّةُ لم تُرفض فتبقى في الطابور."
                        )
                        error.errorCode == "IDEMPOTENCY_REPLAY" -> ActionResult.Refused(
                            error.userMessage + " — المفتاحُ نفسه استُعمل بحمولةٍ مختلفة: النيّةُ عُدِّلت بعد حفظها وتحتاج قرارك لا إعادةً عمياء."
                        )
                        else -> ActionResult.Refused(error.userMessage)
                    }
                }
            } catch (_: java.io.IOException) {
                // انقطاعُ الشبكة أثناء الإعادة: توقّف ولا تعِد البقيّة عمياءً.
                queueStore.update(record.offlineId) {
                    it.copy(attempts = it.attempts + 1, lastMessage = "لا شبكة — توقّفت الإعادةُ والنيّةُ تبقى في الطابور.")
                }
                onEach(record, ActionResult.StoredOffline("لا شبكة — توقّفت الإعادةُ والبقيّةُ تنتظر في الطابور."))
                break
            }
            val nextStatus = when (outcome) {
                is ActionResult.Synced -> QueueStatus.SYNCED
                is ActionResult.StoredOffline -> QueueStatus.PENDING
                is ActionResult.Refused -> QueueStatus.REFUSED
                is ActionResult.Blocked -> QueueStatus.REFUSED
            }
            val message = when (outcome) {
                is ActionResult.Synced -> outcome.messageAr
                is ActionResult.StoredOffline -> outcome.messageAr
                is ActionResult.Refused -> outcome.messageAr
                is ActionResult.Blocked -> outcome.reasonsAr.joinToString(" · ")
            }
            queueStore.update(record.offlineId) {
                it.copy(status = nextStatus.name, attempts = it.attempts + 1, lastMessage = message)
            }
            onEach(record, outcome)
        }
        return sent
    }

    suspend fun clearSynced() = queueStore.removeSynced()

    // ------------------------------------------------------------ أدوات داخلية

    private suspend fun enqueue(operation: QueueOperation, endpoint: String, body: JsonObject) {
        val key = (body["idempotencyKey"] as? JsonPrimitive)?.content.orEmpty()
        queueStore.add(
            QueueRecord(
                operation = operation.name,
                endpoint = endpoint,
                body = body,
                idempotencyKey = key,
                label = operation.labelAr,
                sequenceNo = queueStore.nextSequence(),
                deviceId = sessionStore.cached.deviceId,
            )
        )
    }

    private suspend fun classifyApiFailure(
        operation: QueueOperation,
        endpoint: String,
        body: JsonObject,
        error: ApiException,
    ): ActionResult = if (error.httpStatus >= 500) {
        enqueue(operation, endpoint, body)
        ActionResult.StoredOffline("خطأُ خادمٍ (${error.httpStatus}) — النيّةُ لم تُرفض فحُفظت في الطابور.")
    } else {
        ActionResult.Refused(error.userMessage)
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
