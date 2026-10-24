package com.erpcloud.bakery.data.offline

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
 * إن تلف مفتاحُ المتجر (إعادةُ ضبط المصنع/استرجاع نسخةٍ احتياطية) نمسحُ الملفَّ
 * التالف ونبدأ بذاكرةٍ مشفّرةٍ نظيفة — ولا نسقطُ إلى تخزينٍ نصّيٍّ صريحٍ أبدًا.
 */
class CredentialStore(context: Context) {

    private val prefs: SharedPreferences? = openEncryptedOrReset(context)

    /** بياناتُ الدخول المحفوظة، أو null إن لم تُحفظ أو تعذّر التشفير. */
    val credentials: SavedCredentials?
        get() {
            val store = prefs ?: return null
            val email = store.getString(KEY_EMAIL, "").orEmpty()
            val password = store.getString(KEY_PASSWORD, "").orEmpty()
            val tenant = store.getString(KEY_TENANT, "").orEmpty()
            if (email.isEmpty() || password.isEmpty()) return null
            return SavedCredentials(email = email, tenantCode = tenant, password = password)
        }

    /** هل فُعّل الدخولُ بالبصمة/النمط لهذا الحساب المحفوظ؟ */
    var biometricEnabled: Boolean
        get() = prefs?.getBoolean(KEY_BIOMETRIC, false) ?: false
        set(value) {
            prefs?.edit()?.putBoolean(KEY_BIOMETRIC, value)?.apply()
        }

    fun save(credentials: SavedCredentials) {
        prefs?.edit()
            ?.putString(KEY_EMAIL, credentials.email)
            ?.putString(KEY_TENANT, credentials.tenantCode)
            ?.putString(KEY_PASSWORD, credentials.password)
            ?.apply()
    }

    /** تحديثُ كلمة المرور المحفوظة بعد تغييرها من داخل التطبيق. */
    fun updatePassword(newPassword: String) {
        prefs?.edit()?.putString(KEY_PASSWORD, newPassword)?.apply()
    }

    fun clear() {
        prefs?.edit()?.clear()?.apply()
    }

    private companion object {
        const val PREFS_NAME = "bakery_credentials"
        const val LEGACY_PLAIN_NAME = "rep_credentials_plain"
        const val KEY_EMAIL = "email"
        const val KEY_TENANT = "tenant_code"
        const val KEY_PASSWORD = "password"
        const val KEY_BIOMETRIC = "biometric_enabled"

        fun openEncryptedOrReset(context: Context): SharedPreferences? {
            // إزالةُ أيّ ملفٍّ نصّيٍّ قديم إن وُجد.
            runCatching { context.deleteSharedPreferences(LEGACY_PLAIN_NAME) }
            fun createOnce(): SharedPreferences {
                val masterKey = MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
                return EncryptedSharedPreferences.create(
                    context,
                    PREFS_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                )
            }
            return try {
                createOnce()
            } catch (_: Exception) {
                runCatching { context.deleteSharedPreferences(PREFS_NAME) }
                runCatching { createOnce() }.getOrNull()
            }
        }
    }
}
