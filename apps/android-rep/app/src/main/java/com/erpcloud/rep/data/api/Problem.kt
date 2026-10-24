package com.erpcloud.rep.data.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonObject

/**
 * غلافُ الخطأ الرسميّ RFC-9457 — كلّ أخطاء الخادم بهذا الشكل.
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

/** خطأُ HTTP من الخادم — يُعرَّب تلقائيًّا إن كانت رسالةُ الخادم غير عربية. */
class ApiException(
    val problem: ProblemDto,
    val httpStatus: Int,
) : Exception(problem.detail ?: problem.title ?: "HTTP $httpStatus") {

    val userMessage: String
        get() = ErrorsAr.translate(problem, httpStatus)

    val errorCode: String get() = problem.code ?: ""
}

/** الطلبُ لم يصل إلى الخادم (انقطاع شبكة/مهلة) — ليس رفضًا. */
class NetworkException(cause: Throwable) : Exception(cause) {
    val userMessage: String get() = "لم يصل الطلب إلى الخادم — تحقّق من الشبكة وعنوان الخادم"
}

/**
 * غلافُ النجاح المرن: يقبل `{ "data": … }` كما يقبل القيمة الخام مباشرةً (مثل مصفوفة `/parties`).
 */
@Serializable(with = ApiEnvelopeSerializer::class)
data class ApiEnvelope<T>(
    val data: T? = null,
)

class ApiEnvelopeSerializer<T>(
    private val dataSerializer: KSerializer<T>,
) : KSerializer<ApiEnvelope<T>> {
    override val descriptor: SerialDescriptor = dataSerializer.descriptor

    override fun deserialize(decoder: Decoder): ApiEnvelope<T> {
        val jsonDecoder = decoder as? JsonDecoder
            ?: return ApiEnvelope(dataSerializer.deserialize(decoder))
        val element = jsonDecoder.decodeJsonElement()
        if (element is JsonObject && "data" in element) {
            val inner = element["data"]
            if (inner == null || inner is kotlinx.serialization.json.JsonNull) {
                return ApiEnvelope(null)
            }
            return ApiEnvelope(jsonDecoder.json.decodeFromJsonElement(dataSerializer, inner))
        }
        return ApiEnvelope(jsonDecoder.json.decodeFromJsonElement(dataSerializer, element))
    }

    override fun serialize(encoder: Encoder, value: ApiEnvelope<T>) {
        val data = value.data
        if (data != null) {
            dataSerializer.serialize(encoder, data)
        }
    }
}
