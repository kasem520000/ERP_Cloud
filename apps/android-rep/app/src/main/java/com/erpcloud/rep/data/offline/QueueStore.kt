package com.erpcloud.rep.data.offline

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import java.io.File
import java.util.UUID

/** عمليّاتُ الطابور — نفسُ تصنيف شاشة الويب (`apps/bakery/lib/rep-queue.ts`). */
enum class QueueOperation(val labelAr: String, val keyPrefix: String) {
    DOCUMENT("مستند بيع", "rep-document"),
    RETURN("مرتجع عميل", "rep-return"),
    COLLECTION("تحصيل من عميل", "rep-collection"),
    ;

    /** المسارُ النسبيّ (بلا `/api/v1` وبلا شرطةٍ أماميّة — يُلحق بالبادئة). */
    fun endpoint(targetId: String? = null): String = when (this) {
        DOCUMENT -> "van-sales/documents"
        RETURN -> "van-sales/documents/$targetId/returns"
        COLLECTION -> "van-sales/collections"
    }
}

/** حالاتُ النيّة المحفوظة — `pending` لم تصل، `synced` وصلت، `refused` رفضها الخادم. */
enum class QueueStatus { PENDING, SYNCED, REFUSED }

@Serializable
data class QueueRecord(
    val offlineId: String = UUID.randomUUID().toString(),
    val operation: String,
    val endpoint: String,
    /** الجسمُ كما أُرسل — بمفتاح عدم التكرار داخلَه فتستعمله كلُّ إعادة. */
    val body: JsonObject,
    val idempotencyKey: String,
    val label: String,
    val status: String = QueueStatus.PENDING.name,
    val attempts: Int = 0,
    val sequenceNo: Int,
    /** طابعٌ زمنيٌّ ثابتُ الشكل (بلا java.time — فالحدّ الأدنى 24 لا يحملها بلا desugaring). */
    val createdAt: String = java.text.SimpleDateFormat(
        "yyyy-MM-dd HH:mm:ss", java.util.Locale.US
    ).format(java.util.Date()),
    val deviceId: String = "",
    val lastStatusCode: Int? = null,
    val lastErrorCode: String? = null,
    val lastMessage: String = "",
) {
    val op: QueueOperation? get() = QueueOperation.entries.firstOrNull { it.name == operation }
    val queueStatus: QueueStatus get() = QueueStatus.entries.firstOrNull { it.name == status } ?: QueueStatus.PENDING
}

/**
 * طابورُ النيّات دون اتصال — ملفُّ JSON واحدٌ في تخزين التطبيق الخاصّ، كتابةٌ ذرّيّة
 * (مؤقّت + إعادة تسمية)، وحالةٌ حيّةٌ للشاشة. لا Room ولا مزودٍ آخر: النيّاتُ قليلةٌ
 * وصغيرةٌ، والملفُّ أصدقُ شاهدٍ عند إغلاق التطبيق.
 */
class QueueStore(context: Context) {

    private val file = File(context.filesDir, "offline_queue.json")
    private val mutex = Mutex()
    private val _records = MutableStateFlow<List<QueueRecord>>(emptyList())
    val records: StateFlow<List<QueueRecord>> = _records

    private val json = kotlinx.serialization.json.Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    init {
        _records.value = load()
    }

    private fun load(): List<QueueRecord> = try {
        if (file.exists()) {
            json.decodeFromString(ListSerializer(QueueRecord.serializer()), file.readText())
        } else {
            emptyList()
        }
    } catch (_: Exception) {
        // ملفٌّ تالفٌ لا يُسقط التطبيق — يبدأ فارغًا ويُقال ذلك في السجلّ.
        emptyList()
    }

    private suspend fun persist(list: List<QueueRecord>) = withContext(Dispatchers.IO) {
        val tmp = File(file.parentFile, "offline_queue.json.tmp")
        tmp.writeText(json.encodeToString(ListSerializer(QueueRecord.serializer()), list))
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
        _records.value = list
    }

    suspend fun add(record: QueueRecord): Unit = mutex.withLock {
        persist(_records.value + record)
    }

    suspend fun update(offlineId: String, mutate: (QueueRecord) -> QueueRecord): Unit = mutex.withLock {
        persist(_records.value.map { if (it.offlineId == offlineId) mutate(it) else it })
    }

    suspend fun removeSynced(): Unit = mutex.withLock {
        persist(_records.value.filter { it.queueStatus != QueueStatus.SYNCED })
    }

    suspend fun nextSequence(): Int = mutex.withLock {
        (_records.value.maxOfOrNull { it.sequenceNo } ?: 0) + 1
    }

    /** خطّةُ الإعادة: المعلّقةُ فقط، بترتيب الإدخال — المرتجعُ بعد مستنده والتحصيلُ بعد فاتورته. */
    fun syncPlan(): List<QueueRecord> =
        _records.value.filter { it.queueStatus == QueueStatus.PENDING }.sortedBy { it.sequenceNo }

    fun counts(): QueueCounts {
        val list = _records.value
        return QueueCounts(
            pending = list.count { it.queueStatus == QueueStatus.PENDING },
            synced = list.count { it.queueStatus == QueueStatus.SYNCED },
            refused = list.count { it.queueStatus == QueueStatus.REFUSED },
            total = list.size,
        )
    }
}

data class QueueCounts(val pending: Int, val synced: Int, val refused: Int, val total: Int)
