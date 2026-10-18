package com.erpcloud.rep.ui

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.erpcloud.rep.data.ActionResult
import com.erpcloud.rep.data.RepRepository
import com.erpcloud.rep.data.api.ApiException
import com.erpcloud.rep.data.api.ClosingRequest
import com.erpcloud.rep.data.api.MeResponse
import com.erpcloud.rep.data.api.PartyDto
import com.erpcloud.rep.data.api.PrintViewDto
import com.erpcloud.rep.data.api.ReceiptRequest
import com.erpcloud.rep.data.api.RepWorkspace
import com.erpcloud.rep.data.offline.Idempotency
import com.erpcloud.rep.data.offline.QueueOperation
import com.erpcloud.rep.data.offline.QueueRecord
import com.erpcloud.rep.data.offline.SessionState
import com.erpcloud.rep.ui.components.Notice
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import java.io.IOException

/** حالةُ الواجهةِ الواحدةُ المشتركة. */
data class UiState(
    val sessionLoaded: Boolean = false,
    val session: SessionState = SessionState(),
    val me: MeResponse? = null,
    val workspace: RepWorkspace? = null,
    val parties: List<PartyDto> = emptyList(),
    val queue: List<QueueRecord> = emptyList(),
    val loadingWorkspace: Boolean = false,
    val workspaceError: String? = null,
    val online: Boolean = true,
) {
    fun can(permission: String): Boolean = me?.can(permission) == true

    companion object {
        /** أسبابُ منع حفظ الإجراءين غير القابلَين للطابور — كما قيست في شاشة الويب. */
        const val OFFLINE_RECEIPT_REASON =
            "تأكيدُ الاستلام لا يُحفظ دون اتصال: فمساره لا يحمل مفتاحَ عدم تكرار، وإعادةُ إرساله تُرفض 409 " +
                "فتظهر نيّةٌ ناجحةٌ للمندوب خطأً. والبضاعةُ أمامك: أكِّد استلامَها لحظةَ عودة الشبكة."
        const val OFFLINE_CLOSING_REASON =
            "إغلاقُ الوردية لا يُحفظ دون اتصال: فمساره لا يحمل مفتاحَ عدم تكرار، والخادمُ لا يرفض إعادةَ الإرسال " +
                "ما دام الأمرُ بانتظار الإقفال — فإعادةٌ عمياء تعيد كتابةَ إعلان الجرد الذي يترتّب عليه اعتمادُ المحاسب. " +
                "أرسله لحظةَ عودة الشبكة وأنت تنظر إلى السيارة."
    }
}

/** نتيجةُ إرسال نيّةٍ + (المفتاح، بصمةُ الجسم) — النيّةُ الواحدةُ مفتاحٌ واحد ما لم تتغيّر المسودة. */
data class SubmitOutcome(val result: ActionResult, val intent: Pair<String, String>?)

/**
 * نموذجُ العرضِ الواحد — الحمولةُ كلُّها من `GET /van-sales/me`، والإشعارُ عابرٌ،
 * والقاعدةُ: بعد أيّ نجاحٍ تُعاد قراءةُ المساحة (لا أرقامَ تُحسب في العميل).
 */
class AppViewModel(application: Application) : AndroidViewModel(application) {

    private val container get() = (application as com.erpcloud.rep.RepApp).container
    private val repo: RepRepository get() = container.repository

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState

    private val _notice = MutableStateFlow<Notice?>(null)
    val notice: StateFlow<Notice?> = _notice

    private var lastLoggedIn: Boolean = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    init {
        // الجلسة: أوّلُ قراءةٍ تُعلم أنّ التخزين جاهز (شاشةُ الانتظار)، ثم كلُّ تغيير.
        viewModelScope.launch {
            container.sessionStore.state.collect { session ->
                val becameLoggedIn = session.loggedIn && !lastLoggedIn
                lastLoggedIn = session.loggedIn
                _uiState.update { it.copy(session = session, sessionLoaded = true) }
                if (becameLoggedIn) bootstrap()
            }
        }
        // الطابور: حالةٌ حيّةٌ للشاشة.
        viewModelScope.launch {
            container.queueStore.records.collect { records ->
                _uiState.update { it.copy(queue = records) }
            }
        }
        // انتهاءُ الجلسة (فشل تجديد الرمز).
        viewModelScope.launch {
            container.sessionEvents.expired.collect {
                _notice.value = Notice.warn("انتهت الجلسة — سجّل الدخول من جديد.")
            }
        }
        registerOnlineWatcher()
    }

    // ------------------------------------------------------------ الشبكة

    private fun registerOnlineWatcher() {
        val manager =
            getApplication<Application>().getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return
        fun currentOnline(): Boolean = manager.activeNetwork != null
        _uiState.update { it.copy(online = currentOnline()) }
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                _uiState.update { it.copy(online = currentOnline()) }
            }

            override fun onLost(network: Network) {
                _uiState.update { it.copy(online = currentOnline()) }
            }
        }
        networkCallback = callback
        try {
            manager.registerNetworkCallback(
                NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build(),
                callback,
            )
        } catch (_: Exception) {
            // بعضُ الأجهزة بلا شبكةٍ أصلًا — يبقى الوضعُ الأخير.
        }
    }

    override fun onCleared() {
        val manager =
            getApplication<Application>().getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        networkCallback?.let { callback ->
            try {
                manager?.unregisterNetworkCallback(callback)
            } catch (_: Exception) {
                // تجاهُل.
            }
        }
        super.onCleared()
    }

    // ------------------------------------------------------------ الدخول والجلسة

    /** يُرجعُ نصَّ الخطأ أو null عند النجاح. */
    suspend fun login(server: String, email: String, password: String, tenantCode: String, mfaCode: String): String? {
        return try {
            repo.login(server, email, password, tenantCode, mfaCode)
            null
        } catch (error: ApiException) {
            error.userMessage
        } catch (error: IOException) {
            "تعذّر الوصول إلى الخادم — تحقّق من العنوان والشبكة"
        } catch (error: Exception) {
            error.message ?: "تعذّر تسجيل الدخول"
        }
    }

    fun logout() {
        viewModelScope.launch {
            repo.logout()
        }
    }

    /** بعد الدخول: الهويّةُ ثمّ المساحةُ والعملاء (كلٌّ على حدة — فشلُ أحدها لا يُسقط البقية). */
    fun bootstrap() {
        viewModelScope.launch {
            try {
                val me = repo.me()
                _uiState.update { it.copy(me = me) }
                if (!me.can("van_sales.view")) {
                    _notice.value = Notice.warn(
                        "حسابُك لا يحمل إذنَ van_sales.view — عناصرُ التوزيع لن تفتح لك حتى يمنحَه المحاسب."
                    )
                }
            } catch (error: Exception) {
                _notice.value = Notice.danger(friendly(error))
            }
            refreshWorkspace()
            loadParties()
        }
    }

    fun refreshAll() {
        refreshWorkspace()
        loadParties()
    }

    fun refreshWorkspace() {
        viewModelScope.launch {
            _uiState.update { it.copy(loadingWorkspace = true, workspaceError = null) }
            try {
                val workspace = repo.workspace()
                _uiState.update { it.copy(workspace = workspace, loadingWorkspace = false) }
            } catch (error: Exception) {
                _uiState.update {
                    it.copy(loadingWorkspace = false, workspaceError = friendly(error))
                }
            }
        }
    }

    private fun loadParties() {
        viewModelScope.launch {
            try {
                val parties = repo.parties()
                _uiState.update { it.copy(parties = parties) }
            } catch (_: Exception) {
                // بطاقاتُ العملاء أحسنُ جهدٍ — شاشةُ البيع تعمل بالاسم النقديّ بدلها.
            }
        }
    }

    private fun friendly(error: Exception): String = when (error) {
        is ApiException -> error.userMessage
        is IOException -> "تعذّر الوصول إلى الخادم — تحقّق من الشبكة وعنوان الخادم"
        else -> error.message ?: "خطأٌ غير متوقّع"
    }

    // ------------------------------------------------------------ الإجراءات

    /**
     * إرسالُ نيّةٍ قابلةٍ للحفظ (بيع/مرتجع/تحصيل). المفتاحُ المُمرَّر (مع بصمةِ جسمه)
     * يُستعمل إن كانت النيّةُ نفسَها — المسودة لم تتغيّر — وإلا يُبنى مفتاحٌ جديد،
     * فلا مستندَ مكرّرًا ولو أُعيد الإرسال، ولا نيّةٍ ثانيةٍ تُبتلع بصمت.
     */
    fun submitIntent(
        operation: QueueOperation,
        targetId: String?,
        request: Any,
        currentIntent: Pair<String, String>?,
        onDone: (SubmitOutcome) -> Unit,
    ) {
        viewModelScope.launch {
            try {
                val body = repo.encodeBody(request)
                val fingerprint = Idempotency.fnv1a32(Idempotency.canonicalText(body))
                val existingKey =
                    if (currentIntent != null && currentIntent.second == fingerprint) currentIntent.first else null
                val keyed = repo.withIdempotencyKey(operation, body, existingKey)
                val key = (keyed["idempotencyKey"] as? JsonPrimitive)?.content
                val result = repo.submitQueueable(operation, targetId, keyed, _uiState.value.online)
                if (result is ActionResult.Synced || result is ActionResult.StoredOffline) {
                    refreshWorkspace()
                }
                onDone(SubmitOutcome(result, key?.let { it to fingerprint }))
            } catch (error: Exception) {
                // لا تُعلِّق الشاشةَ على زرِّ إرسالٍ يدور إلى الأبد.
                onDone(SubmitOutcome(ActionResult.Refused(friendly(error)), null))
            }
        }
    }

    /** تأكيدُ استلام التوريد — **لا يُحفظ دون اتصال** (بسببٍ مقيسٍ معروض). */
    fun confirmReceipt(loadOrderId: String, request: ReceiptRequest, onDone: (ActionResult) -> Unit) {
        if (!_uiState.value.online) {
            onDone(ActionResult.Blocked(listOf(UiState.OFFLINE_RECEIPT_REASON)))
            return
        }
        viewModelScope.launch {
            val result = repo.confirmReceipt(loadOrderId, repo.encodeBody(request))
            if (result is ActionResult.Synced) refreshWorkspace()
            onDone(result)
        }
    }

    /** إغلاقُ الوردية — **لا يُحفظ دون اتصال** كذلك. */
    fun submitClosing(loadOrderId: String, request: ClosingRequest, onDone: (ActionResult) -> Unit) {
        if (!_uiState.value.online) {
            onDone(ActionResult.Blocked(listOf(UiState.OFFLINE_CLOSING_REASON)))
            return
        }
        viewModelScope.launch {
            val result = repo.submitClosing(loadOrderId, repo.encodeBody(request))
            if (result is ActionResult.Synced) refreshWorkspace()
            onDone(result)
        }
    }

    /** إعادةُ النيّات المعلّقة بترتيب إدخالها — وعودتها لمسارها الرسميّ نفسه. */
    fun replayQueue() {
        viewModelScope.launch {
            val plan = container.queueStore.syncPlan()
            if (plan.isEmpty()) {
                _notice.value = Notice.warn("لا نيّاتٍ معلّقة في الطابور.")
                return@launch
            }
            if (!_uiState.value.online) {
                _notice.value = Notice.warn("لا شبكة بعد — فالطابورُ ينتظر عودة الاتصال ولا يُرسل عمياءً.")
                return@launch
            }
            val sent = repo.replayQueue { _, _ -> }
            _notice.value = when {
                sent > 0 -> Notice.ok("وصلت $sent نيّةً إلى الخادم.")
                else -> Notice.warn("لم تصل نيّةٌ جديدة — راجع حالاتِ الطابور ورسائلِ الرفض.")
            }
            refreshWorkspace()
        }
    }

    fun clearSynced() {
        viewModelScope.launch {
            repo.clearSynced()
        }
    }

    // ------------------------------------------------------------ الطباعة والإعدادات

    /** قراءةُ نسختي الطباعة — null عند الخطأ (الرسالةُ في الإشعار). */
    suspend fun printViewOrNull(documentId: String): PrintViewDto? = try {
        repo.printView(documentId)
    } catch (error: Exception) {
        _notice.value = Notice.danger(friendly(error))
        null
    }

    fun setPrinter(mac: String, widthDots: Int) {
        viewModelScope.launch {
            container.sessionStore.setPrinter(mac, widthDots)
            _notice.value = Notice.ok("حُفظت الطابعة.")
        }
    }

    fun consumeNotice() {
        _notice.value = null
    }
}
