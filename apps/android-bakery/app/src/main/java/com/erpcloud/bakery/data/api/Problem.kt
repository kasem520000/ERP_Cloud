package com.erpcloud.bakery.data.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject

/**
 * غلافُ الخطأ الرسميّ RFC-9457 — كلّ أخطاء الخادم بهذا الشكل
 * (docs/ANDROID_REP_APP_API_REFERENCE.md §١ / ANDROID_REP_APP_API_RESPONSES.json → errorResponse).
 */
@Serializable
data class ProblemDto(
    val type: String? = null,
    val title: String? = null,
    val status: Int? = null,
    val code: String? = null,
    val detail: String? = null,
    val traceId: String? = null,
    val errors: List<FieldErrorDto>? = null,
)

@Serializable
data class FieldErrorDto(
    val field: String? = null,
    val message: String? = null,
)

private val ARABIC_CHARS = Regex("[\\u0600-\\u06FF]")

/** خطأُ HTTP من الخادم — نُصُّه العربيُّ جاهزٌ للعرض كما هو. */
class ApiException(
    val problem: ProblemDto,
    val httpStatus: Int,
) : Exception(problem.detail ?: problem.title ?: "HTTP $httpStatus") {

    /**
     * النصُّ المعروض للمستخدم — يطابقُ قاعدة `packages/web-core/src/api.ts`:
     * 1. إن كان `detail` من الخادم عربيًّا (في ٤xx) يُعرضُ حرفيًّا كما قاله الخادم
     *    (فلا تطمسُ رسالةٌ عامّةٌ كـ `VALIDATION_FAILED` تفصيلًا عربيًّا دقيقًا من الخادم).
     * 2. وإلّا تُستعملُ ترجمةُ الرمز من [ErrorsAr] مع إلحاق أخطاء الحقول العربيّة إن وُجدت.
     * 3. وإلّا يُعرضُ `detail` (في ٤xx) أو `title`.
     */
    val userMessage: String
        get() {
            val detail = problem.detail?.trim().orEmpty()
            val arabicFieldErrors = problem.errors.orEmpty()
                .mapNotNull { err ->
                    val msg = err.message?.trim().orEmpty()
                    if (msg.isEmpty()) null
                    else if (!err.field.isNullOrBlank() && ARABIC_CHARS.containsMatchIn(msg)) "${err.field}: $msg"
                    else if (ARABIC_CHARS.containsMatchIn(msg)) msg
                    else null
                }
            if (httpStatus < 500 && detail.isNotEmpty() && ARABIC_CHARS.containsMatchIn(detail)) {
                return if (arabicFieldErrors.isEmpty()) detail
                else "$detail (${arabicFieldErrors.joinToString(" · ")})"
            }
            ErrorsAr.translate(problem.code)?.let { translated ->
                return if (arabicFieldErrors.isEmpty()) translated
                else "$translated (${arabicFieldErrors.joinToString(" · ")})"
            }
            if (httpStatus < 500 && detail.isNotEmpty()) return detail
            val title = problem.title?.trim().orEmpty()
            if (title.isNotEmpty()) return title
            return "تعذّر إكمال الطلب ($httpStatus)"
        }

    val errorCode: String get() = problem.code ?: ""
}

/** الطلبُ لم يصل إلى الخادم (انقطاع شبكة/مهلة) — ليس رفضًا. */
class NetworkException(cause: Throwable) : Exception(cause) {
    val userMessage: String get() = "تعذّر الاتصال بالخدمة السحابية — تحقّق من اتصال الإنترنت وحاول مرّةً أخرى"
}

/**
 * غلافُ النجاح المرن — يطابق `unwrap` في `packages/web-core/src/api.ts`:
 * يفكُّ `{ "data": … }` و`{ "items": […] }` و`{ "rows": […] }` كما يقبلُ الكائنَ الخام
 * أو المصفوفةَ الخام إن غيّر متحكّمٌ شكل غلافه.
 */
@Serializable(with = ApiEnvelopeSerializer::class)
data class ApiEnvelope<T>(
    val data: T? = null,
)

class ApiEnvelopeSerializer<T>(
    private val dataSerializer: KSerializer<T>,
) : KSerializer<ApiEnvelope<T>> {

    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("ApiEnvelope") {
            element("data", dataSerializer.descriptor, isOptional = true)
        }

    override fun deserialize(decoder: Decoder): ApiEnvelope<T> {
        val jsonDecoder = decoder as? JsonDecoder
            ?: error("ApiEnvelopeSerializer يدعم JSON فقط")
        val root = jsonDecoder.decodeJsonElement()
        val candidate = when {
            root is JsonNull -> return ApiEnvelope(null)
            root is JsonObject && "data" in root -> root["data"] ?: JsonNull
            else -> root
        }
        if (candidate is JsonNull) return ApiEnvelope(null)
        val normalized = if (dataSerializer.descriptor.kind == StructureKind.LIST && candidate is JsonObject) {
            (candidate["items"] as? JsonArray)
                ?: (candidate["rows"] as? JsonArray)
                ?: if (candidate.isEmpty()) JsonArray(emptyList()) else candidate
        } else {
            candidate
        }
        return ApiEnvelope(jsonDecoder.json.decodeFromJsonElement(dataSerializer, normalized))
    }

    override fun serialize(encoder: Encoder, value: ApiEnvelope<T>) {
        val jsonEncoder = encoder as? JsonEncoder
            ?: error("ApiEnvelopeSerializer يدعم JSON فقط")
        val inner = value.data?.let { jsonEncoder.json.encodeToJsonElement(dataSerializer, it) } ?: JsonNull
        jsonEncoder.encodeJsonElement(buildJsonObject { put("data", inner) })
    }
}
