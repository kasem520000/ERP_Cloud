@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.data.ActionResult
import com.erpcloud.rep.data.api.CollectionRequest
import com.erpcloud.rep.data.offline.QueueOperation
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.SubmitOutcome
import com.erpcloud.rep.ui.components.ActionButton
import com.erpcloud.rep.ui.components.PickerDialog
import com.erpcloud.rep.ui.components.PickerItem
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.util.Dec

/** شاشةُ تحصيلِ دين — على فاتورةٍ آجلةٍ غيرِ مسدَّدةٍ من مستندات المندوب نفسه. */
@Composable
fun CollectionScreen(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val workspace = state.workspace

    var documentId by rememberSaveable { mutableStateOf("") }
    var collectedAmount by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }

    var showDocPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }
    var intentKey by rememberSaveable { mutableStateOf("") }
    var intentFingerprint by rememberSaveable { mutableStateOf("") }
    val currentIntent: Pair<String, String>?
        get() = intentKey.takeIf { it.isNotBlank() }?.let { it to intentFingerprint }

    val unpaid = workspace?.unpaidSaleDocuments ?: emptyList()
    val document = unpaid.firstOrNull { it.id == documentId }

    fun buildRequest(): CollectionRequest? {
        if (documentId.isBlank()) return null
        val amount = Dec.parse(collectedAmount)
        if (amount == null || amount.signum() <= 0) return null
        return CollectionRequest(
            documentId = documentId,
            collectedAmount = collectedAmount.trim(),
            notes = notes.trim().ifBlank { null },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("تحصيلُ دين") },
                navigationIcon = {
                    IconButton(onClick = onDone) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard(
                title = "١) الفاتورة الآجلة",
                subtitle = "التحصيلُ على مستنداتِك غيرِ المسدَّدة — والمبلغُ لا يتجاوز المتبقّي.",
            ) {
                OutlinedButton(onClick = { showDocPicker = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        document?.let { "${it.number} — ${it.customerName} (متبقٍّ ${Dec.money(it.outstanding)} ريال)" }
                            ?: "اختر الفاتورة"
                    )
                }
            }

            SectionCard(title = "٢) المبلغ") {
                OutlinedTextField(
                    value = collectedAmount,
                    onValueChange = { if (Dec.isValidInput(it)) collectedAmount = it },
                    label = { Text("المبلغُ المُحصَّل (ريال) *") },
                    isError = collectedAmount.isNotBlank() && Dec.parse(collectedAmount)?.signum() != 1,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (document != null) {
                    Text(
                        "المتبقّي على الفاتورة: ${Dec.money(document.outstanding)} ريال — " +
                            "الخادمُ يرفضُ ما يتجاوزه (422).",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("ملاحظات") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            if (localError != null) {
                Text(localError ?: "", color = MaterialTheme.colorScheme.error)
            }
            if (!state.online) {
                Text(
                    "لا اتصال — سيُحفظ التحصيلُ في الطابور ويُرسل بمفتاح عدم تكرارٍ واحد عند عودة الشبكة.",
                    color = MaterialTheme.colorScheme.tertiary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            ActionButton(
                label = "تسجيلُ التحصيل",
                icon = Icons.Default.Payments,
                loading = busy,
                enabled = buildRequest() != null,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    val request = buildRequest() ?: return@ActionButton
                    busy = true
                    localError = null
                    vm.submitIntent(
                        operation = QueueOperation.COLLECTION,
                        targetId = null,
                        request = request,
                        currentIntent = currentIntent,
                    ) { outcome: SubmitOutcome ->
                        busy = false
                        when (val result = outcome.result) {
                            is ActionResult.Synced -> { intentKey = ""; intentFingerprint = ""; onDone() }
                            is ActionResult.StoredOffline -> { intentKey = ""; intentFingerprint = ""; onDone() }
                            is ActionResult.Refused -> {
                                intentKey = outcome.intent?.first ?: ""
                                intentFingerprint = outcome.intent?.second ?: ""
                                localError = result.messageAr
                            }
                            is ActionResult.Blocked -> localError = result.reasonsAr.joinToString(" · ")
                        }
                    }
                },
            )
        }
    }

    if (showDocPicker) {
        PickerDialog(
            title = "اختر الفاتورة الآجلة",
            items = unpaid.map {
                PickerItem(
                    id = it.id,
                    title = "${it.number} — ${it.customerName}",
                    subtitle = "${it.docDate} · ${it.itemName}",
                    trailing = "متبقٍّ ${Dec.money(it.outstanding)}",
                )
            },
            onDismiss = { showDocPicker = false },
            onSelect = { documentId = it.id },
        )
    }
}
