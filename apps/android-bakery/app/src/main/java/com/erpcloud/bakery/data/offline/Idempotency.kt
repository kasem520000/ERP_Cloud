package com.erpcloud.bakery.data.offline

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.security.SecureRandom

/**
 * مفاتيحُ عدم التكرار — نفسُ مخطّط الويب حرفيًّا (`packages/web-core/src/idempotency.ts`):
 * ‏`<prefix>:<بصمة الحمولة>:<nonce>` بحدٍّ أقصى ١٢٠ حرفًا.
 *
 * والقاعدةُ الحرجة: **النيّةُ الواحدةُ مفتاحٌ واحد** — يُبنى مرّةً عند الإرسال/الحفظ
 * ويُخزَّن مع الجسم في الطابور فتستعمله كلُّ إعادة، ومفتاحٌ جديدٌ لكلّ نقرةٍ يعني
 * مستندًا مكرّرًا عند انقطاع الشبكة.
 */
object Idempotency {

    const val MAX_LENGTH = 120
    private const val NONCE_LENGTH = 16
    private const val FNV_OFFSET = 0x811c9dc5u
    private const val FNV_PRIME = 0x01000193u
    private const val ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    private val random = SecureRandom()

    fun nonce(): String = buildString {
        repeat(NONCE_LENGTH) { append(ALPHANUM[random.nextInt(ALPHANUM.length)]) }
    }

    /** بصمةُ FNV-1a (٣٢ بت) — للتمييز لا للأمان؛ الأمانُ في الفهرس الفريد في القاعدة. */
    fun fnv1a32(text: String): String {
        var hash = FNV_OFFSET
        for (byte in text.toByteArray(Charsets.UTF_8)) {
            hash = hash xor (byte.toInt() and 0xFF).toUInt()
            hash = (hash * FNV_PRIME) and 0xFFFFFFFFu
        }
        return hash.toString(16).padStart(8, '0')
    }

    /** نصٌّ قانونيٌّ للحمولة: المفاتيح مرتّبة (مثل canonicalPayloadText في الويب). */
    fun canonicalText(element: JsonElement): String = canonicalize(element)

    private fun canonicalize(element: JsonElement): String = when (element) {
        is JsonObject -> element.keys.sorted().joinToString(
            separator = ",",
            prefix = "{",
            postfix = "}",
        ) { key -> "\"$key\":" + canonicalize(element.getValue(key)) }
        is JsonArray -> element.joinToString(
            separator = ",",
            prefix = "[",
            postfix = "]",
        ) { canonicalize(it) }
        is JsonPrimitive -> element.toString()
        else -> element.toString()
    }

    /**
     * بناءُ المفتاح — البادئة بنمط `^[a-z0-9][a-z0-9-]*$` كي تُقرأ في السجلّات
     * (rep-document / rep-return / rep-collection).
     */
    fun buildKey(prefix: String, body: JsonObject): String {
        require(prefix.matches(Regex("^[a-z0-9][a-z0-9-]*$"))) { "بادئة مفتاح غير صالحة: $prefix" }
        val key = "$prefix:${fnv1a32(canonicalText(body))}:${nonce()}"
        require(key.length <= MAX_LENGTH) { "مفتاح النيّة أطول من $MAX_LENGTH حرفًا" }
        return key
    }

    /** إضافةُ المفتاح إلى الجسم (نسخةٌ جديدة) — الجسمُ المعاد هو ما يُرسل ويُخزَّن. */
    fun withKey(body: JsonObject, key: String): JsonObject =
        JsonObject(body.toMutableMap().apply { put("idempotencyKey", JsonPrimitive(key)) })
}
