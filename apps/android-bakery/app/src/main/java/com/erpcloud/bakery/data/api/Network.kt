package com.erpcloud.bakery.data.api

import com.erpcloud.bakery.data.offline.SessionStore
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/** حدثُ انتهاء الجلسة (فشل تجديد الرمز) — تسمعُه الواجهة وتفتح شاشة الدخول. */
class SessionEvents {
    private val _expired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val expired: SharedFlow<Unit> = _expired
    fun emitExpired() {
        _expired.tryEmit(Unit)
    }
}

/** الـJson المشترك — يُهمل الحقول غير المعروفة ولا يرسل الافتراضيّات ولا الـnull. */
val AppJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = false
    coerceInputValues = true
}

/**
 * إعادةُ توجيه كل الطلبات إلى الخادم المُعدّ في الإعدادات: المساراتُ كلها نسبيةّة
 * فتُلحق ببادئة `/api/v1`، وهذا المُعترِض يستبدل scheme/host/port فقط.
 */
class HostSelectionInterceptor(private val sessionStore: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val server = parseServer(sessionStore.cached.serverUrl) ?: return chain.proceed(original)
        val rewritten = original.url.newBuilder()
            .scheme(server.first)
            .host(server.second)
            .port(server.third)
            .build()
        return chain.proceed(original.newBuilder().url(rewritten).build())
    }

    companion object {
        /** (scheme, host, port) — null إن كان النصُّ بروتوكولًا غير http/https. */
        fun parseServer(url: String): Triple<String, String, Int>? {
            val text = url.trim()
            if (text.isEmpty()) return null
            val withScheme = if (text.startsWith("http://") || text.startsWith("https://")) text
            else "http://$text"
            return try {
                val parsed = java.net.URI(withScheme)
                val host = parsed.host ?: return null
                val scheme = parsed.scheme ?: "http"
                val port = if (parsed.port > 0) parsed.port else if (scheme == "https") 443 else 80
                Triple(scheme, host, port)
            } catch (_: Exception) {
                null
            }
        }
    }
}

/** إلحاقُ رمز الحمل — لا يُلحق بمساري الدخول والتجديد. */
class AuthInterceptor(private val sessionStore: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val path = request.url.encodedPath
        if (path.endsWith("/auth/login") || path.endsWith("/auth/refresh")) {
            return chain.proceed(request)
        }
        val token = sessionStore.cached.accessToken
        if (token.isEmpty()) return chain.proceed(request)
        return chain.proceed(
            request.newBuilder().header("Authorization", "Bearer $token").build()
        )
    }
}

/**
 * التجديدُ الصامت عند 401 — مرةً واحدةً لكل طلب، بلا تكرارٍ على مسارَي الدخول
 * والتجديد نفسيهما. إن فشل التجديدُ فالجلسةُ منتهية ويُبثُّ الحدث.
 */
class AuthAuthenticator(
    private val sessionStore: SessionStore,
    private val events: SessionEvents,
    private val bareClient: OkHttpClient,
) : Authenticator {

    override fun authenticate(route: okhttp3.Route?, response: Response): Request? {
        val path = response.request.url.encodedPath
        if (path.endsWith("/auth/login") || path.endsWith("/auth/refresh")) return null
        // لا تُكرِّر: إن سبق أن أُعيد المحاولة على الطلب نفسه فتوقّف.
        if (response.request.header("X-Retry-After-Refresh") != null) return null

        synchronized(this) {
            val store = sessionStore.cached
            if (!store.loggedIn) return null

            // رمزٌ أحدثُ وصل من خيطٍ آخر بينما كان هذا الطلب في الطريق؟ أعد به فقط.
            val usedToken = response.request.header("Authorization")?.removePrefix("Bearer ")
            if (usedToken != null && usedToken != store.accessToken) {
                return response.request.newBuilder()
                    .header("Authorization", "Bearer ${store.accessToken}")
                    .header("X-Retry-After-Refresh", "1")
                    .build()
            }

            val refreshed = tryRefresh(store.refreshToken) ?: run {
                kotlinx.coroutines.runBlocking {
                    sessionStore.clearSession()
                }
                events.emitExpired()
                return null
            }
            return response.request.newBuilder()
                .header("Authorization", "Bearer ${refreshed.first}")
                .header("X-Retry-After-Refresh", "1")
                .build()
        }
    }

    /** نداءُ التجديد الخامّ (خارج Retrofit) — يعيد (access, refresh) أو null. */
    private fun tryRefresh(refreshToken: String): Pair<String, String>? {
        if (refreshToken.isEmpty()) return null
        return try {
            val server = HostSelectionInterceptor.parseServer(sessionStore.cached.serverUrl)
                ?: return null
            val url = "${server.first}://${server.second}:${server.third}/api/v1/auth/refresh"
            val body = AppJson.encodeToString(
                RefreshRequest.serializer(),
                RefreshRequest(refreshToken),
            )
            val request = Request.Builder()
                .url(url)
                .post(body.toRequestBody("application/json".toMediaType()))
                .build()
            bareClient.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) return null
                val text = resp.body?.string().orEmpty()
                if (text.isEmpty()) return null
                val envelope = AppJson.decodeFromString(
                    ApiEnvelope.serializer(LoginResponse.serializer()),
                    text,
                )
                val data = envelope.data ?: return null
                kotlinx.coroutines.runBlocking {
                    sessionStore.updateTokens(data.accessToken, data.refreshToken, data.expiresIn)
                }
                Pair(data.accessToken, data.refreshToken)
            }
        } catch (_: Exception) {
            null
        }
    }
}

/** بناءُ عميلِ الشبكة كاملًا — مرةً واحدة في دورة حياة التطبيق. */
class NetworkFactory(
    private val sessionStore: SessionStore,
    private val events: SessionEvents,
    private val snapshotCache: com.erpcloud.bakery.data.offline.SnapshotCache,
) {

    val api: BakeryApi by lazy {
        val bare = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()

        val authed = bare.newBuilder()
            // أوّلًا وبلا استثناء: لقطاتُ عدم الاتصال تغلُفُ كلَّ ما بعدها
            // (إعادة التوجيه، الحمل، حتى تجديد الرمز) — فأيُّ فشلٍ شبكيٍّ
            // يُخدَم من آخرِ قراءةٍ ناجحة.
            .addInterceptor(com.erpcloud.bakery.data.offline.SnapshotCacheInterceptor(snapshotCache))
            .addInterceptor(HostSelectionInterceptor(sessionStore))
            .addInterceptor(AuthInterceptor(sessionStore))
            .authenticator(AuthAuthenticator(sessionStore, events, bare))
            .build()

        Retrofit.Builder()
            // بادئةٌ افتراضيّة — الستضاف والحقيقيّ يُطبَّق في HostSelectionInterceptor،
            // والمساراتُ النسبيّة تُلحق `/api/v1` بها.
            .baseUrl("http://10.0.2.2:3000/api/v1/")
            .client(authed)
            .addConverterFactory(AppJson.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(BakeryApi::class.java)
    }
}
