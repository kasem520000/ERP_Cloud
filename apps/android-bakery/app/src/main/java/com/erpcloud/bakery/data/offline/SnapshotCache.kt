package com.erpcloud.bakery.data.offline

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import java.io.File
import java.security.MessageDigest
import java.util.Locale

/**
 * حالةُ الاتصال بالخادم — تُحدَّث من [SnapshotCacheInterceptor] عند كل نداء:
 * نداءٌ وصل فعلًا ⇒ متّصل؛ وفشل بالشبكة ⇒ غير متّصل (حتى لو كانت شبكةُ الجهاز
 * قائمةً — الخادمُ هو الحكم). الواجهةُ تعرضُ شريطًا دائمًا أعلى الشاشة حينها.
 */
object ServerConnectivity {
    private val _offline = MutableStateFlow(false)
    val offline: StateFlow<Boolean> = _offline

    fun markOffline() {
        _offline.value = true
    }

    fun markOnline() {
        if (_offline.value) _offline.value = false
    }
}

/**
 * مخزنُ اللقطات المحليّ — آخرُ استجابةٍ ناجحةٍ لكلّ مسارِ قراءةٍ (GET)، محفوظةٌ
 * كملفٍّ معزولٍ برمز المنشأة والمستخدم والمسار الكامل فلا تتسرّبُ بياناتُ منشأةٍ
 * إلى أخرى عند تبديل الحسابات على الجهاز نفسه، وتُمسحُ عند تسجيل الخروج.
 */
class SnapshotCache(
    context: Context,
    private val sessionStore: SessionStore? = null,
) {
    private val dir = File(context.filesDir, "snapshots").apply { mkdirs() }

    private fun fileFor(url: HttpUrl): File {
        val sess = sessionStore?.cached
        val userKey = jwtSubject(sess?.accessToken.orEmpty())
        val scope = "${sess?.tenantCode.orEmpty().lowercase(Locale.US)}|$userKey|$url"
        val digest = MessageDigest.getInstance("SHA-256").digest(scope.toByteArray(Charsets.UTF_8))
        val name = digest.joinToString("") { String.format(Locale.US, "%02x", it) }
        return File(dir, name)
    }

    private fun jwtSubject(token: String): String = runCatching {
        val parts = token.split('.')
        if (parts.size < 2) {
            ""
        } else {
            val decoded = String(
                android.util.Base64.decode(parts[1], android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP),
                Charsets.UTF_8,
            )
            Regex("\"sub\"\\s*:\\s*\"([^\"]+)\"").find(decoded)?.groupValues?.getOrNull(1).orEmpty()
        }
    }.getOrDefault("")

    fun save(url: HttpUrl, bytes: ByteArray) {
        try {
            if (!dir.exists()) dir.mkdirs()
            fileFor(url).writeBytes(bytes)
        } catch (_: Exception) {
            // التخزينُ ممتازٌ لا ضروريٌّ — الفشلُ هنا لا يُفسدُ النداءَ نفسه.
        }
    }

    fun read(url: HttpUrl): ByteArray? = try {
        val f = fileFor(url)
        if (f.exists()) f.readBytes() else null
    } catch (_: Exception) {
        null
    }

    fun clear() {
        try {
            dir.listFiles()?.forEach { it.delete() }
        } catch (_: Exception) {
        }
    }
}

/**
 * مُعترِضُ اللقطات — قلبُ وضع عدم الاتصال:
 *
 * 1. **كلُّ GETٍ ناجحٍ يُحفَظ** (≤ ٨ ميغابايت، JSON) — فتصبحُ آخرُ قراءةٍ لكلّ
 *    شاشةٍ متاحةً دائمًا ضمن نطاق المنشأة الحاليّة.
 * 2. **كلُّ فشلٍ بشبكةٍ (IOException) يُخدَم من اللقطة** بردٍّ ناجحٍ مكافئ.
 * 3. الكتاباتُ (POST/PUT/PATCH/DELETE) لا تُخزَّن ولا تُزيَّف — فشلُها يظهرُ
 *    بصدقٍ «لم يصل الطلب».
 */
class SnapshotCacheInterceptor(private val cache: SnapshotCache) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        return try {
            val response = chain.proceed(request)
            ServerConnectivity.markOnline()
            if (request.method == "GET" && response.isSuccessful) {
                cacheIfPossible(request.url, response)
            }
            response
        } catch (error: java.io.IOException) {
            ServerConnectivity.markOffline()
            if (request.method != "GET") throw error
            val snapshot = cache.read(request.url) ?: throw error
            responseFromSnapshot(request, snapshot)
        }
    }

    private fun cacheIfPossible(url: HttpUrl, response: Response) {
        try {
            val type = response.header("Content-Type").orEmpty()
            if (type.isNotBlank() && !type.contains("json", ignoreCase = true)) return
            val peek = response.peekBody(MAX_BYTES)
            val bytes = peek.bytes()
            if (bytes.isNotEmpty()) cache.save(url, bytes)
        } catch (_: Exception) {
            // اللقطةُ تحسينٌ — لا تُفسدِ الاستجابةَ الأصلية.
        }
    }

    private fun responseFromSnapshot(request: okhttp3.Request, bytes: ByteArray): Response =
        Response.Builder()
            .request(request)
            .protocol(Protocol.HTTP_1_1)
            .code(200)
            .message("offline snapshot")
            .body(bytes.toResponseBody("application/json".toMediaType()))
            .build()

    private companion object {
        const val MAX_BYTES = 8L * 1024 * 1024
    }
}
