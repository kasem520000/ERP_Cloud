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

    // ----------------------------------------------------------- الإشعارات

    @GET("notifications")
    suspend fun notifications(
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
        @Query("filter[read]") read: String? = null,
    ): Response<NotificationListResponse>

    @POST("notifications/{id}/read")
    suspend fun markNotificationRead(@Path("id") id: String): Response<JsonElement>
}
