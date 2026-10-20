package com.erpcloud.rep.data.offline

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.erpcloud.rep.data.api.LoginResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.util.UUID

private val Context.sessionDataStore: DataStore<Preferences> by preferencesDataStore(name = "rep_session")

/** حالةُ الجلسة كما تُقرأ من التخزين المحليّ. */
data class SessionState(
    val loggedIn: Boolean = false,
    val accessToken: String = "",
    val refreshToken: String = "",
    val tenantCode: String = "",
    val expiresAt: Long = 0,
    val serverUrl: String = DEFAULT_SERVER_URL,
    val printerMac: String = "",
    val printerWidthDots: Int = 576,
    val deviceId: String = "",
) {
    companion object {
        /** عنوانُ الخادم الافتراضيّ: جهازُ المضيف عند التشغيل في محاكي أندرويد. */
        const val DEFAULT_SERVER_URL = "http://10.0.2.2:3000"
    }
}

/**
 * تخزينُ الجلسة والإعدادات (DataStore) — مع نسخةٍ متطايرةٍ تقرؤها المُعترِضات
 * على خيوط الشبكة بلا تعليق.
 */
class SessionStore(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private object Keys {
        val ACCESS = stringPreferencesKey("access_token")
        val REFRESH = stringPreferencesKey("refresh_token")
        val TENANT = stringPreferencesKey("tenant_code")
        val EXPIRES = longPreferencesKey("expires_at")
        val SERVER = stringPreferencesKey("server_url")
        val PRINTER_MAC = stringPreferencesKey("printer_mac")
        val PRINTER_WIDTH = intPreferencesKey("printer_width")
        val DEVICE = stringPreferencesKey("device_id")
    }

    /** نسخةٌ متطايرةٌ — تُحدَّث مع كل كتابة. */
    @Volatile
    var cached: SessionState = SessionState()
        private set

    /** التدفّقُ الرسميّ للحالة (للواجهة). */
    val state: Flow<SessionState> = context.sessionDataStore.data.map(::readState)

    init {
        // إبقاءُ النسخة المتطايرة مواكبةً، وإنشاءُ وسمِ الجهاز مرّةً واحدة.
        scope.launch {
            ensureDeviceId()
            cached = readState(context.sessionDataStore.data.first())
        }
        scope.launch { state.collect { cached = it } }
    }

    private fun readState(prefs: Preferences): SessionState {
        val access = prefs[Keys.ACCESS].orEmpty()
        return SessionState(
            loggedIn = access.isNotEmpty(),
            accessToken = access,
            refreshToken = prefs[Keys.REFRESH].orEmpty(),
            tenantCode = prefs[Keys.TENANT].orEmpty(),
            expiresAt = prefs[Keys.EXPIRES] ?: 0L,
            serverUrl = prefs[Keys.SERVER] ?: SessionState.DEFAULT_SERVER_URL,
            printerMac = prefs[Keys.PRINTER_MAC].orEmpty(),
            printerWidthDots = prefs[Keys.PRINTER_WIDTH] ?: 576,
            deviceId = prefs[Keys.DEVICE].orEmpty(),
        )
    }

    private suspend fun ensureDeviceId() {
        context.sessionDataStore.edit { prefs ->
            if (prefs[Keys.DEVICE].isNullOrEmpty()) {
                prefs[Keys.DEVICE] = UUID.randomUUID().toString()
            }
        }
    }

    suspend fun saveLogin(response: LoginResponse, tenantCode: String) {
        context.sessionDataStore.edit { prefs ->
            prefs[Keys.ACCESS] = response.accessToken
            prefs[Keys.REFRESH] = response.refreshToken
            prefs[Keys.TENANT] = tenantCode
            prefs[Keys.EXPIRES] = System.currentTimeMillis() + response.expiresIn * 1000L
        }
        cached = readState(context.sessionDataStore.data.first())
    }

    suspend fun updateTokens(access: String, refresh: String, expiresIn: Int) {
        context.sessionDataStore.edit { prefs ->
            prefs[Keys.ACCESS] = access
            prefs[Keys.REFRESH] = refresh
            prefs[Keys.EXPIRES] = System.currentTimeMillis() + expiresIn * 1000L
        }
        cached = readState(context.sessionDataStore.data.first())
    }

    suspend fun setServerUrl(url: String) {
        context.sessionDataStore.edit { it[Keys.SERVER] = url.trim().trimEnd('/') }
        cached = readState(context.sessionDataStore.data.first())
    }

    suspend fun setPrinter(mac: String, widthDots: Int) {
        context.sessionDataStore.edit { prefs ->
            prefs[Keys.PRINTER_MAC] = mac
            prefs[Keys.PRINTER_WIDTH] = widthDots
        }
        cached = readState(context.sessionDataStore.data.first())
    }

    suspend fun clearSession() {
        context.sessionDataStore.edit { prefs ->
            prefs.remove(Keys.ACCESS)
            prefs.remove(Keys.REFRESH)
            prefs.remove(Keys.TENANT)
            prefs.remove(Keys.EXPIRES)
        }
        cached = readState(context.sessionDataStore.data.first())
    }
}
