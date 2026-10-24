package com.erpcloud.bakery.data.api

import kotlinx.serialization.Serializable

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

/** خطأُ HTTP من الخادم — نُصُّه العربيُّ جاهزٌ للعرض كما هو. */
class ApiException(
    val problem: ProblemDto,
    val httpStatus: Int,
) : Exception(problem.detail ?: problem.title ?: "HTTP $httpStatus") {

    /** النصُّ المعروض للمندوب: ترجمةُ الرمز عربيًّا إن وُجدت، وإلا تفاصيلُ ٤xx
     *  تُقال كما هي، وأخطاء ٥xx يكفي عنوانُها — كما يفعل الويب (`errors-ar.ts`). */
    val userMessage: String
        get() {
            ErrorsAr.translate(problem.code)?.let { return it }
            if (httpStatus < 500) {
                val detail = problem.detail?.trim().orEmpty()
                if (detail.isNotEmpty()) return detail
            }
            val title = problem.title?.trim().orEmpty()
            if (title.isNotEmpty()) return title
            return "تعذّر إكمال الطلب ($httpStatus)"
        }

    val errorCode: String get() = problem.code ?: ""
}

/** الطلبُ لم يصل إلى الخادم (انقطاع شبكة/مهلة) — ليس رفضًا. */
class NetworkException(cause: Throwable) : Exception(cause) {
    val userMessage: String get() = "لم يصل الطلب إلى الخادم — تحقّق من الشبكة وعنوان الخادم"
}

/** غلافُ النجاح `{ "data": … }` — المستعمل في أغلب المسارات (ما عدا /parties). */
@Serializable
data class ApiEnvelope<T>(
    val data: T? = null,
)
