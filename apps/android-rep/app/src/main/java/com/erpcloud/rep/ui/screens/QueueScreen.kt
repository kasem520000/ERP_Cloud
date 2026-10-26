@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.data.offline.QueueRecord
import com.erpcloud.rep.data.offline.QueueStatus
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.ChipTone
import com.erpcloud.rep.ui.components.ConfirmDialog
import com.erpcloud.rep.ui.components.EmptyState
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.ui.components.StatusChip

/**
 * شاشةُ الطابور — النيّاتُ المحفوظةُ دون اتصال: ما بانتظار الإرسال، وما رُفض ويحتاج
 * قرارًا، وما وصل. وإعادةُ الإرسال بترتيبِ الإدخال لا بترتيبِ النقر.
 */
@Composable
fun QueueScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val records = state.scopedQueue
    val pending = records.count { it.queueStatus == QueueStatus.PENDING }
    val refused = records.count { it.queueStatus == QueueStatus.REFUSED }
    val synced = records.count { it.queueStatus == QueueStatus.SYNCED }
    var confirmDeleteId by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("طابورُ النيّات", fontWeight = FontWeight.ExtraBold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 14.dp)) {
            SectionCard(title = "الخلاصة") {
                Text(
                    "في الطابور ${records.size} نيّة: " +
                        listOf(
                            "$pending بانتظار الإرسال",
                            "$refused مرفوضةٌ تحتاج قرارك",
                            "$synced وصلت",
                        ).filter { !it.startsWith("0") }.joinToString(" · ").ifBlank { "كلُّ ما أرسلتَه وصل." },
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    "الإعادةُ بترتيبِ الإدخال — المرتجعُ بعد مستنده والتحصيلُ بعد فاتورته — " +
                        "وكلُّ نيّةٍ تُعاد إلى مسارها الرسميّ بمفتاحها نفسه.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (state.session.deviceId.isNotBlank()) {
                    Text(
                        "جهازُ هذا التطبيق: ${state.session.deviceId.take(8)}… — وسمُ تتبّعٍ في مفاتيح عدم التكرار، ليس حدًّا أمنيًّا.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { vm.replayQueue() },
                        enabled = pending > 0 && state.online,
                    ) { Text("إعادةُ الإرسال") }
                    OutlinedButton(
                        onClick = { vm.clearSynced() },
                        enabled = synced > 0,
                    ) { Text("حذفُ ما وصل") }
                }
            }

            if (records.isEmpty()) {
                EmptyState("لا نيّاتٍ محفوظة: كلُّ ما أرسلتَه وصل.")
            } else {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(records, key = { it.offlineId }) { record ->
                        QueueRow(
                            record = record,
                            onRetry = { vm.retryRefusedRecord(record.offlineId) },
                            onDelete = { confirmDeleteId = record.offlineId },
                        )
                    }
                    items(1) { androidx.compose.foundation.layout.Spacer(Modifier.padding(16.dp)) }
                }
            }
        }
    }

    val deleteId = confirmDeleteId
    if (deleteId != null) {
        ConfirmDialog(
            title = "حذفُ النيّة المرفوضة",
            message = "هل تريد حذف هذه النيّة نهائيًّا من الطابور المحلي؟ لن تُرسل إلى الخادم بعد حذفها.",
            confirmLabel = "حذف نهائي",
            onConfirm = {
                vm.removeQueuedRecord(deleteId)
                confirmDeleteId = null
            },
            onDismiss = { confirmDeleteId = null },
        )
    }
}

@Composable
private fun QueueRow(
    record: QueueRecord,
    onRetry: () -> Unit,
    onDelete: () -> Unit,
) {
    SectionCard(title = record.label, subtitle = "#${record.sequenceNo} · ${record.createdAt.take(19).replace('T', ' ')}") {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("المسار", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                "/${record.endpoint}",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("المفتاح", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(record.idempotencyKey.take(24) + "…", style = MaterialTheme.typography.bodyMedium)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("المحاولات", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${record.attempts}", style = MaterialTheme.typography.bodyMedium)
        }
        if (record.lastMessage.isNotBlank()) {
            Text(
                record.lastMessage,
                style = MaterialTheme.typography.bodyMedium,
                color = when (record.queueStatus) {
                    QueueStatus.SYNCED -> MaterialTheme.colorScheme.tertiary
                    QueueStatus.REFUSED -> MaterialTheme.colorScheme.error
                    QueueStatus.PENDING -> MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
        }
        Row(
            Modifier.fillMaxWidth().padding(top = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            when (record.queueStatus) {
                QueueStatus.PENDING -> StatusChip("بانتظار الإرسال", ChipTone.WARN)
                QueueStatus.SYNCED -> StatusChip("وصلت", ChipTone.OK)
                QueueStatus.REFUSED -> StatusChip("مرفوضة — تحتاج قرارك", ChipTone.DANGER)
            }
            if (record.queueStatus == QueueStatus.REFUSED) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedButton(onClick = onRetry) { Text("إعادة للمحاولة") }
                    OutlinedButton(onClick = onDelete) {
                        Text("حذف", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}
