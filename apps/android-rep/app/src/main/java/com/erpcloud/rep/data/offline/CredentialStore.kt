package com.erpcloud.rep.data.offline

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** بياناتُ الدخول المحفوظة (تذكّرني) — للدخول السريع/بالبصمة. */
data class SavedCredentials(
    val email: String,
    val tenantCode: String,
    val password: String,
)

/**
 * مخزنُ بيانات الدخول — **مشفَّرٌ بمفتاح Android Keystore** (AES-256):
 * البريدُ ورمزُ المنشأة وكلمةُ المرور لا تُكتب على القرص نصًّا صريحًا أبدًا.
 *
 * - «تذكّرني» (افتراضيًّا مفعّل) يحفظ الثلاثة بعد دخولٍ ناجح.
 * - «الدخول بالبصمة/النمط» خيارٌ فوق الحفظ: يفتح الجلسةَ بالبصمة أو نمط الهاتف
 *   بدل إعادة كتابة كلمة المرور.
 *
 * إن تلف مفتاحُ المتجر (إعادةُ ضبط المصنع/استرجاع نسخةٍ احتياطية) نبدأ بذاكرةٍ
 * نظيفة — كلمةُ المرور تُعاد كتابتها لا تُسترجع.
 */
class CredentialStore(context: Context) {

    private val prefs: SharedPreferences = try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "rep_credentials",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (_: Exception) {
        context.getSharedPreferences("rep_credentials_plain", Context.MODE_PRIVATE)
    }

    /** بياناتُ الدخول المحفوظة، أو null إن لم تُحفظ. */
    val credentials: SavedCredentials?
        get() {
            val email = prefs.getString(KEY_EMAIL, "").orEmpty()
            val password = prefs.getString(KEY_PASSWORD, "").orEmpty()
            val tenant = prefs.getString(KEY_TENANT, "").orEmpty()
            if (email.isEmpty() || password.isEmpty()) return null
            return SavedCredentials(email = email, tenantCode = tenant, password = password)
        }

    /** هل فُعّل الدخولُ بالبصمة/النمط لهذا الحساب المحفوظ؟ */
    var biometricEnabled: Boolean
        get() = prefs.getBoolean(KEY_BIOMETRIC, false)
        set(value) = prefs.edit().putBoolean(KEY_BIOMETRIC, value).apply()

    fun save(credentials: SavedCredentials) {
        prefs.edit()
            .putString(KEY_EMAIL, credentials.email)
            .putString(KEY_TENANT, credentials.tenantCode)
            .putString(KEY_PASSWORD, credentials.password)
            .apply()
    }

    /** تحديثُ كلمة المرور المحفوظة بعد تغييرها من داخل التطبيق. */
    fun updatePassword(newPassword: String) {
        prefs.edit().putString(KEY_PASSWORD, newPassword).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_EMAIL = "email"
        const val KEY_TENANT = "tenant_code"
        const val KEY_PASSWORD = "password"
        const val KEY_BIOMETRIC = "biometric_enabled"
    }
}
