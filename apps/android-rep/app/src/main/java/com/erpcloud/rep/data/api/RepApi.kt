package com.erpcloud.rep.data.api

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Url

/**
 * واجهةُ الشبكة — المساراتُ الاثنا عشر الرسميّةُ لتطبيق المندوب فقط
 * (docs/ANDROID_REP_APP_API_REFERENCE.md §٢).
 *
 * ملاحظاتٌ مقصودة:
 * - كلُّ المسارات **نسبيةّة بلا شرطةٍ أمامية** كي تُلحق ببادئة `/api/v1` من baseUrl
 *   (الخادم المُعاد توجيهه يُطبَّق في HostSelectionInterceptor).
 * - ردودُ الإجراءات (لوحة الخطّ) لا تُفكّك — يُكتفى بالحالة 2xx ثم إعادة قراءة
 *   `GET /van-sales/me`؛ لذا نوعُها JsonElement.
 * - `parties` ترجع مصفوفةً خامًا بلا غلاف data — لذا نوعها List مباشرة.
 * - `postQueue` للمسار المُخزَّن في الطابور (نسبيّ أيضًا) — نيّةٌ تُعاد إلى مسارها الرسميّ.
 */
interface RepApi {

    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): Response<ApiEnvelope<LoginResponse>>

    @POST("auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): Response<ApiEnvelope<LoginResponse>>

    @POST("auth/logout")
    suspend fun logout(): Response<Unit>

    @GET("me")
    suspend fun me(): Response<ApiEnvelope<MeResponse>>

    @GET("van-sales/me")
    suspend fun workspace(): Response<ApiEnvelope<RepWorkspace>>

    @GET("parties")
    suspend fun parties(@Query("kind") kind: String = "customer"): Response<List<PartyDto>>

    @POST("van-sales/documents")
    suspend fun createDocument(@Body body: JsonObject): Response<JsonElement>

    @POST("van-sales/documents/{id}/returns")
    suspend fun createReturn(
        @Path("id") documentId: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    @POST("van-sales/collections")
    suspend fun collect(@Body body: JsonObject): Response<JsonElement>

    @POST("van-sales/load-orders/{id}/confirm-receipt")
    suspend fun confirmReceipt(
        @Path("id") loadOrderId: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    @POST("van-sales/load-orders/{id}/submit-closing")
    suspend fun submitClosing(
        @Path("id") loadOrderId: String,
        @Body body: JsonObject,
    ): Response<JsonElement>

    @GET("van-sales/documents/{id}/print-view")
    suspend fun printView(
        @Path("id") documentId: String,
        @Query("copies") copies: Int = 2,
    ): Response<ApiEnvelope<PrintViewDto>>

    /** إعادةُ نيّةٍ محفوظة إلى مسارها الرسميّ — المسارُ نسبيٌّ بلا شرطةٍ أماميةّة. */
    @POST
    suspend fun postQueue(@Url relativePath: String, @Body body: JsonObject): Response<JsonElement>
}
